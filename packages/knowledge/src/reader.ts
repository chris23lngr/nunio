import { isDefiniteFailure, SourceModelRejected, type Embedder } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { DefiniteFailure, withOwner, type Delegation, type Metered, type Principal } from "@nunio/delegation";
import { decryptSourceText, type SourceKeys } from "@nunio/keys";
import { createFacts } from "./facts.js";
import { renderData, Untrusted } from "./untrusted.js";

/** A reference, not authority: the owner and selection are resolved server-side on every call. Runs arrive in Phase 9. */
export type ScopeRef = { chatId: string } | { planning: true };
/** A programmer error: the query can never be valid for its scope. Do not retry. */
export class InvalidQueryError extends Error { override name = "InvalidQueryError"; }
/** The Plan spans every Course, so planning sees their Facts; course content always stays under explicit selection. */
const planningTypes: readonly FactType[] = ["obligation", "course_rule", "topic"];
/** Intersected with the selection, never unioned. Projects arrive in Phase 8. */
export type Narrow = { courseIds?: string[]; sourceIds?: string[] };
/** Fixed Events arrive with planning in Phase 8. */
export type FactType = "obligation" | "topic" | "course_rule" | "exam_logistics";
export type Query =
  | { kind: "passages"; text: string; limit?: number; narrow?: Narrow }
  /** Facts come from selected Courses only; a Source-only selection yields passages, never Facts. */
  | { kind: "facts"; types: FactType[]; narrow?: Pick<Narrow, "courseIds"> };
export type Provenance =
  | { kind: "source"; sourceId: string; title: string; location: { page: number } }
  | { kind: "correction" }
  | { kind: "entry" };
declare const citationRef: unique symbol;
/** What a stored Chat message keeps instead of text; resolved through `cite()` at display time. */
export type CitationRef = string & { readonly [citationRef]: "CitationRef" };
type SourceProvenance = Extract<Provenance, { kind: "source" }>;
export type Item = { cite: CitationRef; label: string } & (
  | { kind: "passage"; text: Untrusted; provenance: SourceProvenance; score: number }
  | { kind: "fact"; factId: string; type: FactType; value: Untrusted; uncertainty?: string; provenance: Provenance;
      /** A newer Source's value: flagged, never applied. */
      disagreement?: { value: Untrusted; provenance: SourceProvenance } });
export type PromptData = { data: string; citations: { tag: string; cite: CitationRef }[] };
const passageRef = (sourceId: string, chunkId: string) => `passage:${sourceId}:${chunkId}` as CitationRef;
const factRef = (type: FactType, id: string) => `${type === "obligation" ? "obligation" : "fact"}:${id}` as CitationRef;
const typeLabels: Record<FactType, string> = { obligation: "Obligation", topic: "Topic", course_rule: "Course rule", exam_logistics: "Exam logistics" };
const origin = (provenance: Provenance) => provenance.kind === "correction" ? "(corrected by the student)"
  : provenance.kind === "entry" ? "(entered by the student)" : `from ${provenance.title}, page ${provenance.location.page}`;
const dueText = (due: { date: string | null; time: string | null; timeZone: string | null }) =>
  due.date ? `due ${due.date}${due.time ? ` ${due.time} (${due.timeZone})` : ""}` : "no deadline stated";
export type Retrieval =
  | { status: "ok"; items: Item[]; render(): PromptData }
  | { status: "refused"; reason: "not_owner" | Extract<Metered<never>, { status: "refused" }>["reason"] };

const defaultLimit = 8;
/** Cosine similarity below which a passage is not relevant enough to show; tuned by the retrieval eval. */
const scoreFloor = 0.3;

function ok(items: Item[]): Retrieval {
  return { status: "ok", items, render() {
    if (!items.length) return { data: "Nothing relevant was found in the selected material.", citations: [] };
    const tagged = items.map((item, i) => ({ item, tag: `S${i + 1}` }));
    return {
      data: renderData("course_material", tagged.map(({ item, tag }) => ({ label: `[${tag}] ${item.label}`,
        text: item.kind === "passage" ? item.text : item.value,
        note: item.kind === "fact" && item.disagreement ? { prefix: "A newer Source disagrees (not applied): ", text: item.disagreement.value } : undefined }))),
      citations: tagged.map(({ item, tag }) => ({ tag, cite: item.cite })),
    };
  } };
}

