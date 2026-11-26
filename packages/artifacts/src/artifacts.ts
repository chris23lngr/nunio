import { createHash, randomUUID } from "node:crypto";
import type { Flashcard, Maker, PracticeItem, Written } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  Agents,
  CapabilityId,
  Delegation,
  Metered,
  Principal,
} from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type {
  AiUse,
  Citation,
  Facts,
  KnowledgeReader,
  Provenance,
} from "@nunio/knowledge";
import { createDerivedText, definitely } from "@nunio/knowledge";
import { toAnkiTsv } from "./anki.js";

/** The material a Run reads, fixed when it starts. */
type From =
  | { chatId: string }
  | { selection: { courseIds: string[]; sourceIds: string[] } };
export type ArtifactRequest = {
  /** The Artifact's ID, when the caller must point to it before it is made, as a Chat answer does. */
  artifactId?: string;
} & (
  | { from: From; kind: "practice_set"; topicIds: string[] }
  | { from: From; kind: "flashcards"; topicIds: string[] }
  | {
      from: From;
      kind: "draft";
      obligationId: string;
      instructions: string;
      /** The student confirmed a conditional AI-use Rule's conditions for this request. */
      conditionsConfirmed?: true;
    }
  | {
      from: From;
      kind: "critique";
      obligationId: string;
      /** The student's Own Work, or a version of one of their drafts. */
      of: { ownWork: string } | { artifactId: string; version: number };
      conditionsConfirmed?: true;
    }
);
/** Why nunio will not write: drafts and Critiques follow the Obligation's AI-use Rule, and exams get none. */
export type Refusal =
  | "gone"
  | "ai_use_unknown"
  | "ai_use_forbidden"
  | "ai_use_conditions"
  | "not_handed_in";
/** The request as stored: the student's choices and own words, no course material. */
type StoredRequest = {
  topicIds?: string[];
  obligationId?: string;
  instructions?: string;
  of?: { ownWork: string } | { artifactId: string; version: number };
  conditionsConfirmed?: true;
};
type ArtifactBase = {
  id: string;
  kind: ArtifactRequest["kind"];
  status: "making" | "ready" | "failed";
  failure: string | null;
  topicIds: string[];
  obligationId: string | null;
  createdAt: Date;
  openedAt: Date | null;
  /** A Source it was drawn from is deleted, so its content is gone. */
  withdrawn: boolean;
};
/** An Artifact as listed: named and counted from its latest version, so the student can tell them apart. */
export type ArtifactSummary = ArtifactBase & {
  /** Its own title, else its Obligation's or its Topics' names; null when none is known. */
  title: string | null;
  /** The Course of its Obligation or Topics. */
  courseId: string | null;
  /** Its items or cards; null for a text, and until made or once withdrawn. */
  count: number | null;
  /** Its latest version and when it was made; null until made. */
  version: number | null;
  updatedAt: Date | null;
  /** When the student last answered one of its Practice Items. */
  lastPractisedAt: Date | null;
};
type Item = {
  id: string;
  topicIds: string[];
  question: string;
  answer: string;
};
type Card = { id: string; topicIds: string[]; front: string; back: string };
/** A practice set's title and items, a set of flashcards, or a draft's or Critique's text, with citations as `C`. */
type Content<C> =
  | { title: string | null; items: (Item & { citations: C[] })[] }
  | { title?: string | null; cards: (Card & { citations: C[] })[] }
  | { text: string; citations: C[] };
type EmailDestinations = Exclude<
  Awaited<ReturnType<Facts["emailDestination"]>>,
  "gone"
