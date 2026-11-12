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
import { agendaTool } from "./agenda.js";
import { chatContext } from "./context.js";
import { courseFactsTool } from "./course-facts.js";
import { historyFrom, historyTurns } from "./history.js";
import type { ChatPart } from "./parts.js";
import { isProposal, partsFrom } from "./parts.js";
import type { Proposal } from "./proposals.js";
import {
  approveProposal,
  intentOf,
  proposeStudyBlockMoveTool,
  proposeStudyBlockTool,
} from "./proposals.js";
import { searchTool } from "./search.js";
import { createTurn } from "./turn.js";

/** Whether a tool call waits for the student: approval asked, and not yet answered. */
function awaitsApproval(messages: readonly ModelMessage[]) {
  const asked = new Set<string>();
  const answered = new Set<string>();
  for (const message of messages)
    if (Array.isArray(message.content))
      for (const part of message.content as {
        type: string;
        approvalId?: string;
      }[]) {
        if (part.type === "tool-approval-request") asked.add(part.approvalId!);
        if (part.type === "tool-approval-response")
          answered.add(part.approvalId!);
      }
  return [...asked].some((id) => !answered.has(id));
}

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
  plan: Pick<Plan, "timeZone" | "view" | "check">;
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
  /** What answering in a Chat needs: its history, the context message, and this turn's tools. */
  async function turnFor(p: Principal, chatId: string) {
    const [history, timeZone] = await Promise.all([
      earlier(p, chatId),
      plan.timeZone(p),
    ]);
    if (!history) return null;
    const context = chatContext(clock.now(), timeZone, history.courses);
    const turn = createTurn();
    const tools = {
      // A Chat with nothing selected has nothing to search.
      ...(history.selected
        ? { searchMaterial: searchTool(turn, reader, p, chatId) }
        : {}),
      agenda: agendaTool(turn, {
        reader,
        plan,
        p,
        timeZone,
        courses: context.courses,
      }),
      courseFacts: courseFactsTool(turn, {
        reader,
        p,
        courses: context.courses,
      }),
      proposeStudyBlock: proposeStudyBlockTool(),
      proposeStudyBlockMove: proposeStudyBlockMoveTool(),
    };
    /** Proposals that passed the Plan's rules, by tool call, waiting for the student once the answer is saved. */
    const proposals = new Map<string, Proposal>();
    const approve = approveProposal(turn, { plan, p, timeZone, proposals });
    const toolApproval = {
      proposeStudyBlock: approve.create,
      proposeStudyBlockMove: approve.move,
    };
    return { history, context, turn, tools, proposals, toolApproval };
  }
  /** The saved answers of a Chat, newest first, with their parts opened. */
  async function answers(p: Principal, chatId: string) {
    return withOwner(db, p, async (tx) => {
      const rows = await tx.chatMessage.findMany({
        where: { chatId, role: "assistant", partsContent: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      return Promise.all(
        rows.map(async (row) => {
          const parts = await derived.open(tx, `${row.id}:parts`, {
            content: row.partsContent!,
            contentKey: row.partsKey,
            derivedFrom: row.derivedFrom,
          });
          return {
            id: row.id,
            derivedFrom: row.derivedFrom,
            parts: parts === null ? [] : (JSON.parse(parts) as ChatPart[]),
          };
        }),
      );
    });
  }
  return {
    /** The proposal a Chat's answer asked under `approvalId`, with the Action key it was asked as. */
    async proposal(p: Principal, chatId: string, approvalId: string) {
      for (const answer of await answers(p, chatId))
        for (const part of answer.parts)
          if (isProposal(part) && part.approvalId === approvalId)
            return { answerId: answer.id, ...part };
      return null;
    },
    /**
     * Has the model tell the student how an approved proposal went, in a new answer of its own (ADR-0019). It is
     * given the Chat's history, the proposal it made and the gate's outcome, and may call no tool.
     */
    async report(
      p: Principal,
      chatId: string,
      approvalId: string,
      outcome: string,
      answerer: Answerer,
      options: {
        signal?: AbortSignal;
        write?: (chunk: UIMessageChunk) => void;
        /** The ID for the recorded answer, when the caller already shows it. */
        id?: string;
      } = {},
    ) {
      const [setUp, proposal] = await Promise.all([
        turnFor(p, chatId),
        this.proposal(p, chatId, approvalId),
      ]);
      if (!setUp || !proposal) return { status: "gone" } as const;
      const { history, context, tools } = setUp;
      const answered = (await answers(p, chatId)).find(
        (answer) => answer.id === proposal.answerId,
      )!;
      const messages: ModelMessage[] = [
        ...history.turns.flatMap((turn): ModelMessage[] => [
          { role: "user", content: turn.question },
          { role: "assistant", content: turn.answer },
        ]),
        { role: "user", content: context.text },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: proposal.toolCallId,
              toolName: proposal.type.slice("tool-".length),
              input: proposal.input,
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: proposal.toolCallId,
              toolName: proposal.type.slice("tool-".length),
              output: { type: "text", value: outcome },
            },
          ],
        },
      ];
      const chunks: UIMessageChunk[] = [];
      const input = { messages, tools, last: true };
      const stepped = await delegation.meter(
        p,
        { microUsd: answerer.estimateMicroUsd(input) },
        (deadline) =>
          definitely(() =>
            answerer.step(input, {
              signal: options.signal
                ? AbortSignal.any([deadline, options.signal])
                : deadline,
              write: (chunk) => {
                chunks.push(chunk);
                options.write?.(chunk);
              },
            }),
          ),
      );
      if (stepped.status === "refused") return stepped;
      const parts = await partsFrom(chunks, new Set(), () => undefined);
      const text = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n\n");
      // It restates the answer it follows, so it goes with that answer's Sources.
      const derivedFrom = [
        ...new Set([...answered.derivedFrom, ...history.derivedFrom]),
      ];
      const id = options.id ?? randomUUID();
      const createdAt = new Date();
      const recorded = await withOwner(db, p, async (tx, studentId) => {
        const sealed = await derived.seal(tx, id, derivedFrom, text);
        const sealedParts = await derived.seal(
          tx,
          `${id}:parts`,
          derivedFrom,
          JSON.stringify(parts),
        );
        if (!sealed || !sealedParts) return null;
        return tx.chatMessage.create({
          data: {
            id,
            chatId,
            studentId,
            role: "assistant",
            ...sealed,
            partsContent: sealedParts.content,
            partsKey: sealedParts.contentKey,
            citations: [],
            modelKey: answerer.modelKey,
            createdAt,
          },
          select: { model: { select: { key: true, name: true } } },
        });
      });
      if (!recorded) return { status: "gone" } as const;
      const message: ChatMessage = {
        id,
        role: "assistant",
        text,
        parts,
        createdAt: createdAt.toISOString(),
        citations: [],
        model: recorded.model,
      };
      return { status: "ok", message } as const;
    },
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
      const setUp = await turnFor(p, chatId);
      step("history");
      if (!setUp) return { status: "gone" } as const;
      const { history, context, turn, tools, proposals, toolApproval } = setUp;
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
          tools,
          toolApproval,
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
        const refusal = turn.refusal();
        if (refusal === "gone") return { status: "gone" } as const;
        if (refusal) return { status: "refused", reason: refusal } as const;
        if (stepped.status === "refused") return stepped;
        messages.push(...stepped.value.messages);
        // A proposal waits for the student, so the turn ends with it; its call has no result to send on.
        if (stepped.value.finishReason === "stop" || awaitsApproval(messages))
          break;
      }
      step("generation");
      options.signal?.throwIfAborted();
      const id = options.ids?.answer ?? randomUUID();
      // Each proposal is asked as the answer's n-th Action (`chatId:messageId:n`) once the answer is saved.
      const asked = [...proposals].map(([toolCallId, proposal], n) => ({
        toolCallId,
        key: `${chatId}:${id}:${n}`,
        proposal,
      }));
      const parts = await partsFrom(
        chunks,
        new Set(turn.citations.map((citation) => citation.tag)),
        (toolCallId) => {
          const found = asked.find((a) => a.toolCallId === toolCallId);
          return found && { key: found.key, notes: found.proposal.notes };
        },
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
        turn.citations.filter((citation) => citation.tag === tag),
      );
      // The answer may restate earlier answers, so it is withdrawn with their Sources too.
      const derivedFrom = [
        ...new Set([...turn.sources, ...history.derivedFrom]),
      ];
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
      // After the answer, so a failed turn leaves no card behind (ADR-0019 amendment). The gate may still refuse,
      // say for a block Locked meanwhile; the card then shows no Action.
      for (const { key, proposal } of asked)
        await delegation
          .perform(p, {
            key,
            intent: intentOf(proposal),
          })
          .catch((error: unknown) =>
            console.error(
              JSON.stringify({
                msg: "chat proposal not asked",
                key,
                error: String(error),
              }),
            ),
          );
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
