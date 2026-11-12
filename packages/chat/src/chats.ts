import { randomUUID } from "node:crypto";
import type { Answerer } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type { Citation, KnowledgeReader, Provenance } from "@nunio/knowledge";
import { createDerivedText, definitely } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import type { ModelMessage, UIMessageChunk } from "ai";
import { chatContext } from "./context.js";
import { historyFrom, historyTurns } from "./history.js";
import type { ChatPart } from "./parts.js";
import { partsFrom } from "./parts.js";
import { createSearch } from "./search.js";

/** At most this many model steps answer one question; the last one must answer (ADR-0019). */
const maxSteps = 6;

export type ChatMessage = {
  id: string;
  role: "student" | "assistant";
  /** Null once a Source the answer drew on is deleted: its wording is shredded with that Source. */
  text: string | null;
  reasoning?: string;
  /** The answer's reasoning, tool calls and text in order; empty once withdrawn. */
  parts: ChatPart[];
  citations: { tag: string; provenance: Provenance | "gone" }[];
  /** The Model Catalog entry that wrote an answer; null for questions and older answers. */
  model: { key: string; name: string } | null;
  createdAt: string;
};

/** A step of answering a question, timed by `ask`. */
export type AskStep = "history" | "generation" | "persistence";

/** Chats: an explicit selection of Courses and Sources, and questions answered only from it. */
export function createChats({
  db,
  keys,
  reader,
  delegation,
  plan,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  reader: KnowledgeReader;
  delegation: Delegation;
  plan: Pick<Plan, "timeZone">;
  clock: { now(): Date };
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
  /**
   * The Chat's recent messages, decrypted, as the history the next answer is given, and whether it selected
   * anything to search; null when the Chat is gone.
   */
  async function earlier(p: Principal, chatId: string) {
    const recent = await withOwner(db, p, async (tx) => {
      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: { _count: { select: { courses: true, sources: true } } },
      });
      if (!chat) return null;
      const rows = await tx.chatMessage.findMany({
        where: { chatId },
        orderBy: [{ createdAt: "desc" }, { role: "desc" }],
        take: historyTurns * 2,
      });
      const messages = await Promise.all(
        rows.reverse().map(async (row) => ({
          role: row.role as ChatMessage["role"],
          text: await derived.open(tx, row.id, row),
          derivedFrom: row.derivedFrom,
        })),
      );
      // The Courses a Plan includes: not rejected, merged or Archived.
      const courses = await tx.course.findMany({
        where: { status: { in: ["proposed", "accepted"] }, archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, code: true, semester: true },
      });
      return {
        messages,
        courses,
        selected: chat._count.courses + chat._count.sources > 0,
      };
    });
    return (
      recent && {
        ...historyFrom(recent.messages),
        courses: recent.courses,
        selected: recent.selected,
      }
    );
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
    /** Whether the student already has a message with this ID, in any of their Chats. */
    async hasMessage(p: Principal, id: string) {
      return !!(await withOwner(db, p, (tx) =>
        tx.chatMessage.findUnique({ where: { id }, select: { id: true } }),
      ));
    },
    /**
     * Answers in model steps that may search the Chat's selection (ADR-0019), passing each step's UI message
     * chunks to `write` while they stream, then records the question and the answer.
     */
    async ask(
      p: Principal,
      chatId: string,
      question: string,
      answerer: Answerer,
      options: {
        signal?: AbortSignal;
        write?: (chunk: UIMessageChunk) => void;
        /** IDs for the recorded question and answer, when the caller already shows them. */
        ids?: { question: string; answer: string };
        /** Called with how long each step took, in milliseconds. */
        onStep?: (step: AskStep, ms: number) => void;
      } = {},
    ) {
      options.signal?.throwIfAborted();
      let started = performance.now();
      const step = (name: AskStep) => {
        const now = performance.now();
        options.onStep?.(name, now - started);
        started = now;
      };
      const [history, timeZone] = await Promise.all([
        earlier(p, chatId),
        plan.timeZone(p),
      ]);
      step("history");
      if (!history) return { status: "gone" } as const;
      const context = chatContext(clock.now(), timeZone, history.courses);
      const search = createSearch(reader, p, chatId);
      const messages: ModelMessage[] = [
        ...history.turns.flatMap((turn): ModelMessage[] => [
          { role: "user", content: turn.question },
          { role: "assistant", content: turn.answer },
        ]),
        { role: "user", content: context.text },
        { role: "user", content: question },
      ];
      const chunks: UIMessageChunk[] = [];
      const write = (chunk: UIMessageChunk) => {
        chunks.push(chunk);
        options.write?.(chunk);
      };
      for (let n = 1; ; n++) {
        options.signal?.throwIfAborted();
        const input = {
          messages,
          // A Chat with nothing selected has nothing to search.
          tools: history.selected ? search.tools : {},
          last: n === maxSteps,
        };
        const stepped = await delegation.meter(
          p,
          { microUsd: answerer.estimateMicroUsd(input) },
          (deadline) =>
            definitely(() =>
              answerer.step(input, {
                signal: options.signal
                  ? AbortSignal.any([deadline, options.signal])
                  : deadline,
                write,
              }),
            ),
        );
        const refusal = search.refusal();
        if (refusal === "gone") return { status: "gone" } as const;
        if (refusal) return { status: "refused", reason: refusal } as const;
        if (stepped.status === "refused") return stepped;
        messages.push(...stepped.value.messages);
        if (stepped.value.finishReason === "stop") break;
      }
      step("generation");
      options.signal?.throwIfAborted();
      const parts = await partsFrom(
        chunks,
        new Set(search.citations.map((citation) => citation.tag)),
      );
      const text = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n\n");
      const reasoning = parts
        .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
        .join("\n\n");
      const cited = [
        ...new Set([...text.matchAll(/\[(S\d+)\]/g)].map((match) => match[1])),
      ].flatMap((tag) =>
        search.citations.filter((citation) => citation.tag === tag),
      );
      // The answer may restate earlier answers, so it is withdrawn with their Sources too.
      const derivedFrom = [
        ...new Set([...search.sources, ...history.derivedFrom]),
      ];
      const id = options.ids?.answer ?? randomUUID();
      const questionId = options.ids?.question ?? randomUUID();
      const createdAt = new Date();
      const recorded = await withOwner(db, p, async (tx, studentId) => {
        if (!(await tx.chat.findUnique({ where: { id: chatId } })))
          return false;
        const sealed = await derived.seal(tx, id, derivedFrom, text);
        const sealedParts = await derived.seal(
          tx,
          `${id}:parts`,
          derivedFrom,
          JSON.stringify(parts),
        );
        // A Source deleted while answering takes the answer with it.
        if (!sealed || !sealedParts) return false;
        // One timestamp; the role's enum order keeps the question before its answer.
        await tx.chatMessage.create({
          data: {
            id: questionId,
            chatId,
            studentId,
            role: "student",
            content: new Uint8Array(Buffer.from(question)),
            createdAt,
          },
        });
        return tx.chatMessage.create({
          data: {
            id,
            chatId,
            studentId,
            role: "assistant",
            ...sealed,
            partsContent: sealedParts.content,
            partsKey: sealedParts.contentKey,
            citations: cited,
            modelKey: answerer.modelKey,
            createdAt,
          },
          select: { model: { select: { key: true, name: true } } },
        });
      }).catch((error: unknown) => {
        // A question ID already saved, here or by a concurrent request, fails the primary key.
        if ((error as { code?: unknown }).code === "P2002")
          return "conflict" as const;
        throw error;
      });
      step("persistence");
      if (recorded === "conflict") return { status: "conflict" } as const;
      if (!recorded) return { status: "gone" } as const;
      const message: ChatMessage = {
        id,
        role: "assistant",
        text,
        ...(reasoning ? { reasoning } : {}),
        parts,
        createdAt: createdAt.toISOString(),
        citations: await resolve(p, cited),
        model: recorded.model,
      };
      return {
        status: "ok",
        message,
        question: {
          id: questionId,
          role: "student",
          text: question,
          parts: [{ type: "text", text: question }],
          citations: [],
          model: null,
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
            messages: {
              orderBy: [{ createdAt: "asc" }, { role: "asc" }],
              include: { model: { select: { key: true, name: true } } },
            },
          },
        });
        if (!chat) return null;
        return Promise.all(
          chat.messages.map(async (message) => {
            const text = await derived.open(tx, message.id, message);
            const open = (
              suffix: string,
              content: Uint8Array<ArrayBuffer>,
              contentKey: Uint8Array<ArrayBuffer> | null,
            ) =>
              derived.open(tx, `${message.id}:${suffix}`, {
                content,
                contentKey,
                derivedFrom: message.derivedFrom,
              });
            const stored =
              text !== null && message.partsContent
                ? await open("parts", message.partsContent, message.partsKey)
                : null;
            const reasoning =
              text !== null && message.reasoningContent
                ? await open(
                    "reasoning",
                    message.reasoningContent,
                    message.reasoningKey,
                  )
                : null;
            // Answers from before parts were stored show their reasoning, then their text.
            const parts: ChatPart[] =
              text === null
                ? []
                : stored
                  ? JSON.parse(stored)
                  : [
                      ...(reasoning
                        ? [{ type: "reasoning" as const, text: reasoning }]
                        : []),
                      { type: "text" as const, text },
                    ];
            const thought = parts
              .flatMap((part) => (part.type === "reasoning" ? [part.text] : []))
              .join("\n\n");
            return {
              id: message.id,
              createdAt: message.createdAt.toISOString(),
              role: message.role as ChatMessage["role"],
              text,
              ...(thought ? { reasoning: thought } : {}),
              parts,
              citations: message.citations as Citation[],
              model: message.model,
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
