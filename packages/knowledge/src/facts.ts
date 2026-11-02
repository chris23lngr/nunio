import { randomUUID } from "node:crypto";
import { isDefiniteFailure, SourceModelRejected, type Extracted, type Extractor } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { accessRefusal, DefiniteFailure, withOwner, type Delegation, type Principal } from "@nunio/delegation";
import { decryptSourceText, encryptSourceText, type SourceKeys } from "@nunio/keys";
import { joinChunks } from "./sources.js";

const defaultTimeZone = "Europe/Berlin";
/** Extracted wording, encrypted under the Source key; structure stays in plain columns. */
interface ObligationWording { title: string; dueText: string; destination: string | null; quote: string; uncertainty: string | null }
interface FactWording { value: string; quote: string; uncertainty: string | null }

export type ItemRef = { kind: "obligation" | "fact"; id: string };

export function createFacts({ db, keys, clock }: { db: PrismaClient; keys: SourceKeys; clock: { now(): Date } }) {
  const setState = (p: Principal, item: ItemRef, state: "confirmed" | "rejected") => withOwner(db, p, async tx => {
    const where = { id: item.id, source: { deletedAt: null } };
    const { count } = item.kind === "obligation"
      ? await tx.obligation.updateMany({ where, data: { state } })
      : await tx.fact.updateMany({ where, data: { state } });
    return { status: count ? "ok" : "gone" } as const;
  });
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
          const courses = new Map<string, string>();
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
            await tx.obligation.create({ data: { id: randomUUID(), studentId, courseId, sourceId,
              matchKey: `${item.kind}:${normalize(item.key)}`, kind: item.kind,
              dueDate: item.due.date ? new Date(`${item.due.date}T00:00:00Z`) : null, dueTime: item.due.time, timeZone,
              page: item.page, ciphertext: seal(wording) } });
          }
          for (const item of kept.facts) {
            const courseId = courses.get(normalize(item.course));
            if (!courseId) { dropped++; continue; }
            const wording: FactWording = { value: item.value, quote: item.quote, uncertainty: item.uncertainty };
            await tx.fact.create({ data: { id: randomUUID(), studentId, courseId, sourceId, type: item.type,
              matchKey: normalize(item.key), page: item.page, ciphertext: seal(wording) } });
          }
          const extractedAt = clock.now();
          await tx.source.update({ where: { id: sourceId }, data: { extraction: "done", extractedAt } });
          return { extractedAt };
        });
        if (!stored) { await markFailed(); return { status: "stopped" } as const; }
        // Phase 6's ten-minute target: from the upload request to a reviewable result.
        return { status: "done", dropped, reviewableAfterMs: stored.extractedAt.getTime() - source.createdAt.getTime() } as const;
      } catch {
        // All or nothing: a failed window leaves no partial Facts, and the student decides whether to re-extract.
        await markFailed();
        return { status: "failed" } as const;
      } finally { key.fill(0); }
    },

    async confirm(p: Principal, item: ItemRef) { return setState(p, item, "confirmed"); },
    async reject(p: Principal, item: ItemRef) { return setState(p, item, "rejected"); },
    async decideCourse(p: Principal, courseId: string, decision: "accept" | "reject") {
      return withOwner(db, p, async tx => {
        const { count } = await tx.course.updateMany({ where: { id: courseId },
          data: { status: decision === "accept" ? "accepted" : "rejected" } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },

    /** Everything awaiting or past review, grouped by Course; rejected Courses and items are hidden. */
    async review(p: Principal) {
      return withOwner(db, p, async tx => {
        const live = { state: { not: "rejected" as const }, source: { deletedAt: null } };
        const source = { select: { title: true, keyVersion: true, keyCiphertext: true } };
        const rows = await tx.course.findMany({ where: { status: { not: "rejected" } }, orderBy: [{ title: "asc" }, { code: "asc" }],
          include: {
            obligations: { where: live, include: { source }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { page: "asc" }, { matchKey: "asc" }] },
            facts: { where: live, include: { source }, orderBy: [{ type: "asc" }, { page: "asc" }, { matchKey: "asc" }] },
          } });
        const sourceKeys = new Map<string, Buffer>();
        const keyFor = (id: string, source: { keyVersion: string | null; keyCiphertext: string | null }) => {
          if (!source.keyVersion || !source.keyCiphertext) throw new Error("Source key is gone");
          let key = sourceKeys.get(id);
          if (!key) sourceKeys.set(id, key = keys.unwrap(id, { version: source.keyVersion, ciphertext: source.keyCiphertext }));
          return key;
        };
        try {
          return { courses: rows.map(course => ({
            id: course.id, code: course.code, title: course.title, status: course.status,
            obligations: course.obligations.map(row => {
              const wording = JSON.parse(decryptSourceText(keyFor(row.sourceId, row.source), row.sourceId, row.ciphertext)) as ObligationWording;
              return { id: row.id, kind: row.kind, title: wording.title, state: row.state,
                due: { date: row.dueDate?.toISOString().slice(0, 10) ?? null, time: row.dueTime, timeZone: row.timeZone, text: wording.dueText },
                destination: wording.destination, uncertainty: wording.uncertainty,
                provenance: { kind: "source" as const, sourceId: row.sourceId, title: row.source.title, page: row.page, quote: wording.quote } };
            }),
            facts: course.facts.map(row => {
              const wording = JSON.parse(decryptSourceText(keyFor(row.sourceId, row.source), row.sourceId, row.ciphertext)) as FactWording;
              return { id: row.id, type: row.type, value: wording.value, uncertainty: wording.uncertainty, state: row.state,
                provenance: { kind: "source" as const, sourceId: row.sourceId, title: row.source.title, page: row.page, quote: wording.quote } };
            }),
          })) };
        } finally { for (const key of sourceKeys.values()) key.fill(0); }
      });
    },
  };
  return facts;
}
export type Facts = ReturnType<typeof createFacts>;

/** Case-, width- and whitespace-insensitive form used for matching across Sources. */
function normalize(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
}

/** Undoes line-break hyphenation and soft hyphens, so a quote matches the page text it was read from. */
function groundingForm(text: string) {
  return normalize(text.replace(/\u00ad/g, "").replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2"));
}
