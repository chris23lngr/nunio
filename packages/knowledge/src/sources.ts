import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { DefiniteFailure, withOwner, type Delegation, type Principal } from "@nunio/delegation";
import { encryptSourceText, type SourceKeys } from "@nunio/keys";
import { isDefiniteFailure, SourceModelRejected, type Embedder, type ScanReader } from "@nunio/ai";

export const maxSourceBytes = 20 * 1024 * 1024;
export interface SourceStorage {
  upload(id: string, key: Buffer, bytes: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  download(id: string, key: Buffer): Promise<{ url: string; keyBase64: string; etag: string }>;
  promote(id: string, key: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
type Transaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export interface Ingestion {
  signal?: AbortSignal;
  parse(input: { url: string; keyBase64: string; etag: string; expectedBytes: number }): Promise<{ pages: { page: number; text: string; imageBase64?: string }[] }>;
  embedder: Embedder;
  scans: ScanReader;
  delegation: Delegation;
}
async function access(tx: Transaction, studentId: string) {
  const entitlement = await tx.pilotEntitlement.findUnique({ where: { studentId } });
  if (!entitlement || entitlement.revokedAt) return "not_entitled" as const;
  if (await tx.deletionRequest.findUnique({ where: { studentId } })) return "deletion_pending" as const;
  return undefined;
}

export function createSources({ db, keys, storage }: { db: PrismaClient; keys: SourceKeys; storage: SourceStorage }) {
  const sourceLock = (tx: Transaction, id: string) => tx.$queryRaw`SELECT "id" FROM "source" WHERE "id" = ${id} FOR UPDATE`;
  const sources = {
    async upload(p: Principal, input: { title: string; bytes: number; type: string }) {
      if (input.type !== "application/pdf" || !Number.isSafeInteger(input.bytes) || input.bytes <= 0
        || input.bytes > maxSourceBytes || !input.title.trim() || input.title.length > 255) {
        return { status: "refused", reason: "invalid_upload" } as const;
      }
      const id = randomUUID();
      const { key, wrapped } = keys.generate(id);
      return withOwner(db, p, async (tx, studentId) => {
        const reason = await access(tx, studentId);
        if (reason) return { status: "refused", reason } as const;
        const upload = await storage.upload(id, key, input.bytes);
        const source = await tx.source.create({ data: { id, studentId, title: input.title.trim(), bytes: input.bytes,
          keyVersion: wrapped.version, keyCiphertext: wrapped.ciphertext, uploadExpiresAt: upload.expiresAt } });
        return { status: "ok", source: { id: source.id, title: source.title, status: source.status }, upload } as const;
      });
    },
    async list(p: Principal) {
      return withOwner(db, p, tx => tx.source.findMany({ where: { deletedAt: null },
        select: { id: true, title: true, status: true }, orderBy: { createdAt: "asc" } }));
    },
    async complete(p: Principal, id: string) {
      return withOwner(db, p, async (tx, studentId) => {
        const reason = await access(tx, studentId);
        if (reason) return { status: "refused", reason } as const;
        await sourceLock(tx, id);
        const source = await tx.source.findFirst({ where: { id, deletedAt: null } });
        if (!source) return { status: "gone" } as const;
        if (source.status === "uploading") await tx.source.update({ where: { id }, data: { status: "queued" } });
        return { status: "ok" } as const;
      });
    },
    async remove(p: Principal, id: string, dispatch?: (cleanupAfter: Date) => Promise<void>) {
      if (dispatch) {
        const owned = await withOwner(db, p, tx => tx.source.findUnique({ where: { id } }));
        if (!owned) return { status: "gone" } as const;
        await dispatch(new Date(Math.max(owned.uploadExpiresAt.getTime(), (owned.deletedAt?.getTime() ?? Date.now()) + 20 * 60_000)));
      }
      return withOwner(db, p, async tx => {
        await sourceLock(tx, id);
        const source = await tx.source.findUnique({ where: { id } });
        if (!source) return { status: "gone" } as const;
        const deletedAt = source.deletedAt ?? new Date();
        await tx.sourceChunk.deleteMany({ where: { sourceId: id } });
        await tx.source.update({ where: { id }, data: { status: "deleted", deletedAt, keyVersion: null, keyCiphertext: null, title: "Deleted Source" } });
        // The final sweep also catches a still-valid PUT and a bounded in-flight ingestion Activity.
        return { status: "deleted", cleanupAfter: new Date(Math.max(source.uploadExpiresAt.getTime(), deletedAt.getTime() + 20 * 60_000)) } as const;
      });
    },
    async purge(p: Principal, id: string) {
      const deleted = await withOwner(db, p, tx => tx.source.findFirst({ where: { id, deletedAt: { not: null } } }));
      if (deleted) await storage.remove(id);
    },
    async ingest(p: Principal, id: string, deps: Ingestion) {
      const source = await withOwner(db, p, async (tx, studentId) => {
        if (await access(tx, studentId)) {
          await tx.source.updateMany({ where: { id, deletedAt: null, status: "queued" }, data: { status: "failed" } });
          return null;
        }
        await sourceLock(tx, id);
        const row = await tx.source.findFirst({ where: { id, deletedAt: null, status: "queued" } });
        if (!row) return null;
        await tx.source.update({ where: { id }, data: { status: "processing" } });
        return row;
      });
      if (!source?.keyVersion || !source.keyCiphertext) return { status: "stopped" } as const;
      const key = keys.unwrap(id, { version: source.keyVersion, ciphertext: source.keyCiphertext });
      const live = () => deps.signal?.aborted ? Promise.resolve(false) : withOwner(db, p, async (tx, studentId) => !(await access(tx, studentId))
        && Boolean(await tx.source.findFirst({ where: { id, status: "processing", deletedAt: null } })));
      const stop = () => withOwner(db, p, tx => tx.source.updateMany({ where: { id, deletedAt: null, status: "processing" }, data: { status: "failed" } }));
      const metered = async <T>(estimate: number, call: (signal: AbortSignal) => Promise<{ value: T; usage: { microUsd: number } }>) => {
        if (!(await live())) throw new Error("Source is no longer available for ingestion");
        const result = await deps.delegation.meter(p, { microUsd: estimate }, async signal => {
          try { return await call(deps.signal ? AbortSignal.any([signal, deps.signal]) : signal); }
          catch (error) {
            if (error instanceof SourceModelRejected || isDefiniteFailure(error)) throw new DefiniteFailure("Provider rejected ingestion");
            throw error;
          }
        });
        if (result.status === "refused") throw new Error(result.reason);
        return result.value;
      };
      try {
        const download = await storage.download(id, key);
        const parsed = await deps.parse({ ...download, expectedBytes: source.bytes });
        const chunks: { page: number; text: string }[] = [];
        for (const page of parsed.pages) {
          let text = page.text;
          if (page.imageBase64) {
            const image = Buffer.from(page.imageBase64, "base64");
            text = await metered(deps.scans.estimateMicroUsd(image), async signal => {
              const result = await deps.scans.read(image, { signal });
              return { value: result.text, usage: result.usage };
            });
          }
          // Split by Unicode code points, preserving non-ASCII text; <=6000 UTF-8 bytes per embedding.
          const chars = Array.from(text.trim());
          for (let offset = 0; offset < chars.length; offset += 1200) {
            chunks.push({ page: page.page, text: chars.slice(offset, offset + 1400).join("") });
          }
        }
        if (!chunks.length) throw new Error("No text found");
        if (chunks.length > 2000 || chunks.reduce((bytes, chunk) => bytes + Buffer.byteLength(chunk.text), 0) > 2 * 1024 * 1024) {
          throw new Error("Extracted text exceeds its bound");
        }
        const vectors: number[][] = [];
        for (let offset = 0; offset < chunks.length; offset += 16) {
          const texts = chunks.slice(offset, offset + 16).map(chunk => chunk.text);
          vectors.push(...await metered(deps.embedder.estimateMicroUsd(texts), async signal => {
            const result = await deps.embedder.embed(texts, { signal });
            return { value: result.vectors, usage: result.usage };
          }));
        }
        if (!(await live())) { await stop(); return { status: "stopped" } as const; }
        await storage.promote(id, key);
        const published = await withOwner(db, p, async (tx, studentId) => {
          await sourceLock(tx, id);
          if (await access(tx, studentId) || !await tx.source.findFirst({ where: { id, deletedAt: null, status: "processing" } })) return false;
          const rows = chunks.map((chunk, ordinal) => {
            const vector = vectors[ordinal];
            if (!vector || vector.length !== deps.embedder.dims || vector.some(x => !Number.isFinite(x))) throw new Error("Invalid embedding");
            return { id: randomUUID(), page: chunk.page, ordinal,
              ciphertext: encryptSourceText(key, id, chunk.text).toString("base64"), embedding: JSON.stringify(vector) };
          });
          await tx.$executeRaw`INSERT INTO "source_chunk" ("id", "sourceId", "studentId", "page", "ordinal", "ciphertext", "model", "dimensions", "embedding")
            SELECT row.id, ${id}, ${studentId}, row.page, row.ordinal, decode(row.ciphertext, 'base64'), ${deps.embedder.model}, ${deps.embedder.dims}, row.embedding::vector
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS row(id text, page int, ordinal int, ciphertext text, embedding text)`;
          await tx.source.update({ where: { id }, data: { status: "ready" } });
          return true;
        });
        if (!published) { await storage.remove(id); await stop(); return { status: "stopped" } as const; }
        return { status: "ready" } as const;
      } catch {
        await withOwner(db, p, tx => tx.source.updateMany({ where: { id, deletedAt: null, status: "processing" }, data: { status: "failed" } }));
        // Quarantined failures are never published; a founder investigates held usage before any retry.
        return { status: "failed" } as const;
      } finally { key.fill(0); }
    },
  };
  return sources;
}
export type Sources = ReturnType<typeof createSources>;
