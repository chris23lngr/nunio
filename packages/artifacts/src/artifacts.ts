import { randomUUID } from "node:crypto";
import type { Maker, PracticeInput } from "@nunio/ai";
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

export type ArtifactRequest = {
  kind: "practice_set";
  topicIds: string[];
  /** The material the Run reads, fixed when it starts. */
  from:
    | { chatId: string }
    | { selection: { courseIds: string[]; sourceIds: string[] } };
};
export type ArtifactSummary = {
  id: string;
  kind: "practice_set";
  status: "making" | "ready" | "failed";
  failure: string | null;
  topicIds: string[];
  createdAt: Date;
  openedAt: Date | null;
  /** A Source it was drawn from is deleted, so its content is gone. */
  withdrawn: boolean;
};
export type ArtifactView = ArtifactSummary & {
  version: number | null;
  /** Null until made, and once withdrawn. */
  content: {
    items: {
      id: string;
      topicIds: string[];
      question: string;
      answer: string;
      citations: { tag: string; provenance: Provenance | "gone" }[];
    }[];
  } | null;
};
/** A practice set as sealed: citations are stored as refs, resolved when shown. */
type StoredContent = {
  items: {
    id: string;
    topicIds: string[];
    question: string;
    answer: string;
    citations: Citation[];
  }[];
};

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
  const makePracticeSet = (run: Principal, input: PracticeInput) =>
    delegation.meter(
      run,
      { microUsd: maker.estimateMicroUsd(input) },
      (signal) => definitely(() => maker.practiceSet(input, { signal })),
    );
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
      let made: Awaited<ReturnType<typeof makePracticeSet>>;
      try {
        made = await makePracticeSet(run, input);
      } catch {
        return fail("maker_failed");
      }
      if (made.status !== "ok") return fail(made.reason);
      const content: StoredContent = {
        items: made.value.items.map(({ cited, ...item }) => ({
          ...item,
          citations: cited.flatMap((tag) =>
            citations.filter((citation) => citation.tag === tag),
          ),
        })),
      };
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
    /** Shows an Artifact and marks it opened; a withdrawn one comes back without content. */
    async open(
      student: Principal,
      artifactId: string,
    ): Promise<ArtifactView | "gone"> {
      const [found] = await summaries(student, { id: artifactId });
      if (!found) return "gone";
      const latest = found.row.versions[0];
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
        stored?.items.flatMap((item) => item.citations.map((c) => c.cite)) ??
          [],
      );
      return {
        ...found.summary,
        version: latest?.version ?? null,
        content: stored && {
          items: stored.items.map(({ citations, ...item }) => ({
            ...item,
            citations: citations.map(({ tag, cite }) => ({
              tag,
              provenance: provenance.get(cite) ?? "gone",
            })),
          })),
        },
      };
    },
  };
}
export type Artifacts = ReturnType<typeof createArtifacts>;
