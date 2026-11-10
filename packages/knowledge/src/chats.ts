import { randomBytes, randomUUID } from "node:crypto";
import type { Answerer } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Principal, Transaction } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import {
  decryptDerivedText,
  encryptDerivedText,
  unwrapUnderSource,
  wrapUnderSource,
} from "@nunio/keys";
import { definitely } from "./provider.js";
import type { Citation, KnowledgeReader, Provenance } from "./reader.js";

export type ChatMessage = {
  id: string;
  role: "student" | "assistant";
  /** Null once a Source the answer drew on is deleted: its wording is shredded with that Source. */
  text: string | null;
  citations: { tag: string; provenance: Provenance | "gone" }[];
  createdAt: string;
};

/** Chats: an explicit selection of Courses and Sources, and questions answered only from it. */
export function createChats({
  db,
  keys,
  reader,
  delegation,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  reader: KnowledgeReader;
  delegation: Delegation;
}) {
  /** The live Source keys, in order; null when any of them is gone. The caller zeroes them. */
  async function sourceKeys(tx: Transaction, sourceIds: readonly string[]) {
    const rows = await tx.source.findMany({
      where: { id: { in: [...sourceIds] }, deletedAt: null },
      select: { id: true, keyVersion: true, keyCiphertext: true },
    });
    const unwrapped: { id: string; key: Buffer }[] = [];
    for (const id of sourceIds) {
      const row = rows.find((r) => r.id === id);
      if (!row?.keyVersion || !row.keyCiphertext) {
        zero(unwrapped);
        return null;
      }
      unwrapped.push({
        id,
        key: keys.unwrap(id, {
          version: row.keyVersion,
          ciphertext: row.keyCiphertext,
        }),
      });
    }
    return unwrapped;
  }
  async function resolve(p: Principal, citations: Citation[]) {
    const provenance = await reader.cite(
      p,
      citations.map((citation) => citation.cite),
    );
    return citations.map(({ tag, cite }) => ({
      tag,
      provenance: provenance.get(cite) ?? ("gone" as const),
    }));
  }
  return {
    async detail(p: Principal, id: string) {
      const chat = await withOwner(db, p, (tx) =>
        tx.chat.findUnique({
          where: { id },
          select: {
            courses: {
              select: {
                course: { select: { id: true, title: true, code: true } },
              },
            },
          },
        }),
      );
      if (!chat) return null;
      const messages = await this.messages(p, id);
      return messages
        ? { id, courses: chat.courses.map(({ course }) => course), messages }
        : null;
    },
    async create(
      p: Principal,
      selection: { courseIds: string[]; sourceIds: string[] },
    ) {
      return withOwner(db, p, async (tx, studentId) => {
        // RLS hides another student's rows, so a foreign ID counts as gone like a deleted one.
        const courses = await tx.course.count({
          where: { id: { in: selection.courseIds }, status: { not: "merged" } },
        });
        const sources = await tx.source.count({
          where: { id: { in: selection.sourceIds }, deletedAt: null },
        });
        if (
          courses !== new Set(selection.courseIds).size ||
          sources !== new Set(selection.sourceIds).size
        )
          return { status: "gone" } as const;
        const chat = await tx.chat.create({
          data: { id: randomUUID(), studentId },
        });
        await tx.chatCourse.createMany({
          data: [...new Set(selection.courseIds)].map((courseId) => ({
            chatId: chat.id,
            courseId,
            studentId,
          })),
        });
        await tx.chatSource.createMany({
          data: [...new Set(selection.sourceIds)].map((sourceId) => ({
            chatId: chat.id,
            sourceId,
            studentId,
          })),
        });
        return { status: "ok", id: chat.id } as const;
      });
    },
    /** Answers from the Chat's selection only, recording the question and the answer. */
    async ask(
      p: Principal,
      chatId: string,
      question: string,
      answerer: Answerer,
    ) {
      const retrieval = await reader.retrieve(
        p,
        { chatId },
        { kind: "passages", text: question },
      );
      if (retrieval.status === "refused") {
        return retrieval.reason === "not_owner"
          ? ({ status: "gone" } as const)
          : ({ status: "refused", reason: retrieval.reason } as const);
      }
      const { data, citations } = retrieval.render();
      const input = {
        question,
        data,
        tags: citations.map((citation) => citation.tag),
      };
      const answered = await delegation.meter(
        p,
        { microUsd: answerer.estimateMicroUsd(input) },
        (signal) => definitely(() => answerer.answer(input, { signal })),
      );
      if (answered.status === "refused") return answered;
      const cited = answered.value.cited.flatMap((tag) =>
        citations.filter((citation) => citation.tag === tag),
      );
      const derivedFrom = [
        ...new Set(
          retrieval.items.flatMap((item) =>
            item.provenance.kind === "source" ? [item.provenance.sourceId] : [],
          ),
        ),
      ];
      const id = randomUUID();
      const questionId = randomUUID();
      const createdAt = new Date();
      const recorded = await withOwner(db, p, async (tx, studentId) => {
        if (!(await tx.chat.findUnique({ where: { id: chatId } })))
          return false;
        const layers = await sourceKeys(tx, derivedFrom);
        // A Source deleted while answering takes the answer with it.
        if (!layers) return false;
        const messageKey = randomBytes(32);
        try {
          const sealed = layers.length
            ? {
                content: bytes(
                  encryptDerivedText(messageKey, id, answered.value.text),
                ),
                contentKey: bytes(
                  layers.reduce<Buffer>(
                    (wrapped, { id: sourceId, key }) =>
                      wrapUnderSource(key, sourceId, wrapped),
                    messageKey,
                  ),
                ),
              }
            : {
                content: bytes(Buffer.from(answered.value.text)),
                contentKey: null,
              };
          // One timestamp; the role's enum order keeps the question before its answer.
          await tx.chatMessage.create({
            data: {
              id: questionId,
              chatId,
              studentId,
              role: "student",
              content: bytes(Buffer.from(question)),
              createdAt,
            },
          });
          await tx.chatMessage.create({
            data: {
              id,
              chatId,
              studentId,
              role: "assistant",
              ...sealed,
              derivedFrom,
              citations: cited,
              createdAt,
            },
          });
          return true;
        } finally {
          messageKey.fill(0);
          zero(layers);
        }
      });
      if (!recorded) return { status: "gone" } as const;
      const message: ChatMessage = {
        id,
        role: "assistant",
        text: answered.value.text,
        createdAt: createdAt.toISOString(),
        citations: await resolve(p, cited),
      };
      return {
        status: "ok",
        message,
        question: {
          id: questionId,
          role: "student",
          text: question,
          citations: [],
          createdAt: createdAt.toISOString(),
        } satisfies ChatMessage,
      } as const;
    },
    /** The Chat's messages, oldest first, with citations resolved now; null when the Chat is gone. */
    async messages(
      p: Principal,
      chatId: string,
    ): Promise<ChatMessage[] | null> {
      const stored = await withOwner(db, p, async (tx) => {
        const chat = await tx.chat.findUnique({
          where: { id: chatId },
          include: {
            messages: { orderBy: [{ createdAt: "asc" }, { role: "asc" }] },
          },
        });
        if (!chat) return null;
        return Promise.all(
          chat.messages.map(async (message) => {
            let text: string | null = Buffer.from(message.content).toString(
              "utf8",
            );
            if (message.contentKey) {
              const layers = await sourceKeys(tx, message.derivedFrom);
              text =
                layers &&
                open(message.id, message.content, message.contentKey, layers);
              if (layers) zero(layers);
            }
            return {
              id: message.id,
              createdAt: message.createdAt.toISOString(),
              role: message.role as ChatMessage["role"],
              text,
              citations: message.citations as Citation[],
            };
          }),
        );
      });
      if (!stored) return null;
      return Promise.all(
        stored.map(async (message) => ({
          ...message,
          citations: await resolve(p, message.citations),
        })),
      );
    },
  };
}
export type Chats = ReturnType<typeof createChats>;

/** Unwraps the message key through each Source key in reverse wrapping order, then decrypts the text. */
function open(
  id: string,
  content: Uint8Array,
  contentKey: Uint8Array,
  layers: { id: string; key: Buffer }[],
) {
  const messageKey = layers.reduceRight<Buffer>(
    (wrapped, { id: sourceId, key }) =>
      unwrapUnderSource(key, sourceId, wrapped),
    Buffer.from(contentKey),
  );
  try {
    return decryptDerivedText(messageKey, id, content);
  } finally {
    messageKey.fill(0);
  }
}
/** Prisma stores bytes from a Uint8Array over its own ArrayBuffer. */
const bytes = (buffer: Buffer) => new Uint8Array(buffer);
const zero = (layers: { key: Buffer }[]) => {
  for (const { key } of layers) key.fill(0);
};
