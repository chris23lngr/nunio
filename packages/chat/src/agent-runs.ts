import type { AgentModel } from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import type { PrismaClient } from "@nunio/db";
import type {
  Agents,
  CapabilityId,
  CatalogModel,
  Delegation,
  ModelCatalog,
  Principal,
} from "@nunio/delegation";
import {
  capabilities,
  DefiniteFailure,
  principal,
  withOwner,
} from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type { KnowledgeReader, Sealed } from "@nunio/knowledge";
import { createDerivedText, definitely } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import type { Understanding } from "@nunio/understanding";
import type { ModelMessage } from "ai";
import { agendaTool } from "./agenda.js";
import { chatContext } from "./context.js";
import { courseFactsTool } from "./course-facts.js";
import type { ChatPart } from "./parts.js";
import { retryRateLimited } from "./retry.js";
import type { StoredCall } from "./run-actions.js";
import { actionTools, intentOf, readCall, resultOf } from "./run-actions.js";
import { searchTool } from "./search.js";
import type { Handled } from "./turn.js";
import { createTurn } from "./turn.js";

/** At most this many model steps make one Run; the last must answer (ADR-0026). */
export const maxSteps = 20;
/** The summary's length, about as long as the student reads in Activity (#149). */
const maxSummary = 600;

/** What the student may see of a step: each read tool call with what it showed, never what the model was given. */
export type RunStepPart = Extract<
  ChatPart,
  { type: "tool-searchMaterial" | "tool-courseFacts" | "tool-agenda" }
>;

/**
 * How a step went: the model called tools, `actions` of them Action tools for the gate to perform, or answered; the
 * Run must stop for a refusal, such as paused, budget_exhausted or model_unavailable; or it fails, as when the model's
 * step ended early or an earlier attempt at the step may have paid for a model call it never stored (step_interrupted).
 */
export type StepOutcome =
  | { status: "continue"; actions: number }
  | { status: "answered" }
  | { status: "refused"; reason: string }
  | { status: "failed"; reason: string };

/** How a Run ended, and why when it did not simply finish. */
export type RunEnd =
  | { status: "done" }
  | { status: "stopped"; reason: string }
  | { status: "failed"; reason?: string };

