import { randomUUID } from "node:crypto";
import { isDate, isDefiniteFailure, isTime, isTimeZone, SourceModelRejected, type Extracted, type Extractor } from "@nunio/ai";
import type { FactType, ObligationKind, PrismaClient, ReviewState, Unsupported } from "@nunio/db";
import { accessRefusal, DefiniteFailure, withOwner, type Delegation, type Principal, type Transaction } from "@nunio/delegation";
import { decryptSourceText, encryptSourceText, type SourceKeys } from "@nunio/keys";
import { pruneItems } from "./items.js";
import { joinChunks } from "./sources.js";

const defaultTimeZone = "Europe/Berlin";
const factTypes: FactType[] = ["topic", "course_rule", "exam_logistics"];
/** Extracted wording, encrypted under the Source key; structure stays in plain columns. */
interface ObligationWording { title: string; dueText: string; destination: string | null; quote: string; uncertainty: string | null }
interface FactWording { value: string; quote: string; uncertainty: string | null }

export type ItemRef = { kind: "obligation" | "fact"; id: string };
/** The student's own value: everything but the item's identity (kind and key). */
export type Correction =
  | { title: string; due: { date: string | null; time: string | null; timeZone: string | null }; destination: string | null }
  | { value: string };
type Citation = { extractionId: string; sourceId: string; title: string; page: number; quote: string };
type Provenance = { kind: "correction" } | { kind: "source"; sourceId: string; title: string; page: number; quote: string };
type DueValue = { date: string | null; time: string | null; timeZone: string | null };
interface ReviewItem<V> {
  id: string; state: ReviewState; provenance: Provenance; uncertainty: string | null;
  /** Sources, or a Source and the Correction, give different values that are not overruled. */
  disagreement: boolean;
  /** Set when a corrected item lost its last extraction. */
  unsupported: Unsupported | null;
  values: (V & { overruled: boolean; citations: Citation[] })[];
}
interface ReviewObligation extends ReviewItem<{ due: DueValue }> {
  kind: ObligationKind; title: string; due: DueValue & { text: string | null }; destination: string | null;
}
interface ReviewFact extends ReviewItem<{ value: string }> { type: FactType; value: string }

