import { randomUUID } from "node:crypto";
import type { Answerer } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { createDerivedText } from "./derived.js";
import { definitely } from "./provider.js";
import type { Citation, KnowledgeReader, Provenance } from "./reader.js";

export type ChatMessage = {
  id: string;
  role: "student" | "assistant";
  /** Null once a Source the answer drew on is deleted: its wording is shredded with that Source. */
  text: string | null;
  citations: { tag: string; provenance: Provenance | "gone" }[];
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
  const derived = createDerivedText(keys);
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
      const recorded = await withOwner(db, p, async (tx, studentId) => {
        if (!(await tx.chat.findUnique({ where: { id: chatId } })))
          return false;
        const sealed = await derived.seal(
          tx,
          id,
          derivedFrom,
          answered.value.text,
        );
        // A Source deleted while answering takes the answer with it.
        if (!sealed) return false;
        // One timestamp; the role's enum order keeps the question before its answer.
        const createdAt = new Date();
        await tx.chatMessage.create({
          data: {
            id: randomUUID(),
            chatId,
            studentId,
            role: "student",
            content: new Uint8Array(Buffer.from(question)),
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
            citations: cited,
            createdAt,
          },
        });
        return true;
      });
      if (!recorded) return { status: "gone" } as const;
      const message: ChatMessage = {
        id,
        role: "assistant",
        text: answered.value.text,
        citations: await resolve(p, cited),
      };
      return { status: "ok", message } as const;
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
            return {
              id: message.id,
              role: message.role as ChatMessage["role"],
              text: await derived.open(tx, message.id, message),
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