>;
/** What the student needs to hand an Obligation in themselves: nothing here is sent anywhere. */
export type HandoffView = {
  obligation: {
    id: string;
    title: string;
    due: { date: string | null; time: string | null; timeZone: string | null };
    /** As the Source states it, or the student's Correction; never verified. */
    destination: string | null;
    reportedSubmittedAt: Date | null;
    /** The confirmed email Destination that applies: the Obligation's own, else its Course's default. */
    emailDestination: EmailDestinations["destination"];
    /** An address found in the Destination wording or the Correction, for the student to confirm. */
    emailPrefill: EmailDestinations["prefill"];
  };
  /** Its conditions, such as declaring AI use, apply to what is handed in. */
  rule: AiUse;
  /** The student's drafts for it, each at its latest version. */
  drafts: { id: string; version: number; createdAt: Date }[];
  /** A mail draft to the email Destination; the student attaches the file and sends it themselves. */
  mailto: string | null;
};
export type ArtifactView = ArtifactBase & {
  version: number | null;
  /** Null until made, and once withdrawn. */
  content: Content<{ tag: string; provenance: Provenance | "gone" }> | null;
};
/** A `mailto:` link with nunio's template subject and body (RFC 6068). */
const mailto = (address: string, title: string) => {
  const body = `Guten Tag,\r\n\r\nanbei meine Abgabe zu „${title}“.\r\n\r\nViele Grüße`;
  return `mailto:${encodeURIComponent(address).replace("%40", "@")}?subject=${encodeURIComponent(`Abgabe: ${title}`)}&body=${encodeURIComponent(body)}`;
};
/** As sealed: citations are stored as refs, resolved when shown. */
type StoredContent = Content<Citation>;
const rowsOf = <C>(content: Content<C>) =>
  "items" in content ? content.items : "cards" in content ? content.cards : [];
const citationsOf = <C>(content: Content<C>) =>
  "text" in content
    ? content.citations
    : rowsOf(content).flatMap((row) => row.citations);
/** What the Maker returns for each kind. */
type Made =
  | { title: string; items: PracticeItem[] }
  | { title: string; cards: Flashcard[] }
  | { written: Written };