export function createFacts({ db, keys, clock }: { db: PrismaClient; keys: SourceKeys; clock: { now(): Date } }) {
  const setState = (p: Principal, item: ItemRef, state: "confirmed" | "rejected" | "unreviewed") => withOwner(db, p, async tx => {
    const where = { id: item.id, ...(state === "unreviewed" ? { state: "rejected" as const } : {}) };
    const { count } = item.kind === "obligation"
      ? await tx.obligation.updateMany({ where, data: { state } })
      : await tx.fact.updateMany({ where, data: { state } });
    return { status: count ? "ok" : "gone" } as const;
  });
  /** Each live extraction's value key: an Obligation's deadline, or a Fact's normalized value read under its Source key. */
  const extractedValues = async (tx: Transaction, item: ItemRef) => {
    const where = { source: { deletedAt: null } };
    if (item.kind === "obligation") {
      const rows = await tx.obligationExtraction.findMany({ where: { ...where, obligationId: item.id } });
      return rows.map(row => ({ id: row.id, key: dueKey(row), overruled: Boolean(row.overruledAt) }));
    }
    const rows = await tx.factExtraction.findMany({ where: { ...where, factId: item.id },
      include: { source: { select: { keyVersion: true, keyCiphertext: true } } } });
    return rows.map(row => {
      if (!row.source.keyVersion || !row.source.keyCiphertext) throw new Error("Source key is gone");
      const key = keys.unwrap(row.sourceId, { version: row.source.keyVersion, ciphertext: row.source.keyCiphertext });
      try {
        const { value } = JSON.parse(decryptSourceText(key, row.sourceId, Buffer.from(row.ciphertext))) as FactWording;
        return { id: row.id, key: normalize(value), overruled: Boolean(row.overruledAt) };
      } finally { key.fill(0); }
    });
  };
  const facts = {
    async extract(p: Principal, sourceId: string, deps: { extractor: Extractor; delegation: Delegation; signal?: AbortSignal }) {
      const source = await withOwner(db, p, async (tx, studentId) => {
        if (await accessRefusal(tx, studentId)) return null;
        const claimed = await tx.source.updateMany({ where: { id: sourceId, deletedAt: null, status: "ready", extraction: "pending" },
          data: { extraction: "running" } });
        if (!claimed.count) return null;
        return tx.source.findUniqueOrThrow({ where: { id: sourceId }, include: { chunks: { orderBy: { ordinal: "asc" } } } });
      });
      if (!source?.keyVersion || !source.keyCiphertext) return { status: "stopped" } as const;
      const key = keys.unwrap(sourceId, { version: source.keyVersion, ciphertext: source.keyCiphertext });
      const markFailed = () => withOwner(db, p, tx => tx.source.updateMany({ where: { id: sourceId, extraction: "running" },
        data: { extraction: "failed" } }));
      try {
        const pages = joinChunks(source.chunks.map(chunk => ({ page: chunk.page, text: decryptSourceText(key, sourceId, chunk.ciphertext) })));
        const results: Extracted[] = [];
        for (const window of deps.extractor.windows(pages)) {
          const result = await deps.delegation.meter(p, { microUsd: deps.extractor.estimateMicroUsd(window) },
            async signal => {
              try { return await deps.extractor.extract(window, { signal: deps.signal ? AbortSignal.any([signal, deps.signal]) : signal }); }
              catch (error) {
                if (error instanceof SourceModelRejected || isDefiniteFailure(error)) throw new DefiniteFailure("Provider rejected extraction");
                throw error;
              }
            });
          if (result.status === "refused") throw new Error(result.reason);
          results.push(result.value);
        }
        const seal = (wording: ObligationWording | FactWording) => new Uint8Array(encryptSourceText(key, sourceId, JSON.stringify(wording)));
        const pageText = new Map(pages.map(page => [page.page, groundingForm(page.text)]));
        const grounded = (item: { page: number; quote: string }) => {
          const quote = groundingForm(item.quote);
          return quote.length > 0 && Boolean(pageText.get(item.page)?.includes(quote));
        };
        const all = { courses: results.flatMap(r => r.courses), obligations: results.flatMap(r => r.obligations),
          facts: results.flatMap(r => r.facts) };
        const kept = { courses: all.courses.filter(grounded), obligations: all.obligations.filter(grounded), facts: all.facts.filter(grounded) };
        let dropped = all.courses.length - kept.courses.length + all.obligations.length - kept.obligations.length
          + all.facts.length - kept.facts.length;
        const stored = await withOwner(db, p, async (tx, studentId) => {
          await tx.$queryRaw`SELECT "id" FROM "source" WHERE "id" = ${sourceId} FOR UPDATE`;
          if (await accessRefusal(tx, studentId)
            || !await tx.source.findFirst({ where: { id: sourceId, deletedAt: null, extraction: "running" } })) return null;
          const extractedAt = clock.now();
          // A re-extraction replaces this Source's extractions only now, after every window succeeded. Until they are
          // deleted below, they count as existing values, which carries review states and overrule marks over by value.
          const ids = (rows: { id: string }[]) => ({ where: { id: { in: rows.map(row => row.id) } } });
          const stale = { obligations: ids(await tx.obligationExtraction.findMany({ where: { sourceId }, select: { id: true } })),
            facts: ids(await tx.factExtraction.findMany({ where: { sourceId }, select: { id: true } })) };
          await tx.sourceCourse.deleteMany({ where: { sourceId } });
          const courses = new Map<string, string>();
          // A Source repeating a value (overlapping windows, a summary table) yields one extraction, cited on its first page.
          const firstSeen = new Map<string, { id: string; page: number }>();
          const repeated = async (itemId: string, key: string, page: number, update: (id: string) => Promise<unknown>) => {
            const seen = firstSeen.get(`${itemId}\n${key}`);
            if (seen && seen.page > page) { await update(seen.id); seen.page = page; }
            return Boolean(seen);
          };
          for (const course of kept.courses) {
            const matchCode = course.code ? normalize(course.code) : null, matchTitle = normalize(course.title);
            // By code first, then by title when no code contradicts it; anything ambiguous becomes a new proposal.
            const byCode = matchCode ? await tx.course.findMany({ where: { matchCode }, select: { id: true } }) : [];
            const byTitle = byCode.length ? [] : await tx.course.findMany({
              where: { matchTitle, ...(matchCode ? { matchCode: null } : {}) }, select: { id: true } });
            const match = [byCode, byTitle].find(found => found.length === 1)?.[0];
            const id = match?.id ?? randomUUID();
            if (!match) await tx.course.create({ data: { id, studentId, code: course.code, title: course.title, matchCode, matchTitle } });
            await tx.sourceCourse.upsert({ where: { sourceId_courseId: { sourceId, courseId: id } }, create: { sourceId, courseId: id, studentId }, update: {} });
            for (const name of [course.code, course.title]) if (name) courses.set(normalize(name), id);
          }
          for (const item of kept.obligations) {
            const courseId = courses.get(normalize(item.course));
            if (!courseId) { dropped++; continue; }
            const timeZone = item.due.date ? item.due.timeZone ?? defaultTimeZone : null;
            const uncertainty = [item.uncertainty, item.due.time && !item.due.timeZone ? "Time zone assumed" : null,
              item.due.date ? null : "Deadline unresolved"].filter(Boolean).join("; ") || null;
            const wording: ObligationWording = { title: item.title, dueText: item.due.text, destination: item.destination,
              quote: item.quote, uncertainty };
            const matchKey = `${item.kind}:${normalize(item.key)}`;
            const owned = await tx.obligation.upsert({ where: { courseId_matchKey: { courseId, matchKey } },
              create: { id: randomUUID(), studentId, courseId, matchKey, kind: item.kind }, update: {},
              select: { id: true, state: true, correctedAt: true, extractions: { select: { dueDate: true, dueTime: true, timeZone: true, overruledAt: true } } } });
            const value: Due = { dueDate: item.due.date ? new Date(`${item.due.date}T00:00:00Z`) : null, dueTime: item.due.time, timeZone };
            if (await repeated(owned.id, dueKey(value), item.page,
              id => tx.obligationExtraction.update({ where: { id }, data: { page: item.page, ciphertext: seal(wording) } }))) continue;
            const existing = owned.extractions.map(row => ({ key: dueKey(row), overruled: Boolean(row.overruledAt) }));
            if (changes(owned, existing, dueKey(value))) await tx.obligation.update({ where: { id: owned.id }, data: { state: "unreviewed" } });
            const id = randomUUID();
            firstSeen.set(`${owned.id}\n${dueKey(value)}`, { id, page: item.page });
            await tx.obligationExtraction.create({ data: { id, studentId, obligationId: owned.id, sourceId,
              ...value, page: item.page, ciphertext: seal(wording), overruledAt: overruled(existing, dueKey(value), extractedAt) } });
          }
          for (const item of kept.facts) {
            const courseId = courses.get(normalize(item.course));
            if (!courseId) { dropped++; continue; }
            const wording: FactWording = { value: item.value, quote: item.quote, uncertainty: item.uncertainty };
            const matchKey = normalize(item.key);
            const owned = await tx.fact.upsert({ where: { courseId_type_matchKey: { courseId, type: item.type, matchKey } },
              create: { id: randomUUID(), studentId, courseId, type: item.type, matchKey }, update: {},
              select: { id: true, state: true, correctedAt: true } });
            const key = normalize(item.value);
            if (await repeated(owned.id, key, item.page,
              id => tx.factExtraction.update({ where: { id }, data: { page: item.page, ciphertext: seal(wording) } }))) continue;
            const existing = await extractedValues(tx, { kind: "fact", id: owned.id });
            if (changes(owned, existing, key)) await tx.fact.update({ where: { id: owned.id }, data: { state: "unreviewed" } });
            const id = randomUUID();
            firstSeen.set(`${owned.id}\n${key}`, { id, page: item.page });
            await tx.factExtraction.create({ data: { id, studentId, factId: owned.id, sourceId, page: item.page,
              ciphertext: seal(wording), overruledAt: overruled(existing, key, extractedAt) } });
          }
          if (stale.obligations.where.id.in.length || stale.facts.where.id.in.length) {
            await tx.obligationExtraction.deleteMany(stale.obligations);
            await tx.factExtraction.deleteMany(stale.facts);
            await pruneItems(tx, "not_found");
          }
          await tx.source.update({ where: { id: sourceId }, data: { extraction: "done", extractedAt } });
          return { extractedAt };
        });
        if (!stored) { await markFailed(); return { status: "stopped" } as const; }
        if (source.extractionRequestedAt) {
          return { status: "done", dropped, reextractionMs: stored.extractedAt.getTime() - source.extractionRequestedAt.getTime() } as const;
        }
        // Phase 6's ten-minute target: from the upload request to a reviewable result.
        return { status: "done", dropped, reviewableAfterMs: stored.extractedAt.getTime() - source.createdAt.getTime() } as const;
      } catch {
        // All or nothing: a failed window leaves no partial Facts, and the student decides whether to re-extract.
        await markFailed();
        return { status: "failed" } as const;
      } finally { key.fill(0); }
    },

    /** "Read again": queues a ready Source for extraction; asking again while it waits only re-dispatches it. */
    async requestExtraction(p: Principal, sourceId: string) {
      return withOwner(db, p, async tx => {
        await tx.$queryRaw`SELECT "id" FROM "source" WHERE "id" = ${sourceId} FOR UPDATE`;
        const source = await tx.source.findFirst({ where: { id: sourceId, deletedAt: null, status: "ready" } });
        if (!source) return { status: "gone" } as const;
        if (source.extraction === "running") return { status: "running" } as const;
        if (source.extraction !== "pending") {
          await tx.source.update({ where: { id: sourceId }, data: { extraction: "pending", extractionRequestedAt: clock.now() } });
        }
        return { status: "ok" } as const;
      });
    },
    async confirm(p: Principal, item: ItemRef) { return setState(p, item, "confirmed"); },
    /** A Correction confirms the item and overrules what its Sources say now; later disagreement is flagged, never applied. */
    async correct(p: Principal, item: ItemRef, correction: Correction) {
      return withOwner(db, p, async tx => {
        const now = clock.now();
        let key: string, count: number;
        if (item.kind === "obligation") {
          if (!("title" in correction)) return { status: "invalid" } as const;
          const { title, due: { date, time, timeZone }, destination } = correction;
          if (!title.trim() || (date !== null && !isDate(date)) || (time !== null && (date === null || !isTime(time)))
            || (timeZone !== null && (date === null || !isTimeZone(timeZone)))) return { status: "invalid" } as const;
          const value: Due = { dueDate: date ? new Date(`${date}T00:00:00Z`) : null, dueTime: time, timeZone: date ? timeZone ?? defaultTimeZone : null };
          key = dueKey(value);
          ({ count } = await tx.obligation.updateMany({ where: { id: item.id }, data: { state: "confirmed", correctedAt: now,
            correctedTitle: title.trim(), correctedDueDate: value.dueDate, correctedDueTime: value.dueTime, correctedTimeZone: value.timeZone,
            correctedDestination: destination?.trim() || null } }));
        } else {
          if (!("value" in correction) || !correction.value.trim()) return { status: "invalid" } as const;
          key = normalize(correction.value);
          ({ count } = await tx.fact.updateMany({ where: { id: item.id }, data: { state: "confirmed", correctedAt: now, correctedValue: correction.value.trim() } }));
        }
        if (!count) return { status: "gone" } as const;
        await overrule(tx, item.kind, (await extractedValues(tx, item)).filter(value => value.key !== key), now);
        return { status: "ok" } as const;
      });
    },
    /** Keep mine: the Correction stays, and the values that disagree with it now stop flagging the item. */
    async keepMine(p: Principal, item: ItemRef) {
      return withOwner(db, p, async tx => {
        const where = { id: item.id, correctedAt: { not: null } };
        const row = item.kind === "obligation" ? await tx.obligation.findFirst({ where }) : await tx.fact.findFirst({ where });
        if (!row) return { status: "gone" } as const;
        const key = "correctedDueDate" in row
          ? dueKey({ dueDate: row.correctedDueDate, dueTime: row.correctedDueTime, timeZone: row.correctedTimeZone })
          : normalize(row.correctedValue ?? "");
        await overrule(tx, item.kind, (await extractedValues(tx, item)).filter(value => value.key !== key), clock.now());
        return { status: "ok" } as const;
      });
    },
    /** "Use this": confirms the item with one extracted value, retiring any Correction and overruling every other value. */
    async use(p: Principal, item: ItemRef, extractionId: string) {
      return withOwner(db, p, async tx => {
        const values = await extractedValues(tx, item);
        const chosen = values.find(value => value.id === extractionId);
        if (!chosen) return { status: "gone" } as const;
        await overrule(tx, item.kind, values.filter(value => value.key !== chosen.key), clock.now());
        const restored = values.filter(value => value.key === chosen.key && value.overruled).map(value => value.id);
        const where = { id: { in: restored } }, data = { overruledAt: null };
        if (item.kind === "obligation") {
          await tx.obligationExtraction.updateMany({ where, data });
          await tx.obligation.update({ where: { id: item.id }, data: { state: "confirmed", unsupported: null, correctedAt: null,
            correctedTitle: null, correctedDueDate: null, correctedDueTime: null, correctedTimeZone: null, correctedDestination: null } });
        } else {
          await tx.factExtraction.updateMany({ where, data });
          await tx.fact.update({ where: { id: item.id }, data: { state: "confirmed", unsupported: null, correctedAt: null, correctedValue: null } });
        }
        return { status: "ok" } as const;
      });
    },
    async reject(p: Principal, item: ItemRef) { return setState(p, item, "rejected"); },
    /** Undoes a Reject; the item is reviewed again. */
    async restore(p: Principal, item: ItemRef) { return setState(p, item, "unreviewed"); },
    /** Restore returns a rejected Course to a proposal. */
    async decideCourse(p: Principal, courseId: string, decision: "accept" | "reject" | "restore") {
      return withOwner(db, p, async tx => {
        const { count } = decision === "restore"
          ? await tx.course.updateMany({ where: { id: courseId, status: "rejected" }, data: { status: "proposed" } })
          : await tx.course.updateMany({ where: { id: courseId }, data: { status: decision === "accept" ? "accepted" : "rejected" } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },

    /** Every Course and its items, grouped by value with their citations; a rejected Course shows no items until restored. */
    async review(p: Principal) {
      return withOwner(db, p, async tx => {
        const extractions = { where: { source: { deletedAt: null } }, orderBy: [{ createdAt: "asc" as const }, { page: "asc" as const }],
          include: { source: { select: { title: true, keyVersion: true, keyCiphertext: true } } } };
        const rows = await tx.course.findMany({ orderBy: [{ title: "asc" }, { code: "asc" }],
          include: { obligations: { include: { extractions } }, facts: { include: { extractions } } } });
        const sourceKeys = new Map<string, Buffer>();
        const open = <T>(row: { sourceId: string; ciphertext: Uint8Array; source: { keyVersion: string | null; keyCiphertext: string | null } }) => {
          let key = sourceKeys.get(row.sourceId);
          if (!key) {
            if (!row.source.keyVersion || !row.source.keyCiphertext) throw new Error("Source key is gone");
            sourceKeys.set(row.sourceId, key = keys.unwrap(row.sourceId, { version: row.source.keyVersion, ciphertext: row.source.keyCiphertext }));
          }
          return JSON.parse(decryptSourceText(key, row.sourceId, Buffer.from(row.ciphertext))) as T;
        };
        try {
          return { courses: rows.map(course => {
            const hidden = course.status === "rejected";
            const obligations = hidden ? [] : course.obligations.flatMap((row): ReviewObligation[] => {
              const values = valuesOf(row.extractions.map(extraction => ({ extraction, wording: open<ObligationWording>(extraction) })),
                ({ extraction }) => dueKey(extraction), ({ extraction }) => ({ due: due(extraction) }));
              const corrected = row.correctedAt ? dueKey({ dueDate: row.correctedDueDate, dueTime: row.correctedDueTime, timeZone: row.correctedTimeZone }) : null;
              const chosen = values.find(value => !value.shown.overruled) ?? values[0];
              if (!chosen && corrected === null) return [];
              const live = values.filter(value => !value.shown.overruled);
              const shared = { id: row.id, kind: row.kind, state: row.state, unsupported: row.unsupported,
                disagreement: corrected === null ? live.length > 1 : live.some(value => value.key !== corrected),
                values: values.map(value => value.shown) };
              if (corrected !== null || !chosen) return [{ ...shared, title: row.correctedTitle ?? "",
                due: { ...due({ dueDate: row.correctedDueDate, dueTime: row.correctedDueTime, timeZone: row.correctedTimeZone }), text: null },
                destination: row.correctedDestination, uncertainty: null, provenance: { kind: "correction" as const } }];
              const { extraction, wording } = chosen.first;
              return [{ ...shared, title: wording.title, due: { ...due(extraction), text: wording.dueText },
                destination: wording.destination, uncertainty: wording.uncertainty, provenance: citation(extraction, wording) }];
            });
            const facts = hidden ? [] : course.facts.flatMap((row): ReviewFact[] => {
              const values = valuesOf(row.extractions.map(extraction => ({ extraction, wording: open<FactWording>(extraction) })),
                ({ wording }) => normalize(wording.value), ({ wording }) => ({ value: wording.value }));
              const corrected = row.correctedAt && row.correctedValue !== null ? normalize(row.correctedValue) : null;
              const chosen = values.find(value => !value.shown.overruled) ?? values[0];
              if (!chosen && corrected === null) return [];
              const live = values.filter(value => !value.shown.overruled);
              const shared = { id: row.id, type: row.type, state: row.state, unsupported: row.unsupported,
                disagreement: corrected === null ? live.length > 1 : live.some(value => value.key !== corrected),
                values: values.map(value => value.shown) };
              if (corrected !== null || !chosen) return [{ ...shared, value: row.correctedValue ?? "", uncertainty: null,
                provenance: { kind: "correction" as const } }];
              const { extraction, wording } = chosen.first;
              return [{ ...shared, value: wording.value, uncertainty: wording.uncertainty, provenance: citation(extraction, wording) }];
            });
            const firstPage = (item: { values: { citations: { page: number }[] }[] }) => item.values[0]?.citations[0]?.page ?? 0;
            return { id: course.id, code: course.code, title: course.title, status: course.status,
              obligations: obligations.sort((a, b) => (a.due.date ?? "\uffff").localeCompare(b.due.date ?? "\uffff")
                || firstPage(a) - firstPage(b) || a.title.localeCompare(b.title)),
              facts: facts.sort((a, b) => factTypes.indexOf(a.type) - factTypes.indexOf(b.type) || firstPage(a) - firstPage(b) || a.value.localeCompare(b.value)) };
          }) };
        } finally { for (const key of sourceKeys.values()) key.fill(0); }
      });
    },
  };
  return facts;
}
export type Facts = ReturnType<typeof createFacts>;

type Due = { dueDate: Date | null; dueTime: string | null; timeZone: string | null };
const due = (row: Due) => ({ date: row.dueDate?.toISOString().slice(0, 10) ?? null, time: row.dueTime, timeZone: row.timeZone });
/** An Obligation's value is its deadline alone: wording differs between documents without changing what is owed. */
const dueKey = (row: Due) => JSON.stringify(due(row));
const citation = (extraction: { id: string; sourceId: string; page: number; source: { title: string } }, wording: { quote: string }) =>
  ({ kind: "source" as const, sourceId: extraction.sourceId, title: extraction.source.title, page: extraction.page, quote: wording.quote });

/** Whether a new value takes a confirmed item back to review: no extraction had it yet, and no Correction overrides it. */
const changes = (item: { state: ReviewState; correctedAt: Date | null }, existing: { key: string; overruled: boolean }[], key: string) =>
  item.state === "confirmed" && !item.correctedAt && existing.length > 0 && !existing.some(value => value.key === key);

/** Marks the given values overruled, leaving ones that already are untouched. */
async function overrule(tx: Transaction, kind: ItemRef["kind"], values: { id: string; overruled: boolean }[], now: Date) {
  const where = { id: { in: values.filter(value => !value.overruled).map(value => value.id) } }, data = { overruledAt: now };
  if (kind === "obligation") await tx.obligationExtraction.updateMany({ where, data });
  else await tx.factExtraction.updateMany({ where, data });
}

/** A value the student already overruled stays overruled when another Source repeats it. */
const overruled = (existing: { key: string; overruled: boolean }[], key: string, now: Date) =>
  existing.some(value => value.overruled && value.key === key) ? now : null;

/** Groups extractions by value, oldest first; a value counts as overruled only when every extraction of it is. */
function valuesOf<E extends { extraction: { id: string; sourceId: string; page: number; overruledAt: Date | null; source: { title: string } }; wording: { quote: string } }, V>(
  extractions: E[], keyOf: (extraction: E) => string, valueOf: (extraction: E) => V) {
  const values = new Map<string, { key: string; first: E; shown: V & { overruled: boolean; citations: Citation[] } }>();
  for (const entry of extractions) {
    const { extraction, wording } = entry;
    const cited: Citation = { extractionId: extraction.id, sourceId: extraction.sourceId, title: extraction.source.title, page: extraction.page, quote: wording.quote };
    const key = keyOf(entry), value = values.get(key);
    if (value) { value.shown.citations.push(cited); value.shown.overruled &&= Boolean(extraction.overruledAt); }
    else values.set(key, { key, first: entry, shown: { ...valueOf(entry), overruled: Boolean(extraction.overruledAt), citations: [cited] } });
  }
  return [...values.values()];
}

/** Case-, width- and whitespace-insensitive form used for matching across Sources. */
function normalize(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
}

/** Undoes line-break hyphenation and soft hyphens, so a quote matches the page text it was read from. */
function groundingForm(text: string) {
  return normalize(text.replace(/\u00ad/g, "").replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2"));
}
