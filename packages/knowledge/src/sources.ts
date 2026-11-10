import { createHash, randomUUID } from "node:crypto";
import type { Embedder, ScanReader } from "@nunio/ai";
import { isDefiniteFailure, SourceModelRejected } from "@nunio/ai";
import type { PrismaClient, SourceFailure } from "@nunio/db";
import type { Delegation, Principal, Transaction } from "@nunio/delegation";
import { accessRefusal, DefiniteFailure, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { encryptSourceText } from "@nunio/keys";
import { pruneItems } from "./items.js";

export const maxSourceBytes = 20 * 1024 * 1024;
// Chunks overlap by 200 code points; <=6000 UTF-8 bytes per embedding.
const chunkStride = 1200,
  chunkLength = 1400;
const embeddingBatch = 16,
  maxChunks = 2000,
  maxTextBytes = 2 * 1024 * 1024;
/** Rebuilds each page's text from its chunks in ordinal order, inverting the overlapping split below. */
export function joinChunks(chunks: readonly { page: number; text: string }[]) {
  const pages = new Map<number, string[]>();
  for (const chunk of chunks)
    pages.set(chunk.page, [...(pages.get(chunk.page) ?? []), chunk.text]);
  return [...pages].map(([page, texts]) => ({
    page,
    text: texts
      .map((text, i) =>
        i < texts.length - 1
          ? Array.from(text).slice(0, chunkStride).join("")
          : text,
      )
      .join(""),
  }));
}
// Bounds a still-valid PUT and an in-flight ingestion Activity after deletion.
const inFlightBoundMs = 20 * 60_000;
const cleanupAfter = (source: { uploadExpiresAt: Date }, deletedAt: Date) =>
  new Date(
    Math.max(
      source.uploadExpiresAt.getTime(),
      deletedAt.getTime() + inFlightBoundMs,
    ),
  );
export interface SourceStorage {
  upload(
    id: string,
    key: Buffer,
    bytes: number,
  ): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  download(
    id: string,
    key: Buffer,
    location?: "quarantine" | "sources",
  ): Promise<{ url: string; keyBase64: string; etag: string }>;
  promote(id: string, key: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface Ingestion {
  signal?: AbortSignal;
  parse(input: {
    url: string;
    keyBase64: string;
    etag: string;
    expectedBytes: number;
  }): Promise<{
    pages: { page: number; text: string; imageBase64?: string }[];
  }>;
  embedder: Embedder;
  scans: ScanReader;
  delegation: Delegation;
}
/** A failure the student can act on, recorded on the Source and shown to them. */
export class IngestionError extends Error {
  constructor(readonly reason: SourceFailure) {
    super(reason);
  }
}
const fail = (
  tx: Transaction,
  id: string,
  from: "queued" | "processing",
  failure?: SourceFailure,
) =>
  tx.source.updateMany({
    where: { id, deletedAt: null, status: from },
    data: { status: "failed", failure },
  });

export function createSources({
  db,
  keys,
  storage,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  storage: SourceStorage;
}) {
  const sourceLock = (tx: Transaction, id: string) =>
    tx.$queryRaw`SELECT "id" FROM "source" WHERE "id" = ${id} FOR UPDATE`;
  const sources = {
    async download(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const source = await tx.source.findFirst({
          where: { id, deletedAt: null, status: "ready" },
        });
        if (!source?.keyVersion || !source.keyCiphertext)
          return { status: "gone" } as const;
        const key = keys.unwrap(id, {
          version: source.keyVersion,
          ciphertext: source.keyCiphertext,
        });
        try {
          const download = await storage.download(id, key, "sources");
          return {
            status: "ok",
            title: source.title,
            url: download.url,
            headers: {
              "x-amz-server-side-encryption-customer-algorithm": "AES256",
              "x-amz-server-side-encryption-customer-key":
                key.toString("base64"),
              "x-amz-server-side-encryption-customer-key-md5": createHash("md5")
                .update(key)
                .digest("base64"),
            },
          } as const;
        } finally {
          key.fill(0);
        }
      });
    },
    async upload(
      p: Principal,
      input: { title: string; bytes: number; type: string },
    ) {
      if (
        input.type !== "application/pdf" ||
        !Number.isSafeInteger(input.bytes) ||
        input.bytes <= 0 ||
        input.bytes > maxSourceBytes ||
        !input.title.trim() ||
        input.title.length > 255
      ) {
        return { status: "refused", reason: "invalid_upload" } as const;
      }
      const id = randomUUID();
      const { key, wrapped } = keys.generate(id);
      return withOwner(db, p, async (tx, studentId) => {
        const reason = await accessRefusal(tx, studentId);
        if (reason) return { status: "refused", reason } as const;
        const upload = await storage.upload(id, key, input.bytes);
        const source = await tx.source.create({
          data: {
            id,
            studentId,
            title: input.title.trim(),
            bytes: input.bytes,
            keyVersion: wrapped.version,
            keyCiphertext: wrapped.ciphertext,
            uploadExpiresAt: upload.expiresAt,
          },
        });
        return {
          status: "ok",
          source: { id: source.id, title: source.title, status: source.status },
          upload,
        } as const;
      });
    },
    async list(p: Principal) {
      return withOwner(db, p, (tx) =>
        tx.source.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            failure: true,
            extraction: true,
          },
          orderBy: { createdAt: "asc" },
        }),
      );
    },
    async complete(p: Principal, id: string) {
      return withOwner(db, p, async (tx, studentId) => {
        const reason = await accessRefusal(tx, studentId);
        if (reason) return { status: "refused", reason } as const;
        await sourceLock(tx, id);
        const source = await tx.source.findFirst({
          where: { id, deletedAt: null },
        });
        if (!source) return { status: "gone" } as const;
        if (source.status === "uploading")
          await tx.source.update({ where: { id }, data: { status: "queued" } });
        return { status: "ok" } as const;
      });
    },
    /** Dispatches the physical cleanup first, so a dispatch failure leaves the Source intact. */
    async removeWithCleanup(
      p: Principal,
      id: string,
      dispatch: (cleanupAfter: Date) => Promise<void>,
    ) {
      const owned = await withOwner(db, p, (tx) =>
        tx.source.findUnique({ where: { id } }),
      );
      if (!owned) return { status: "gone" } as const;
      await dispatch(cleanupAfter(owned, owned.deletedAt ?? new Date()));
      return sources.remove(p, id);
    },
    async remove(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        await sourceLock(tx, id);
        const source = await tx.source.findUnique({ where: { id } });
        if (!source) return { status: "gone" } as const;
        const deletedAt = source.deletedAt ?? new Date();
        await tx.sourceChunk.deleteMany({ where: { sourceId: id } });
        await tx.obligationExtraction.deleteMany({ where: { sourceId: id } });
        await tx.factExtraction.deleteMany({ where: { sourceId: id } });
        await tx.sourceCourse.deleteMany({ where: { sourceId: id } });
        await pruneItems(tx, "source_deleted");
        await tx.source.update({
          where: { id },
          data: {
            status: "deleted",
            deletedAt,
            keyVersion: null,
            keyCiphertext: null,
            title: "Deleted Source",
          },
        });
        return {
          status: "deleted",
          cleanupAfter: cleanupAfter(source, deletedAt),
        } as const;
      });
    },
    async purge(p: Principal, id: string) {
      const deleted = await withOwner(db, p, (tx) =>
        tx.source.findFirst({ where: { id, deletedAt: { not: null } } }),
      );
      if (deleted) await storage.remove(id);
    },
    async ingest(p: Principal, id: string, deps: Ingestion) {
      const source = await withOwner(db, p, async (tx, studentId) => {
        if (await accessRefusal(tx, studentId)) {
          await fail(tx, id, "queued");
          return null;
        }
        await sourceLock(tx, id);
        const row = await tx.source.findFirst({
          where: { id, deletedAt: null, status: "queued" },
        });
        if (!row) return null;
        await tx.source.update({
          where: { id },
          data: { status: "processing" },
        });
        return row;
      });
      if (!source?.keyVersion || !source.keyCiphertext)
        return { status: "stopped" } as const;
      const markFailed = (failure?: SourceFailure) =>
        withOwner(db, p, (tx) => fail(tx, id, "processing", failure));
      let key: Buffer;
      // A master key the worker lacks (or holds differently) would otherwise leave the Source processing.
      try {
        key = keys.unwrap(id, {
          version: source.keyVersion,
          ciphertext: source.keyCiphertext,
        });
      } catch {
        await markFailed();
        return { status: "failed" } as const;
      }
      const stillIngesting = () =>
        deps.signal?.aborted
          ? Promise.resolve(false)
          : withOwner(
              db,
              p,
              async (tx, studentId) =>
                !(await accessRefusal(tx, studentId)) &&
                Boolean(
                  await tx.source.findFirst({
                    where: { id, status: "processing", deletedAt: null },
                  }),
                ),
            );
      const meteredModelCall = async <T>(
        estimate: number,
        call: (
          signal: AbortSignal,
        ) => Promise<{ value: T; usage: { microUsd: number } }>,
      ) => {
        if (!(await stillIngesting()))
          throw new Error("Source is no longer available for ingestion");
        const result = await deps.delegation.meter(
          p,
          { microUsd: estimate },
          async (signal) => {
            try {
              return await call(
                deps.signal ? AbortSignal.any([signal, deps.signal]) : signal,
              );
            } catch (error) {
              if (
                error instanceof SourceModelRejected ||
                isDefiniteFailure(error)
              )
                throw new DefiniteFailure("Provider rejected ingestion");
              throw error;
            }
          },
        );
        if (result.status === "refused") {
          throw result.reason === "allowance_exhausted"
            ? new IngestionError(result.reason)
            : new Error(result.reason);
        }
        return result.value;
      };
      try {
        const download = await storage.download(id, key);
        const parsed = await deps.parse({
          ...download,
          expectedBytes: source.bytes,
        });
        const chunks: { page: number; text: string }[] = [];
        for (const page of parsed.pages) {
          let text = page.text;
          if (page.imageBase64) {
            const image = Buffer.from(page.imageBase64, "base64");
            // Transcription supplements, never replaces, whatever text the parser extracted.
            const transcription = await meteredModelCall(
              deps.scans.estimateMicroUsd(image),
              async (signal) => {
                const result = await deps.scans.read(image, { signal });
                return { value: result.text, usage: result.usage };
              },
            );
            text = [page.text.trim(), transcription.trim()]
              .filter(Boolean)
              .join("\n");
          }
          // Split by Unicode code points, preserving non-ASCII text.
          const chars = Array.from(text.trim());
          for (let offset = 0; offset < chars.length; offset += chunkStride) {
            chunks.push({
              page: page.page,
              text: chars.slice(offset, offset + chunkLength).join(""),
            });
          }
        }
        if (!chunks.length) throw new IngestionError("no_text");
        if (
          chunks.length > maxChunks ||
          chunks.reduce(
            (bytes, chunk) => bytes + Buffer.byteLength(chunk.text),
            0,
          ) > maxTextBytes
        ) {
          throw new IngestionError("too_large");
        }
        const vectors: number[][] = [];
        for (let offset = 0; offset < chunks.length; offset += embeddingBatch) {
          const texts = chunks
            .slice(offset, offset + embeddingBatch)
            .map((chunk) => chunk.text);
          vectors.push(
            ...(await meteredModelCall(
              deps.embedder.estimateMicroUsd(texts),
              async (signal) => {
                const result = await deps.embedder.embed(texts, { signal });
                return { value: result.vectors, usage: result.usage };
              },
            )),
          );
        }
        if (!(await stillIngesting())) {
          await markFailed();
          return { status: "stopped" } as const;
        }
        await storage.promote(id, key);
        const published = await withOwner(db, p, async (tx, studentId) => {
          await sourceLock(tx, id);
          if (
            (await accessRefusal(tx, studentId)) ||
            !(await tx.source.findFirst({
              where: { id, deletedAt: null, status: "processing" },
            }))
          )
            return false;
          const rows = chunks.map((chunk, ordinal) => {
            const vector = vectors[ordinal];
            if (
              !vector ||
              vector.length !== deps.embedder.dims ||
              vector.some((x) => !Number.isFinite(x))
            )
              throw new Error("Invalid embedding");
            return {
              id: randomUUID(),
              page: chunk.page,
              ordinal,
              ciphertext: encryptSourceText(key, id, chunk.text).toString(
                "base64",
              ),
              embedding: JSON.stringify(vector),
            };
          });
          await tx.$executeRaw`INSERT INTO "source_chunk" ("id", "sourceId", "studentId", "page", "ordinal", "ciphertext", "model", "dimensions", "embedding")
            SELECT row.id, ${id}, ${studentId}, row.page, row.ordinal, decode(row.ciphertext, 'base64'), ${deps.embedder.model}, ${deps.embedder.dims}, row.embedding::vector
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS row(id text, page int, ordinal int, ciphertext text, embedding text)`;
          await tx.source.update({ where: { id }, data: { status: "ready" } });
          return true;
        });
        if (!published) {
          await storage.remove(id);
          await markFailed();
          return { status: "stopped" } as const;
        }
        return { status: "ready" } as const;
      } catch (error) {
        const failure =
          error instanceof IngestionError ? error.reason : undefined;
        await markFailed(failure);
        // Quarantined failures are never published; a founder investigates held usage before any retry.
        return { status: "failed", failure } as const;
      } finally {
        key.fill(0);
      }
    },
  };
  return sources;
}
export type Sources = ReturnType<typeof createSources>;