/** The read side of knowledge: the only way course material reaches a model or a Chat answer. */
export function createKnowledgeReader({ db, keys, embedder, delegation }: {
  db: PrismaClient; keys: SourceKeys; embedder: Embedder; delegation: Delegation;
}) {
  const facts = createFacts({ db, keys, clock: { now: () => new Date() } });
  /** Every Fact the student sees in review, one Item each, with the Correction merge done by the write side. */
  async function factItems(p: Principal, courseIds: string[] | null, types: readonly FactType[]): Promise<Item[]> {
    const { courses } = await facts.review(p);
    return courses.filter(course => course.status !== "rejected" && (!courseIds || courseIds.includes(course.id))).flatMap(course => {
      const source = (citation: { sourceId: string; title: string; page: number }): SourceProvenance =>
        ({ kind: "source", sourceId: citation.sourceId, title: citation.title, location: { page: citation.page } });
      const provenanceOf = (p: { kind: "correction" } | { kind: "entry" } | { kind: "source"; sourceId: string; title: string; page: number }) =>
        p.kind === "source" ? source(p) : { kind: p.kind } as Provenance;
      /** The newest value a Source still asserts against the shown one. */
      const disagreementOf = <V>(item: { disagreement: boolean; values: (V & { overruled: boolean; citations: { sourceId: string; title: string; page: number }[] })[] },
        differs: (value: V) => boolean, text: (value: V) => string) => {
        if (!item.disagreement) return undefined;
        const value = item.values.filter(v => !v.overruled && differs(v)).at(-1);
        return value && { value: Untrusted.of(text(value)), provenance: source(value.citations.at(-1)!) };
      };
      const obligations = !types.includes("obligation") ? [] : course.obligations.filter(o => o.state !== "rejected").map((o): Item => {
        const provenance = provenanceOf(o.provenance);
        const shown = JSON.stringify([o.due.date, o.due.time, o.due.timeZone]);
        return { kind: "fact", factId: o.id, type: "obligation", cite: factRef("obligation", o.id), provenance,
          label: `${course.title}, ${typeLabels.obligation} ${origin(provenance)}`,
          value: Untrusted.of(`${o.title}, ${dueText(o.due)}`), ...(o.uncertainty ? { uncertainty: o.uncertainty } : {}),
          ...withDisagreement(disagreementOf(o, v => JSON.stringify([v.due.date, v.due.time, v.due.timeZone]) !== shown, v => dueText(v.due))) };
      });
      const others = course.facts.filter(f => f.state !== "rejected" && types.includes(f.type)).map((f): Item => {
        const provenance = provenanceOf(f.provenance);
        return { kind: "fact", factId: f.id, type: f.type, cite: factRef(f.type, f.id), provenance,
          label: `${course.title}, ${typeLabels[f.type]} ${origin(provenance)}`,
          value: Untrusted.of(f.value), ...(f.uncertainty ? { uncertainty: f.uncertainty } : {}),
          ...withDisagreement(disagreementOf(f, v => v.value !== f.value, v => v.value)) };
      });
      return [...obligations, ...others];
    });
  }
  return {
    async retrieve(p: Principal, scope: ScopeRef, query: Query): Promise<Retrieval> {
      if ("planning" in scope) {
        if (query.kind !== "facts" || query.types.some(type => !planningTypes.includes(type))) {
          throw new InvalidQueryError("Planning scope reads only planning Facts");
        }
        return ok(await factItems(p, query.narrow?.courseIds ?? null, query.types));
      }
      const { chatId } = scope;
      const selection = await withOwner(db, p, async tx => {
        const chat = await tx.chat.findUnique({ where: { id: chatId },
          include: { sources: true, courses: { include: { course: { include: { sources: true } } } } } });
        if (!chat) return null;
        if (query.kind === "facts") {
          const narrowCourses = query.narrow?.courseIds;
          return chat.courses.map(c => c.courseId).filter(id => !narrowCourses || narrowCourses.includes(id));
        }
        let selected = [...new Set([...chat.sources.map(s => s.sourceId), ...chat.courses.flatMap(c => c.course.sources.map(s => s.sourceId))])];
        const { courseIds, sourceIds: narrowSources } = query.narrow ?? {};
        if (narrowSources) selected = selected.filter(id => narrowSources.includes(id));
        if (courseIds) {
          const ofCourses = await tx.sourceCourse.findMany({ where: { courseId: { in: courseIds } }, select: { sourceId: true } });
          selected = selected.filter(id => ofCourses.some(s => s.sourceId === id));
        }
        return selected;
      });
      // RLS hides another student's Chat, so it is indistinguishable from one that never existed.
      if (!selection) return { status: "refused", reason: "not_owner" };
      if (!selection.length) return ok([]);
      if (query.kind === "facts") return ok(await factItems(p, selection, query.types));
      const sourceIds = selection;
      const embedded = await delegation.meter(p, { microUsd: embedder.estimateMicroUsd([query.text]) }, async signal => {
        try {
          const result = await embedder.embed([query.text], { signal });
          return { value: result.vectors[0]!, usage: result.usage };
        } catch (error) {
          if (error instanceof SourceModelRejected || isDefiniteFailure(error)) throw new DefiniteFailure("Provider rejected the query");
          throw error;
        }
      });
      if (embedded.status === "refused") return embedded;
      const limit = query.limit ?? defaultLimit;
      // Scope is applied in the statement itself: the owner (RLS), the live selection, and the current embedding model.
      const rows = await withOwner(db, p, tx => tx.$queryRaw<{
        id: string; sourceId: string; page: number; ciphertext: Uint8Array; title: string;
        keyVersion: string; keyCiphertext: string; score: number;
      }[]>`
        SELECT c."id", c."sourceId", c."page", c."ciphertext", s."title", s."keyVersion", s."keyCiphertext",
          1 - (c."embedding" <=> ${JSON.stringify(embedded.value)}::vector) AS "score"
        FROM "source_chunk" c JOIN "source" s ON s."id" = c."sourceId"
        WHERE c."sourceId" = ANY(${sourceIds}) AND s."deletedAt" IS NULL AND s."status" = 'ready'
          AND c."model" = ${embedder.model} AND c."dimensions" = ${embedder.dims}
        ORDER BY c."embedding" <=> ${JSON.stringify(embedded.value)}::vector, c."sourceId", c."ordinal"
        LIMIT ${limit}`);
      // Decrypted only after the scope filter, under each Source's own key.
      const items: Item[] = rows.filter(row => row.score >= scoreFloor).map(row => {
        const key = keys.unwrap(row.sourceId, { version: row.keyVersion, ciphertext: row.keyCiphertext });
        let text: string;
        try { text = decryptSourceText(key, row.sourceId, row.ciphertext); } finally { key.fill(0); }
        return { kind: "passage", score: row.score, cite: passageRef(row.sourceId, row.id), text: Untrusted.of(text),
          label: `${row.title}, page ${row.page}`,
          provenance: { kind: "source", sourceId: row.sourceId, title: row.title, location: { page: row.page } } };
      });
      return ok(items);
    },
    /** Resolves stored refs; a deleted Source, or one the Principal does not own, is "gone". */
    async cite(p: Principal, refs: CitationRef[]): Promise<Map<CitationRef, Provenance | "gone">> {
      const items = refs.some(ref => !ref.startsWith("passage:"))
        ? new Map((await factItems(p, null, Object.keys(typeLabels) as FactType[])).map(item => [item.cite, item.provenance]))
        : new Map<CitationRef, Provenance>();
      const parsed = refs.map(ref => ({ ref, match: /^passage:([^:]+):([^:]+)$/.exec(ref) }));
      const chunkIds = parsed.flatMap(({ match }) => match ? [match[2]!] : []);
      const chunks = await withOwner(db, p, tx => tx.sourceChunk.findMany({
        where: { id: { in: chunkIds }, source: { deletedAt: null } },
        select: { id: true, sourceId: true, page: true, source: { select: { title: true } } } }));
      return new Map(parsed.map(({ ref, match }) => {
        const chunk = match && chunks.find(c => c.id === match[2] && c.sourceId === match[1]);
        if (!match) return [ref, items.get(ref) ?? "gone"];
        return [ref, chunk ? { kind: "source", sourceId: chunk.sourceId, title: chunk.source.title, location: { page: chunk.page } } : "gone"];
      }));
    },
  };
}
const withDisagreement = (disagreement: Extract<Item, { kind: "fact" }>["disagreement"]) => disagreement ? { disagreement } : {};
export type KnowledgeReader = ReturnType<typeof createKnowledgeReader>;
