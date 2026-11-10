import { randomUUID } from "node:crypto";
import type { Flashcard, Maker, PracticeItem, Written } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  Delegation,
  Metered,
  Principal,
  Responsibilities,
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
export type ArtifactRequest =
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
    };
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
export type ArtifactSummary = {
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
type Item = {
  id: string;
  topicIds: string[];
  question: string;
  answer: string;
};
type Card = { id: string; topicIds: string[]; front: string; back: string };
/** A practice set's items, a set of flashcards, or a draft's or Critique's text, with citations as `C`. */
type Content<C> =
  | { items: (Item & { citations: C[] })[] }
  | { cards: (Card & { citations: C[] })[] }
  | { text: string; citations: C[] };
/** What the student needs to hand an Obligation in themselves: nothing here is sent anywhere. */
export type HandoffView = {
  obligation: {
    id: string;
    title: string;
    due: { date: string | null; time: string | null; timeZone: string | null };
    /** As the Source states it, or the student's Correction; never verified. */
    destination: string | null;
    reportedSubmittedAt: Date | null;
  };
  /** Its conditions, such as declaring AI use, apply to what is handed in. */
  rule: AiUse;
  /** The student's drafts for it, each at its latest version. */
  drafts: { id: string; version: number; createdAt: Date }[];
};
export type ArtifactView = ArtifactSummary & {
  version: number | null;
  /** Null until made, and once withdrawn. */
  content: Content<{ tag: string; provenance: Provenance | "gone" }> | null;
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
  | { items: PracticeItem[] }
  | { cards: Flashcard[] }
  | { written: Written };
const notHandedIn = ["exam", "registration"];

/** Artifacts: made in Runs the student starts, from material pinned at the start, and shredded with their Sources. */
export function createArtifacts({
  db,
  keys,
  reader,
  facts,
  responsibilities,
  delegation,
  maker,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  reader: KnowledgeReader;
  facts: Facts;
  responsibilities: Responsibilities;
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
                return { value: { cards: value.cards }, usage };
              }
              const { value, usage } = await maker.practiceSet(input, {
                signal,
              });
              return { value: { items: value.items }, usage };
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
          row && (await derived.open(tx, `${artifactId}:${version}`, row));
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
        include: { versions: { orderBy: { version: "desc" } } },
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
          kind: row.kind as ArtifactSummary["kind"],
          status: row.status as ArtifactSummary["status"],
          failure: row.failure,
          topicIds: (row.request as StoredRequest).topicIds ?? [],
          obligationId: (row.request as StoredRequest).obligationId ?? null,
          createdAt: row.createdAt,
          openedAt: row.openedAt,
          withdrawn: Boolean(
            row.versions[0]?.derivedFrom.some((id) => !live.has(id)),
          ),
        } satisfies ArtifactSummary,
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
        artifactId = randomUUID();
      const started = await responsibilities.startStudentRun(student, {
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
          ? { cards: made.value.cards.map(cite) }
          : "items" in made.value
            ? { items: made.value.items.map(cite) }
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
      return (await summaries(student))
        .filter(
          ({ summary, derivedFrom }) =>
            (!q.ready ||
              (summary.status === "ready" &&
                !summary.openedAt &&
                !summary.withdrawn)) &&
            (!q.derivedFrom || derivedFrom.includes(q.derivedFrom)),
        )
        .map(({ summary }) => summary);
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
        const text = await derived.open(
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
      if (rule === "gone") return "gone";
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
        },
        rule,
        drafts,
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
        const text = await derived.open(
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
          (await derived.open(
            tx,
            `${ref.artifactId}:${latest.version}`,
            latest,
          ));
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
          : found.row.versions.find((v) => v.version === version);
      if (version !== undefined && !latest) return "gone";
      const text = await withOwner(db, student, async (tx) => {
        if (found.row.status === "ready" && !found.row.openedAt)
          await tx.artifact.update({
            where: { id: artifactId },
            data: { openedAt: clock.now() },
          });
        return latest
          ? derived.open(tx, `${artifactId}:${latest.version}`, latest)
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
            ? { items: stored.items.map(resolve) }
            : "cards" in stored
              ? { cards: stored.cards.map(resolve) }
              : resolve(stored)),
      };
    },
  };
}
export type Artifacts = ReturnType<typeof createArtifacts>;
