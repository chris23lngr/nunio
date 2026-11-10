import { randomUUID } from "node:crypto";
import type { Flashcard, Maker, PracticeInput, PracticeItem } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  Delegation,
  Principal,
  Responsibilities,
} from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type {
  Citation,
  Facts,
  KnowledgeReader,
  Provenance,
} from "@nunio/knowledge";
import { createDerivedText, definitely } from "@nunio/knowledge";
import { toAnkiTsv } from "./anki.js";

export type ArtifactRequest = {
  kind: "practice_set" | "flashcards";
  topicIds: string[];
  /** The material the Run reads, fixed when it starts. */
  from:
    | { chatId: string }
    | { selection: { courseIds: string[]; sourceIds: string[] } };
};
export type ArtifactSummary = {
  id: string;
  kind: ArtifactRequest["kind"];
  status: "making" | "ready" | "failed";
  failure: string | null;
  topicIds: string[];
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
/** A practice set's items or a set of flashcards, with citations as `C`. */
type Content<C> =
  | { items: (Item & { citations: C[] })[] }
  | { cards: (Card & { citations: C[] })[] };
export type ArtifactView = ArtifactSummary & {
  version: number | null;
  /** Null until made, and once withdrawn. */
  content: Content<{ tag: string; provenance: Provenance | "gone" }> | null;
};
/** As sealed: citations are stored as refs, resolved when shown. */
type StoredContent = Content<Citation>;
const rowsOf = <C>(content: Content<C>) =>
  "items" in content ? content.items : content.cards;

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
  /** Asks the Maker for the kind's rows, metered against the Run. */
  async function makeRows(
    kind: ArtifactRequest["kind"],
    run: Principal,
    input: PracticeInput,
  ) {
    return delegation.meter<{ items: PracticeItem[] } | { cards: Flashcard[] }>(
      run,
      { microUsd: maker.estimateMicroUsd(input) },
      async (signal) => {
        if (kind === "flashcards") {
          const { value, usage } = await definitely(() =>
            maker.flashcards(input, { signal }),
          );
          return { value: { cards: value.cards }, usage };
        }
        const { value, usage } = await definitely(() =>
          maker.practiceSet(input, { signal }),
        );
        return { value: { items: value.items }, usage };
      },
    );
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
          topicIds: (row.request as { topicIds: string[] }).topicIds,
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
      | { status: "refused"; reason: "gone" }
    > {
      if (!(await topicsOf(student, req.topicIds)))
        return { status: "refused", reason: "gone" };
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
            request: { topicIds: req.topicIds },
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
      const topics = await topicsOf(
        run,
        (artifact.request as { topicIds: string[] }).topicIds,
      );
      if (!topics) return fail("gone");
      const retrieval = await reader.retrieve(
        run,
        { runId },
        {
          kind: "passages",
          text: topics.map((topic) => topic.name).join("; "),
          narrow: {
            courseIds: [...new Set(topics.map((topic) => topic.courseId))],
          },
        },
      );
      if (retrieval.status !== "ok") return fail(retrieval.reason);
      if (!retrieval.items.length) return fail("no_material");
      const { data, citations } = retrieval.render();
      const input = {
        topics: topics.map(({ id, name }) => ({ id, name })),
        data,
        tags: citations.map((citation) => citation.tag),
      };
      let made: Awaited<ReturnType<typeof makeRows>>;
      try {
        made = await makeRows(
          artifact.kind as ArtifactRequest["kind"],
          run,
          input,
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
          : { items: made.value.items.map(cite) };
      const derivedFrom = [
        ...new Set(
          retrieval.items.flatMap((item) =>
            item.provenance.kind === "source" ? [item.provenance.sourceId] : [],
          ),
        ),
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
     * The student's edit of a set of flashcards, kept as a new version sealed under the same Sources. A card keeps
     * its ID, and so its Anki GUID; a card without one is new. Practice sets cannot be edited.
     */
    async edit(
      student: Principal,
      artifactId: string,
      edit: {
        baseVersion: number;
        content: { cards: { id?: string; front: string; back: string }[] };
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
        if (artifact.kind !== "flashcards") return { status: "not_editable" };
        const [latest] = artifact.versions;
        if (latest?.version !== edit.baseVersion) return { status: "stale" };
        const text = await derived.open(
          tx,
          `${artifactId}:${latest.version}`,
          latest,
        );
        if (!text) return { status: "withdrawn" };
        const base = rowsOf(JSON.parse(text) as StoredContent);
        let next = Math.max(0, ...base.map((card) => Number(card.id)));
        const topicIds = (artifact.request as { topicIds: string[] }).topicIds;
        const cards = edit.content.cards.map((card) => {
          const kept = base.find((row) => row.id === card.id);
          return {
            id: kept ? kept.id : String(++next),
            topicIds: kept?.topicIds ?? topicIds,
            front: card.front,
            back: card.back,
            citations: kept?.citations ?? [],
          };
        });
        const version = latest.version + 1;
        const sealed = await derived.seal(
          tx,
          `${artifactId}:${version}`,
          latest.derivedFrom,
          JSON.stringify({ cards } satisfies StoredContent),
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
        stored
          ? rowsOf(stored).flatMap((row) => row.citations.map((c) => c.cite))
          : [],
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
            : { cards: stored.cards.map(resolve) }),
      };
    },
  };
}
export type Artifacts = ReturnType<typeof createArtifacts>;