/** The model's final message, as the student reads it: plain text without links, citation tags or Markdown. */
export function summaryOf(text: string) {
  const plain = text
    .replace(/\s*\[S\d+\]/g, "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\*\*|__|^#+\s*/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (plain.length <= maxSummary) return plain;
  const cut = plain.slice(0, maxSummary - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxSummary / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The text of the last assistant message among a step's messages. */
function finalText(messages: ModelMessage[]) {
  const answer = messages.findLast((message) => message.role === "assistant");
  if (!answer) return "";
  if (typeof answer.content === "string") return answer.content;
  return answer.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

/**
 * A free-text Agent's Runs (#141): started with the Agent's configuration snapshotted, then one metered model step at a
 * time over the read tools, each claimed per `(runId, n)` before its model call, so no attempt calls the model for a
 * step another attempt may have paid for, then ended with the model's final message as its summary. Only nunio's system prompt and the saved Instructions are requests;
 * every tool result is fenced data (ADR-0026).
 */
export function createAgentRuns({
  db,
  keys,
  reader,
  plan,
  understanding,
  artifacts,
  delegation,
  agents,
  catalog,
  modelFor,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  reader: KnowledgeReader;
  plan: Pick<Plan, "view" | "timeZone">;
  understanding: Pick<Understanding, "levels">;
  artifacts: Pick<Artifacts, "list">;
  delegation: Delegation;
  agents: Pick<Agents, "startRun">;
  catalog: Pick<ModelCatalog, "chatModels">;
  /** The Model a Run's steps run on, from the catalog's offered row. */
  modelFor: (model: CatalogModel) => AgentModel;
  clock: { now(): Date };
}) {
  const derived = createDerivedText(keys);
  const sealedOf = (
    content: Uint8Array<ArrayBuffer>,
    contentKey: Uint8Array<ArrayBuffer> | null,
    derivedFrom: string[],
  ): Sealed => ({ content, contentKey, derivedFrom });
  return {
    /**
     * Records the Run, or takes up the one the student started, with the Agent's Instructions, Capabilities and the
     * catalog's Chat default Model snapshotted, and pins its Courses, Archived ones included, as what it reads. Null
     * when the Agent may not run now. Idempotent on `runId`.
     */
    async start(ref: {
      studentId: string;
      agentId: string;
      runId: string;
      workflowId: string;
    }): Promise<string | null> {
      const offered = await catalog.chatModels();
      const runId = await agents.startRun({
        ...ref,
        modelKey: offered.find((model) => model.chatDefault)?.key ?? null,
      });
      if (!runId) return null;
      const student = principal.fromSession({ studentId: ref.studentId });
      // A merged Course went into another, which the Agent has only if the student gave it.
      const courseIds = await withOwner(db, student, async (tx) =>
        (
          await tx.agentCourse.findMany({
            where: {
              agentId: ref.agentId,
              course: { status: { not: "merged" } },
            },
            select: { courseId: true },
          })
        ).map((c) => c.courseId),
      );
      const pinned = await reader.pin(student, {
        runId,
        from: { selection: { courseIds, sourceIds: [] } },
      });
      if (pinned.status !== "ok") throw new Error("The Run's Courses are gone");
      return runId;
    },

    /**
     * Runs model step `n` of the Run, metered against the Agent's Budget and the Allowance, and persists it. A step
     * already persisted returns how it went. The step is claimed before its model call and released only when the
     * call certainly cost nothing (a refusal, or a provider's rejection), so an attempt that finds it claimed but never
     * stored fails instead of calling the model again. The last allowed step must answer.
     */
    async step(runId: string, n: number): Promise<StepOutcome> {
      if (!Number.isInteger(n) || n < 1 || n > maxSteps)
        throw new Error(`A Run has no step ${n}`);
      const p = principal.fromRun(runId);
      const outcome = (answered: boolean, calls: unknown): StepOutcome =>
        answered
          ? { status: "answered" }
          : {
              status: "continue",
              actions: ((calls as StoredCall[] | null) ?? []).length,
            };
      const loaded = await withOwner(db, p, async (tx) => {
        const done = await tx.runStep.findUnique({
          where: { runId_n: { runId, n } },
        });
        if (done) return { done };
        const run = await tx.run.findUniqueOrThrow({
          where: { id: runId },
          include: {
            pin: { include: { courses: { include: { course: true } } } },
            steps: { where: { n: { lt: n } }, orderBy: { n: "asc" } },
          },
        });
        if (run.status !== "running") return { ended: true };
        if (run.steps.length !== n - 1)
          throw new Error(`Step ${n} of Run ${runId} comes too early`);
        // What the gate made of the previous step's Action calls, which this step tells the model.
        const performed = await tx.action.findMany({
          where: { runId, key: { startsWith: `${runId}:${n - 1}:` } },
        });
        const transcripts = await Promise.all(
          run.steps.map((step) =>
            step.transcriptContent
              ? derived.open(
                  tx,
                  `${runId}:${step.n}:transcript`,
                  sealedOf(
                    step.transcriptContent,
                    step.transcriptKey,
                    step.derivedFrom,
                  ),
                )
              : null,
          ),
        );
        return { run, transcripts, performed };
      });
      if ("done" in loaded)
        return loaded.done!.partsContent
          ? outcome(loaded.done!.answered, loaded.done!.calls)
          : { status: "failed", reason: "step_interrupted" };
      if ("ended" in loaded) return { status: "refused", reason: "run_ended" };
      const { run, transcripts, performed } = loaded;
      // A Source deleted since takes the earlier steps with it, so the Run cannot go on from them.
      if (transcripts.some((transcript) => transcript === null))
        return { status: "refused", reason: "source_deleted" };
      // Checked per step: a Model may stop being offered while the Run is under way (ADR-0018).
      const offered = (await catalog.chatModels()).find(
        (model) => model.key === run.modelKey,
      );
      if (!offered) return { status: "refused", reason: "model_unavailable" };
      const model = modelFor(offered);
      const timeZone = await plan.timeZone(p);
      const context = chatContext(
        run.startedAt,
        timeZone,
        (run.pin?.courses ?? [])
          .map(({ course }) => course)
          .sort((a, b) => a.title.localeCompare(b.title, "de")),
      );
      const previous = run.steps.at(-1);
      // The handles earlier steps gave out, so the model names work and blocks by them across steps.
      const turn = createTurn(
        (previous?.handles as [string, Handled][] | null) ?? [],
      );
      // The Capabilities the Run started with; the gate still decides each call by those the Agent holds now.
      const held = ((run.capabilities as { id: string }[] | null) ?? [])
        .map(({ id }) => id)
        .filter((id): id is CapabilityId => Object.hasOwn(capabilities, id));
      const tools = {
        searchMaterial: searchTool(
          turn,
          reader,
          p,
          { runId },
          "Searches the material of your Courses and returns the best matching passages, each with a tag.",
        ),
        courseFacts: courseFactsTool(turn, {
          reader,
          understanding,
          artifacts,
          p,
          timeZone,
          courses: context.courses,
        }),
        agenda: agendaTool(turn, {
          reader,
          plan,
          p,
          timeZone,
          courses: context.courses,
          agentId: run.agentId ?? undefined,
        }),
        ...actionTools(held),
      };
      const called = (previous?.calls as StoredCall[] | null) ?? [];
      const results: ModelMessage[] = called.length
        ? [
            {
              role: "tool",
              content: called.map((call, i) => ({
                type: "tool-result" as const,
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output: {
                  type: "text" as const,
                  value: resultOf(
                    turn,
                    call,
                    performed.find(
                      (a) => a.key === `${runId}:${n - 1}:${i + 1}`,
                    ) ?? null,
                  ),
                },
              })),
            },
          ]
        : [];
      const input = {
        instructions: run.instructions ?? "",
        messages: [
          {
            role: "user" as const,
            content: `${context.text}\nCarry out your Instructions now.`,
          },
          ...transcripts.flatMap(
            (transcript) => JSON.parse(transcript!) as ModelMessage[],
          ),
          ...results,
        ],
        tools,
        last: n === maxSteps,
      };
      // Claimed before the model call: only one attempt may ever call the model for this step.
      const claimed = await withOwner(
        db,
        p,
        async (tx, studentId) =>
          (
            await tx.runStep.createMany({
              data: [{ runId, n, studentId }],
              skipDuplicates: true,
            })
          ).count === 1,
      );
      if (!claimed) return { status: "failed", reason: "step_interrupted" };
      const release = () =>
        withOwner(db, p, (tx) =>
          tx.runStep.deleteMany({ where: { runId, n, partsContent: null } }),
        );
      const stepped = await retryRateLimited(() =>
        delegation.meter(
          p,
          { microUsd: model.estimateMicroUsd(input) },
          (deadline) =>
            definitely(() => model.step(input, { signal: deadline })),
        ),
      ).catch(async (error: unknown) => {
        // Only a call that certainly cost nothing may be called again; any other failure, such as a timeout after the
        // request was sent, keeps the claim, so the next attempt fails the Run instead of paying twice.
        if (error instanceof DefiniteFailure) await release();
        throw error;
      });
      if (stepped.status === "refused") {
        await release();
        return { status: "refused", reason: stepped.reason };
      }
      // From here the model call completed and is settled: the claim stays, so the step is never called again.
      const refusal = turn.refusal();
      if (refusal) return { status: "refused", reason: refusal };
      if (stepped.value.failure)
        return { status: "failed", reason: "model_ended_early" };
      const parts = stepped.value.toolResults.map(
        (result) =>
          ({
            type: `tool-${result.toolName}`,
            toolCallId: result.toolCallId,
            input: result.input,
            output: result.output,
          }) as RunStepPart,
      );
      // A step's text may restate anything read before it, so it goes with every Source read so far.
      const derivedFrom = [
        ...new Set([...(run.steps.at(-1)?.derivedFrom ?? []), ...turn.sources]),
      ];
      const answered = stepped.value.finishReason === "stop";
      // Read in order, so a block created by one call keeps its handle for the next; an answer acts on nothing.
      const calls: StoredCall[] = [];
      if (!answered)
        for (const call of stepped.value.actionCalls)
          calls.push(await readCall(turn, { plan, p, timeZone }, call));
      const stored = await withOwner(db, p, async (tx) => {
        // Serialised with ending the Run: a step that returns after the Run ended keeps nothing.
        await tx.$executeRaw`SELECT 1 FROM "run" WHERE "id" = ${runId} FOR UPDATE`;
        const current = await tx.run.findUniqueOrThrow({
          where: { id: runId },
          select: { status: true },
        });
        if (current.status !== "running") return "ended" as const;
        const sealedParts = await derived.seal(
          tx,
          `${runId}:${n}:parts`,
          derivedFrom,
          JSON.stringify(parts),
        );
        // The results of the previous step's Actions go with this step's messages, so later steps are given them too.
        const transcript = await derived.seal(
          tx,
          `${runId}:${n}:transcript`,
          derivedFrom,
          JSON.stringify([...results, ...stepped.value.messages]),
        );
        if (!sealedParts || !transcript) return null;
        await tx.runStep.update({
          where: { runId_n: { runId, n } },
          data: {
            answered,
            partsContent: sealedParts.content,
            partsKey: sealedParts.contentKey,
            transcriptContent: transcript.content,
            transcriptKey: transcript.contentKey,
            derivedFrom,
            calls: calls as object[],
            handles: turn.handled(),
          },
        });
        return answered;
      });
      if (stored === "ended") return { status: "refused", reason: "run_ended" };
      if (stored === null)
        return { status: "refused", reason: "source_deleted" };
      return outcome(stored, calls);
    },

    /**
     * Performs step `n`'s Action calls through the gate, in order, each under the key `runId:n:call`, so a repeat
     * returns what the gate recorded and never acts twice. Stops at an Unconfirmed one: only the student resolves it,
     * and the Run acts on nothing after it.
     */
    async act(runId: string, n: number): Promise<{ unconfirmed: boolean }> {
      const p = principal.fromRun(runId);
      const step = await withOwner(db, p, (tx) =>
        tx.runStep.findUniqueOrThrow({
          where: { runId_n: { runId, n } },
          select: { calls: true },
        }),
      );
      for (const [i, call] of (
        (step.calls as StoredCall[] | null) ?? []
      ).entries()) {
        if (!("intent" in call)) continue;
        const outcome = await delegation.perform(p, {
          key: `${runId}:${n}:${i + 1}`,
          intent: intentOf(call),
        });
        if (outcome.status === "unconfirmed") return { unconfirmed: true };
      }
      return { unconfirmed: false };
    },

    /**
     * Ends the student's Run: its status, when it ended, why it did not simply finish, and, when done, the model's
     * final message as its summary, sealed under every Source the Run read. The transcript is dropped. Ending it again,
     * or a Run that was never recorded, changes nothing.
     */
    async finish(
      { runId, studentId }: { runId: string; studentId: string },
      end: RunEnd,
    ) {
      await withOwner(db, principal.fromSession({ studentId }), async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "run" WHERE "id" = ${runId} FOR UPDATE`;
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: {
            steps: {
              where: { partsContent: { not: null } },
              orderBy: { n: "desc" },
              take: 1,
            },
          },
        });
        if (run?.status !== "running") return;
        const last = run.steps[0];
        const transcript =
          end.status === "done" && last?.answered && last.transcriptContent
            ? await derived.open(
                tx,
                `${runId}:${last.n}:transcript`,
                sealedOf(
                  last.transcriptContent,
                  last.transcriptKey,
                  last.derivedFrom,
                ),
              )
            : null;
        const text = transcript
          ? summaryOf(finalText(JSON.parse(transcript)))
          : "";
        const summary = text
          ? await derived.seal(tx, `${runId}:summary`, last!.derivedFrom, text)
          : null;
        await tx.run.update({
          where: { id: runId },
          data: {
            status: end.status,
            endedAt: clock.now(),
            stopReason: end.status === "done" ? null : (end.reason ?? null),
            summaryContent: summary?.content ?? null,
            summaryKey: summary?.contentKey ?? null,
            derivedFrom: summary?.derivedFrom ?? [],
          },
        });
        await tx.runStep.updateMany({
          where: { runId },
          data: { transcriptContent: null, transcriptKey: null },
        });
      });
    },

    /**
     * The Run as the student may see it: status, trigger, start and end, why it stopped, its summary, and each step's
     * tool calls. Null when it is not the student's; the summary and a step's parts are null once a Source they were
     * drawn from is deleted.
     */
    async view(p: Principal, runId: string) {
      return withOwner(db, p, async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: {
            steps: {
              where: { partsContent: { not: null } },
              orderBy: { n: "asc" },
            },
          },
        });
        if (!run?.status) return null;
        const summary = run.summaryContent
          ? await derived.open(
              tx,
              `${runId}:summary`,
              sealedOf(run.summaryContent, run.summaryKey, run.derivedFrom),
            )
          : null;
        return {
          id: run.id,
          status: run.status as RunEnd["status"] | "running",
          trigger: run.trigger as "schedule" | "manual",
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          stopReason: run.stopReason,
          summary,
          steps: await Promise.all(
            run.steps.map(async (step) => {
              const parts = await derived.open(
                tx,
                `${runId}:${step.n}:parts`,
                sealedOf(step.partsContent!, step.partsKey, step.derivedFrom),
              );
              return {
                n: step.n,
                parts:
                  parts === null ? null : (JSON.parse(parts) as RunStepPart[]),
              };
            }),
          ),
        };
      });
    },
  };
}
export type AgentRuns = ReturnType<typeof createAgentRuns>;