const notHandedIn = ["exam", "registration"];
/** A UUID that is always the same for the same key, so a repeated start finds what the first one recorded. */
function idOf(key: string) {
  const hex = createHash("sha256").update(key).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Artifacts: made in Runs the student starts, from material pinned at the start, and shredded with their Sources. */
export function createArtifacts({
  db,
  keys,
  reader,
  facts,
  agents,
  delegation,
  maker,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  reader: KnowledgeReader;
  facts: Facts;
  agents: Agents;
  delegation: Delegation;
  maker: Maker;
  clock: { now(): Date };
}) {
  const derived = createDerivedText(keys);
  /**
   * Whether nunio may draft or critique for this Obligation: one the student has, that is handed in, and whose AI-use
   * Rule allows it, a conditional one only once the student confirmed its conditions.
   */
  async function mayWrite(
    p: Principal,
    obligationId: string,
    conditionsConfirmed: boolean,
  ): Promise<
    | { refused: Refusal }
    | {
        obligation: { title: string; courseId: string };
        rule: Exclude<AiUse, { status: "unknown" }>;
      }
  > {
    const obligation = (await facts.review(p)).courses
      .filter((course) => course.status !== "rejected")
      .flatMap((course) =>
        course.obligations
          .filter((o) => o.state !== "rejected")
          .map((o) => ({ ...o, courseId: course.id })),
      )
      .find((o) => o.id === obligationId);
    if (!obligation) return { refused: "gone" };
    if (notHandedIn.includes(obligation.kind))
      return { refused: "not_handed_in" };
    const rule = await facts.aiUse(p, obligationId);
    if (rule === "gone") return { refused: "gone" };
    if (rule.status === "unknown") return { refused: "ai_use_unknown" };
    if (rule.status === "forbidden") return { refused: "ai_use_forbidden" };
    if (rule.status === "conditional" && !conditionsConfirmed)
      return { refused: "ai_use_conditions" };
    return { obligation, rule };
  }
  /**
   * What a Run reads and asks the Maker for, per kind: the passages to retrieve, any further Sources its content
   * derives from, and the call, given the rendered material.
   */
  async function planOf(
    run: Principal,
    artifact: { id: string; kind: string; request: unknown },
  ): Promise<
    | { failure: string }
    | {
        query: string;
        courseIds: string[];
        alsoFrom: string[];
        call: (
          data: string,
          tags: string[],
        ) => {
          estimate: number;
          make: (signal: AbortSignal) => Promise<{
            value: Made;
            usage: { microUsd: number };
          }>;
        };
      }
  > {
    const request = artifact.request as StoredRequest;
    if (artifact.kind === "practice_set" || artifact.kind === "flashcards") {
      const topics = await topicsOf(run, request.topicIds ?? []);
      if (!topics) return { failure: "gone" };
      return {
        query: topics.map((topic) => topic.name).join("; "),
        courseIds: [...new Set(topics.map((topic) => topic.courseId))],
        alsoFrom: [],
        call: (data, tags) => {
          const input = {
            topics: topics.map(({ id, name }) => ({ id, name })),
            data,
            tags,
          };
          return {
            estimate: maker.estimateMicroUsd(input),
            make: async (signal) => {
              if (artifact.kind === "flashcards") {
                const { value, usage } = await maker.flashcards(input, {
                  signal,
                });
                return {
                  value: { title: value.title, cards: value.cards },
                  usage,
                };
              }
              const { value, usage } = await maker.practiceSet(input, {
                signal,
              });
              return {
                value: { title: value.title, items: value.items },
                usage,
              };
            },
          };
        },
      };
    }
    // A rule that changed since the request fails the Run.
    const allowed = await mayWrite(
      run,
      request.obligationId!,
      Boolean(request.conditionsConfirmed),
    );
    if ("refused" in allowed) return { failure: allowed.refused };
    const { obligation, rule } = allowed;
    let work: { text: string; derivedFrom: string[] } | null = null;
    if (request.of && "ownWork" in request.of)
      work = { text: request.of.ownWork, derivedFrom: [] };
    else if (request.of) {
      const { artifactId, version } = request.of;
      work = await withOwner(db, run, async (tx) => {
        const row = await tx.artifactVersion.findUnique({
          where: { artifactId_version: { artifactId, version } },
        });
        const text =
          row && (await derived.open(tx, `${artifactId}:${version}`, row)).text;
        const stored = text && (JSON.parse(text) as StoredContent);
        return row && stored && "text" in stored
          ? { text: stored.text, derivedFrom: row.derivedFrom }
          : null;
      });
      if (!work) return { failure: "gone" };
    }
    return {
      query: obligation.title,
      courseIds: [obligation.courseId],
      alsoFrom: work?.derivedFrom ?? [],
      call: (data, tags) => {
        const shared = {
          obligation: obligation.title,
          rule: rule.text,
          data,
          tags,
        };
        if (!work) {
          const input = { ...shared, instructions: request.instructions ?? "" };
          return {
            estimate: maker.estimateMicroUsd(input),
            make: async (signal) => {
              const { value, usage } = await maker.draft(input, { signal });
              return { value: { written: value }, usage };
            },
          };
        }
        const input = { ...shared, work: work.text };
        return {
          estimate: maker.estimateMicroUsd(input),
          make: async (signal) => {
            const { value, usage } = await maker.critique(input, { signal });
            return { value: { written: value }, usage };
          },
        };
      },
    };
  }
  /** The student's own Topics that are not rejected, with names and Courses; null when any of them is not. */
  async function topicsOf(p: Principal, ids: string[]) {
    const found = (await facts.review(p)).courses
      .filter((course) => course.status !== "rejected")
      .flatMap((course) =>
        course.facts
          .filter(
            (fact) =>
              fact.type === "topic" &&
              fact.state !== "rejected" &&
              ids.includes(fact.id),
          )
          .map((fact) => ({
            id: fact.id,
            name: fact.value,
            courseId: course.id,
          })),
      );
    return found.length === new Set(ids).size ? found : null;
  }
  async function summaries(p: Principal, where: { id?: string } = {}) {
    return withOwner(db, p, async (tx) => {
      const rows = await tx.artifact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      const derivedFrom = [
        ...new Set(rows.flatMap((row) => row.versions[0]?.derivedFrom ?? [])),
      ];
      const live = new Set(
        (
          await tx.source.findMany({
            where: { id: { in: derivedFrom }, deletedAt: null },
            select: { id: true },
          })
        ).map((source) => source.id),
      );
      return rows.map((row) => ({
        row,
        derivedFrom: row.versions[0]?.derivedFrom ?? [],
        summary: {
          id: row.id,
          kind: row.kind as ArtifactBase["kind"],
          status: row.status as ArtifactBase["status"],
          failure: row.failure,
          topicIds: (row.request as StoredRequest).topicIds ?? [],
          obligationId: (row.request as StoredRequest).obligationId ?? null,
          createdAt: row.createdAt,
          openedAt: row.openedAt,
          withdrawn: Boolean(
            row.versions[0]?.derivedFrom.some((id) => !live.has(id)),
          ),
        } satisfies ArtifactBase,
      }));
    });
  }
  return {
    /** Checks the request, then starts and pins its Run; the caller starts the Run's workflow, which calls `make`. */
    async request(
      student: Principal,
      req: ArtifactRequest,
    ): Promise<
      | { status: "started"; artifactId: string; runId: string }
      | { status: "refused"; reason: Refusal }
    > {
      let stored: StoredRequest;
      if (req.kind === "practice_set" || req.kind === "flashcards") {
        if (!(await topicsOf(student, req.topicIds)))
          return { status: "refused", reason: "gone" };
        stored = { topicIds: req.topicIds };
      } else {
        const allowed = await mayWrite(
          student,
          req.obligationId,
          Boolean(req.conditionsConfirmed),
        );
        if ("refused" in allowed)
          return { status: "refused", reason: allowed.refused };
        if (req.kind === "critique" && "artifactId" in req.of) {
          const { artifactId, version } = req.of;
          const draft = await withOwner(db, student, (tx) =>
            tx.artifactVersion.findFirst({
              where: { artifactId, version, artifact: { kind: "draft" } },
            }),
          );
          if (!draft) return { status: "refused", reason: "gone" };
        }
        stored = {
          obligationId: req.obligationId,
          ...(req.kind === "draft"
            ? { instructions: req.instructions }
            : { of: req.of }),
          ...(req.conditionsConfirmed ? { conditionsConfirmed: true } : {}),
        };
      }
      const runId = randomUUID(),
        artifactId = req.artifactId ?? randomUUID();
      const started = await agents.startStudentRun(student, {
        runId,
        workflowId: `artifactRun/${runId}`,
        ...("chatId" in req.from ? { chatId: req.from.chatId } : {}),
      });
      if (
        started.status !== "ok" ||
        (await reader.pin(student, { runId, from: req.from })).status !== "ok"
      )
        return { status: "refused", reason: "gone" };
      await withOwner(db, student, (tx, studentId) =>
        tx.artifact.create({
          data: {
            id: artifactId,
            studentId,
            kind: req.kind,
            runId,
            request: stored,
          },
        }),
      );
      return { status: "started", artifactId, runId };
    },
    /**
     * Starts the Artifact Run an Agent's Run asks for with call `key`, under one of its Capabilities: flashcards or a
     * practice set for Topics of the Agent's current, accepted, unarchived Courses only, at most one per Run
     * (ADR-0026), its cost charged to that Run. Pins the Topics' Courses; the caller starts the Artifact Run's
     * workflow, which calls `make`. Idempotent on `key`: once its Artifact Run is recorded, a repeat finishes starting
     * it, whatever changed since.
     */
    async startFromRun(
      agentRunId: string,
      req: {
        key: string;
        capability: CapabilityId;
        kind: "flashcards" | "practice_set";
        topicIds: string[];
      },
    ): Promise<
      | { status: "started"; artifactId: string; runId: string }
      | {
          status: "refused";
          reason:
            | "gone"
            | "run_ended"
            | "paused"
            | "ended"
            | "no_capability"
            | "out_of_scope"
            | "run_cap";
        }
    > {
      const runId = idOf(`${req.key}:run`),
        artifactId = idOf(`${req.key}:artifact`);
      const { studentId, recorded, courseIds } = await withOwner(
        db,
        principal.fromRun(agentRunId),
        async (tx, studentId) => ({
          studentId,
          recorded:
            (await tx.run.findUnique({ where: { id: runId } })) !== null,
          // The Topics' Courses as stored, whatever became of the Topics since.
          courseIds: [
            ...new Set(
              (
                await tx.fact.findMany({
                  where: { id: { in: req.topicIds }, type: "topic" },
                  select: { courseId: true },
                })
              ).map((fact) => fact.courseId),
            ),
          ],
        }),
      );
      const student = principal.fromSession({ studentId });
      if (!recorded) {
        if (!(await topicsOf(student, req.topicIds)))
          return { status: "refused", reason: "gone" };
        const started = await agents.startArtifactRun(agentRunId, {
          runId,
          workflowId: `artifactRun/${runId}`,
          capability: req.capability,
          courseIds,
        });
        if (started.status !== "ok") return started;
      }
      const selection = { courseIds, sourceIds: [] };
      if (
        (await reader.pin(student, { runId, from: { selection } })).status !==
        "ok"
      )
        return { status: "refused", reason: "gone" };
      await withOwner(db, student, (tx) =>
        tx.artifact.createMany({
          data: [
            {
              id: artifactId,
              studentId,
              kind: req.kind,
              runId,
              request: { topicIds: req.topicIds } satisfies StoredRequest,
            },
          ],
          skipDuplicates: true,
        }),
      );
      return { status: "started", artifactId, runId };
    },
    /** The Run's one step: makes the Artifact from its pinned material and stores version 1. */
    async make(runId: string): Promise<"ready" | "failed"> {
      const run = principal.fromRun(runId);
      const artifact = await withOwner(db, run, (tx) =>
        tx.artifact.findUniqueOrThrow({ where: { runId } }),
      );
      if (artifact.status !== "making")
        return artifact.status as "ready" | "failed";
      // A single attempt: a model call that failed may already have cost money, so the student asks again instead.
      const fail = async (failure: string) => {
        await withOwner(db, run, (tx) =>
          tx.artifact.update({
            where: { id: artifact.id },
            data: { status: "failed", failure },
          }),
        );
        // Metering this Run, its query or its Maker call, Paused the Agent whose Run started it, in the worker, where
        // nothing pauses its Schedule.
        if (failure === "budget_exhausted") {
          const agentId = await withOwner(
            db,
            run,
            async (tx) =>
              (
                await tx.run.findUnique({
                  where: { id: runId },
                  select: { startedBy: { select: { agentId: true } } },
                })
              )?.startedBy?.agentId,
          );
          if (agentId) await agents.syncBudgetPause(run, agentId);
        }
        return "failed" as const;
      };
      const plan = await planOf(run, artifact);
      if ("failure" in plan) return fail(plan.failure);
      const retrieval = await reader.retrieve(
        run,
        { runId },
        {
          kind: "passages",
          text: plan.query,
          narrow: { courseIds: plan.courseIds },
        },
      );
      if (retrieval.status !== "ok") return fail(retrieval.reason);
      if (!retrieval.items.length) return fail("no_material");
      const { data, citations } = retrieval.render();
      const call = plan.call(
        data,
        citations.map((citation) => citation.tag),
      );
      let made: Metered<Made>;
      try {
        made = await delegation.meter<Made>(
          run,
          { microUsd: call.estimate },
          (signal) => definitely(() => call.make(signal)),
        );
      } catch {
        return fail("maker_failed");
      }
      if (made.status !== "ok") return fail(made.reason);
      const cite = <R extends { cited: string[] }>({ cited, ...row }: R) => ({
        ...row,
        citations: cited.flatMap((tag) =>
          citations.filter((citation) => citation.tag === tag),
        ),
      });
      const content: StoredContent =
        "cards" in made.value
          ? { title: made.value.title, cards: made.value.cards.map(cite) }
          : "items" in made.value
            ? {
                title: made.value.title,
                items: made.value.items.map(cite),
              }
            : cite(made.value.written);
      const derivedFrom = [
        ...new Set([
          ...retrieval.items.flatMap((item) =>
            item.provenance.kind === "source" ? [item.provenance.sourceId] : [],
          ),
          ...plan.alsoFrom,
        ]),
      ];
      const stored = await withOwner(db, run, async (tx, studentId) => {
        const sealed = await derived.seal(
          tx,
          `${artifact.id}:1`,
          derivedFrom,
          JSON.stringify(content),
        );
        // A Source deleted while making takes the practice set with it.
        if (!sealed) return false;
        await tx.artifactVersion.create({
          data: { artifactId: artifact.id, studentId, version: 1, ...sealed },
        });
        await tx.artifact.update({
          where: { id: artifact.id },
          data: { status: "ready" },
        });
        return true;
      });
      return stored ? "ready" : fail("gone");
    },
    /**
     * The student's Artifacts, newest first. Ready means finished, not yet opened and not withdrawn; `derivedFrom`
     * names a Source, giving what deleting it would withdraw.
     */
    async list(
      student: Principal,
      q: { ready?: true; derivedFrom?: string },
    ): Promise<ArtifactSummary[]> {
      const found = (await summaries(student)).filter(
        ({ summary, derivedFrom }) =>
          (!q.ready ||
            (summary.status === "ready" &&
              !summary.openedAt &&
              !summary.withdrawn)) &&
          (!q.derivedFrom || derivedFrom.includes(q.derivedFrom)),
      );
      const courses = (await facts.review(student)).courses;
      const topics = new Map(
        courses.flatMap((course) =>
          course.facts
            .filter((fact) => fact.type === "topic")
            .map((fact) => [
              fact.id,
              { name: fact.value, courseId: course.id },
            ]),
        ),
      );
      const obligations = new Map(
        courses.flatMap((course) =>
          course.obligations.map((o) => [
            o.id,
            { name: o.title, courseId: course.id },
          ]),
        ),
      );
      return withOwner(db, student, async (tx) => {
        const practised = new Map(
          (
            await tx.practiceAttempt.groupBy({
              by: ["artifactId"],
              where: { artifactId: { in: found.map(({ row }) => row.id) } },
              _max: { createdAt: true },
            })
          ).map((group) => [group.artifactId, group._max.createdAt]),
        );
        return Promise.all(
          found.map(async ({ row, summary }) => {
            const [latest] = row.versions;
            // A withdrawn one cannot be read; its Sources' keys are gone.
            const text =
              latest && !summary.withdrawn
                ? (
                    await derived.open(
                      tx,
                      `${row.id}:${latest.version}`,
                      latest,
                    )
                  ).text
                : null;
            const stored = text ? (JSON.parse(text) as StoredContent) : null;
            const named = summary.obligationId
              ? [obligations.get(summary.obligationId)]
              : summary.topicIds.map((id) => topics.get(id));
            const known = named.filter((n) => n !== undefined);
            return {
              ...summary,
              title:
                (stored && "title" in stored ? stored.title : null) ??
                (known.length
                  ? new Intl.ListFormat("de", { type: "conjunction" }).format(
                      known.map((n) => n.name),
                    )
                  : null),
              courseId: known[0]?.courseId ?? null,
              count:
                stored && !("text" in stored) ? rowsOf(stored).length : null,
              version: latest?.version ?? null,
              updatedAt: latest?.createdAt ?? null,
              lastPractisedAt: practised.get(row.id) ?? null,
            };
          }),
        );
      });
    },
    /**
     * The student's edit of a set of flashcards or a draft, kept as a new version sealed under the same Sources. A
     * card keeps its ID, and so its Anki GUID; a card without one is new. A draft keeps the citations its text still
     * uses. Practice sets and Critiques cannot be edited.
     */
    async edit(
      student: Principal,
      artifactId: string,
      edit: {
        baseVersion: number;
        content:
          | { cards: { id?: string; front: string; back: string }[] }
          | { text: string };
      },
    ): Promise<
      | { status: "ok"; version: number }
      | { status: "stale" | "withdrawn" | "not_editable" | "gone" }
    > {
      return withOwner(db, student, async (tx, studentId) => {
        const artifact = await tx.artifact.findUnique({
          where: { id: artifactId },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        if (!artifact) return { status: "gone" };
        const editable =
          (artifact.kind === "flashcards" && "cards" in edit.content) ||
          (artifact.kind === "draft" && "text" in edit.content);
        if (!editable) return { status: "not_editable" };
        const [latest] = artifact.versions;
        if (latest?.version !== edit.baseVersion) return { status: "stale" };
        const { text } = await derived.open(
          tx,
          `${artifactId}:${latest.version}`,
          latest,
        );
        if (!text) return { status: "withdrawn" };
        const stored = JSON.parse(text) as StoredContent;
        let content: StoredContent;
        if ("text" in edit.content) {
          const edited = edit.content.text;
          // A citation whose tag the student removed would point at material the text no longer uses.
          content = {
            text: edited,
            citations: citationsOf(stored).filter(({ tag }) =>
              edited.includes(`[${tag}]`),
            ),
          };
        } else {
          const base = rowsOf(stored);
          let next = Math.max(0, ...base.map((card) => Number(card.id)));
          const topicIds = (artifact.request as StoredRequest).topicIds ?? [];
          content = {
            ...("title" in stored ? { title: stored.title } : {}),
            cards: edit.content.cards.map((card) => {
              const kept = base.find((row) => row.id === card.id);
              return {
                id: kept ? kept.id : String(++next),
                topicIds: kept?.topicIds ?? topicIds,
                front: card.front,
                back: card.back,
                citations: kept?.citations ?? [],
              };
            }),
          };
        }
        const version = latest.version + 1;
        const sealed = await derived.seal(
          tx,
          `${artifactId}:${version}`,
          latest.derivedFrom,
          JSON.stringify(content),
        );
        if (!sealed) return { status: "withdrawn" };
        // A concurrent edit of the same base took this version first.
        const { count } = await tx.artifactVersion.createMany({
          data: [{ artifactId, studentId, version, ...sealed }],
          skipDuplicates: true,
        });
        return count ? { status: "ok", version } : { status: "stale" };
      });
    },
    /**
     * A Handoff: the Obligation's Destination wording, its AI-use Rule, and the drafts to choose from. The student
     * hands it in and reports it through `facts.reportSubmitted`. Exams and registrations have none.
     */
    async handoff(
      student: Principal,
      obligationId: string,
    ): Promise<HandoffView | "gone" | "not_handed_in"> {
      const obligation = (await facts.review(student)).courses
        .filter((course) => course.status !== "rejected")
        .flatMap((course) => course.obligations)
        .find((o) => o.id === obligationId && o.state !== "rejected");
      if (!obligation) return "gone";
      if (notHandedIn.includes(obligation.kind)) return "not_handed_in";
      const rule = await facts.aiUse(student, obligationId);
      const email = await facts.emailDestination(student, obligationId);
      if (rule === "gone" || email === "gone") return "gone";
      const drafts = (await summaries(student))
        .filter(
          ({ summary }) =>
            summary.kind === "draft" &&
            summary.obligationId === obligationId &&
            summary.status === "ready" &&
            !summary.withdrawn,
        )
        .map(({ row, summary }) => ({
          id: summary.id,
          version: row.versions[0]!.version,
          createdAt: summary.createdAt,
        }));
      const { date, time, timeZone } = obligation.due;
      return {
        obligation: {
          id: obligation.id,
          title: obligation.title,
          due: { date, time, timeZone },
          destination: obligation.destination,
          reportedSubmittedAt: obligation.reportedSubmittedAt,
          emailDestination: email.destination,
          emailPrefill: email.prefill,
        },
        rule,
        drafts,
        mailto:
          email.destination &&
          mailto(email.destination.address, obligation.title),
      };
    },
    /** The latest version of a set of flashcards as an Anki text file, its cards tagged with their Topics' names. */
    async exportFlashcards(
      student: Principal,
      artifactId: string,
    ): Promise<{ filename: string; tsv: string } | "gone"> {
      const found = await withOwner(db, student, async (tx) => {
        const artifact = await tx.artifact.findUnique({
          where: { id: artifactId },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        const [latest] = artifact?.versions ?? [];
        if (artifact?.kind !== "flashcards" || !latest) return null;
        const { text } = await derived.open(
          tx,
          `${artifactId}:${latest.version}`,
          latest,
        );
        return text && { artifact, stored: JSON.parse(text) as StoredContent };
      });
      if (!found || !("cards" in found.stored)) return "gone";
      const names = new Map(
        (await facts.review(student)).courses.flatMap((course) =>
          course.facts.map((fact) => [fact.id, fact.value] as const),
        ),
      );
      return {
        filename: `nunio-flashcards-${found.artifact.createdAt.toISOString().slice(0, 10)}.tsv`,
        tsv: toAnkiTsv(
          artifactId,
          found.stored.cards.map((card) => ({
            id: card.id,
            front: card.front,
            back: card.back,
            tags: card.topicIds.flatMap((id) => names.get(id) ?? []),
          })),
        ),
      };
    },
    /** For `understanding` only: whether the Artifact is the student's, without marking it opened. */
    async owns(student: Principal, artifactId: string): Promise<boolean> {
      const found = await withOwner(db, student, (tx) =>
        tx.artifact.findUnique({
          where: { id: artifactId },
          select: { id: true },
        }),
      );
      return found !== null;
    },
    /**
     * For `understanding` only: one Practice Item with what grading needs, without marking the Artifact opened.
     * "gone" for another student's, a withdrawn set, flashcards, or an unknown item.
     */
    async practiceItem(
      student: Principal,
      ref: { artifactId: string; itemId: string },
    ): Promise<
      | {
          topicIds: string[];
          question: string;
          answer: string;
          citations: Citation[];
          /** Feedback on it is sealed under the same Sources. */
          derivedFrom: string[];
        }
      | "gone"
    > {
      const found = await withOwner(db, student, async (tx) => {
        const latest = await tx.artifactVersion.findFirst({
          where: { artifactId: ref.artifactId },
          orderBy: { version: "desc" },
        });
        const text =
          latest &&
          (
            await derived.open(
              tx,
              `${ref.artifactId}:${latest.version}`,
              latest,
            )
          ).text;
        return text && latest
          ? { stored: JSON.parse(text) as StoredContent, latest }
          : null;
      });
      // Flashcards hold no Practice Items: nothing grades them.
      const item =
        found && "items" in found.stored
          ? found.stored.items.find((i) => i.id === ref.itemId)
          : undefined;
      if (!found || !item) return "gone";
      return {
        topicIds: item.topicIds,
        question: item.question,
        answer: item.answer,
        citations: item.citations,
        derivedFrom: found.latest.derivedFrom,
      };
    },
    /** Shows an Artifact, its latest version unless one is named, and marks it opened; a withdrawn one has no content. */
    async open(
      student: Principal,
      artifactId: string,
      version?: number,
    ): Promise<ArtifactView | "gone"> {
      const [found] = await summaries(student, { id: artifactId });
      if (!found) return "gone";
      const latest =
        version === undefined
          ? found.row.versions[0]
          : await withOwner(db, student, (tx) =>
              tx.artifactVersion.findUnique({
                where: { artifactId_version: { artifactId, version } },
              }),
            );
      if (version !== undefined && !latest) return "gone";
      const text = await withOwner(db, student, async (tx) => {
        if (found.row.status === "ready" && !found.row.openedAt)
          await tx.artifact.update({
            where: { id: artifactId },
            data: { openedAt: clock.now() },
          });
        return latest
          ? (await derived.open(tx, `${artifactId}:${latest.version}`, latest))
              .text
          : null;
      });
      const stored = text ? (JSON.parse(text) as StoredContent) : null;
      const provenance = await reader.cite(
        student,
        stored ? citationsOf(stored).map((c) => c.cite) : [],
      );
      const resolve = <R extends { citations: Citation[] }>({
        citations,
        ...row
      }: R) => ({
        ...row,
        citations: citations.map(({ tag, cite }) => ({
          tag,
          provenance: provenance.get(cite) ?? ("gone" as const),
        })),
      });
      return {
        ...found.summary,
        version: latest?.version ?? null,
        content:
          stored &&
          ("items" in stored
            ? {
                // Practice sets made before titles have none.
                title: stored.title ?? null,
                items: stored.items.map(resolve),
              }
            : "cards" in stored
              ? {
                  // Flashcards made before titles have none.
                  title: stored.title ?? null,
                  cards: stored.cards.map(resolve),
                }
              : resolve(stored)),
      };
    },
  };
}
export type Artifacts = ReturnType<typeof createArtifacts>;
