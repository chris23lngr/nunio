import { randomUUID } from "node:crypto";
import type { ObligationKind, PrismaClient } from "@nunio/db";
import type { Principal, Transaction } from "@nunio/delegation";
import { accessRefusal, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type { SourceStorage } from "./sources.js";

/** An email hand-in carries at most 14 MB of attachments, so no single file can be larger. */
export const maxOwnWorkBytes = 14 * 1024 * 1024;
const notHandedIn: ObligationKind[] = ["exam", "registration"];
// Bounds a still-valid PUT and an in-flight promotion after deletion.
const inFlightBoundMs = 20 * 60_000;

/**
 * Own Work: files the student uploads to hand in for an Obligation. nunio never parses them. Each is stored under
 * its own key like a Source (ADR-0007): the browser uploads to `quarantine`, and only the worker promotes a snapshot
 * into `sources`, so the bytes handed in are the bytes promoted, whatever a replayed upload URL writes later.
 */
export function createOwnWork({
  db,
  keys,
  storage,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  storage: SourceStorage;
}) {
  const fileLock = (tx: Transaction, id: string) =>
    tx.$queryRaw`SELECT "id" FROM "own_work_file" WHERE "id" = ${id} FOR UPDATE`;
  /** The student's file on this Obligation; another Obligation's file is gone here. */
  const fileOn = (tx: Transaction, obligationId: string, id: string) =>
    tx.ownWorkFile.findFirst({ where: { id, obligationId } });
  return {
    async upload(
      p: Principal,
      obligationId: string,
      input: { name: string; bytes: number },
    ) {
      if (
        !Number.isSafeInteger(input.bytes) ||
        input.bytes <= 0 ||
        input.bytes > maxOwnWorkBytes ||
        !input.name.trim() ||
        input.name.length > 255
      )
        return { status: "invalid" } as const;
      const id = randomUUID();
      const { key, wrapped } = keys.generate(id);
      try {
        return await withOwner(db, p, async (tx, studentId) => {
          const reason = await accessRefusal(tx, studentId);
          if (reason) return { status: "refused", reason } as const;
          const obligation = await tx.obligation.findUnique({
            where: { id: obligationId },
          });
          if (!obligation) return { status: "gone" } as const;
          if (notHandedIn.includes(obligation.kind))
            return { status: "not_handed_in" } as const;
          const upload = await storage.upload(id, key, input.bytes);
          const file = await tx.ownWorkFile.create({
            data: {
              id,
              studentId,
              obligationId,
              name: input.name.trim(),
              bytes: input.bytes,
              keyVersion: wrapped.version,
              keyCiphertext: wrapped.ciphertext,
              uploadExpiresAt: upload.expiresAt,
            },
          });
          return { status: "ok", file: view(file), upload } as const;
        });
      } finally {
        key.fill(0);
      }
    },
    /** The browser's upload finished: the worker may promote it. Repeating is harmless. */
    async confirm(p: Principal, obligationId: string, id: string) {
      return withOwner(db, p, async (tx, studentId) => {
        const reason = await accessRefusal(tx, studentId);
        if (reason) return { status: "refused", reason } as const;
        await fileLock(tx, id);
        const file = await fileOn(tx, obligationId, id);
        if (!file) return { status: "gone" } as const;
        if (file.status === "uploading")
          await tx.ownWorkFile.update({
            where: { id },
            data: { status: "promoting" },
          });
        return { status: "ok" } as const;
      });
    },
    async list(p: Principal, obligationId: string) {
      return withOwner(db, p, async (tx) => {
        const obligation = await tx.obligation.findUnique({
          where: { id: obligationId },
          include: { ownWork: { orderBy: { createdAt: "asc" } } },
        });
        if (!obligation) return { status: "gone" } as const;
        return { status: "ok", files: obligation.ownWork.map(view) } as const;
      });
    },
    /**
     * The worker's promotion, without parsing: snapshots the upload inside `quarantine`, then moves the snapshot into
     * `sources`. A file with nothing uploaded fails; the student deletes it and uploads again.
     */
    async promote(p: Principal, id: string) {
      const file = await withOwner(db, p, (tx) =>
        tx.ownWorkFile.findFirst({ where: { id, status: "promoting" } }),
      );
      if (!file) return { status: "stopped" } as const;
      const key = keys.unwrap(id, {
        version: file.keyVersion,
        ciphertext: file.keyCiphertext,
      });
      try {
        // Downloading from quarantine takes the snapshot; its URL is not used.
        await storage.download(id, key);
        await storage.promote(id, key);
      } catch {
        await withOwner(db, p, (tx) =>
          tx.ownWorkFile.updateMany({
            where: { id, status: "promoting" },
            data: { status: "failed" },
          }),
        );
        return { status: "failed" } as const;
      } finally {
        key.fill(0);
      }
      const promoted = await withOwner(db, p, async (tx) => {
        await fileLock(tx, id);
        const { count } = await tx.ownWorkFile.updateMany({
          where: { id, status: "promoting" },
          data: { status: "ready" },
        });
        return count > 0;
      });
      // Deleted while it was promoted: its key is gone, so its objects go too.
      if (!promoted) await storage.remove(id);
      return { status: promoted ? "ready" : "stopped" } as const;
    },
    /** Deletes the file's key. Dispatches the cleanup of its objects first, so a dispatch failure leaves it intact. */
    async removeWithCleanup(
      p: Principal,
      obligationId: string,
      id: string,
      dispatch: (cleanupAfter: Date) => Promise<void>,
    ) {
      const file = await withOwner(db, p, (tx) => fileOn(tx, obligationId, id));
      if (!file) return { status: "gone" } as const;
      await dispatch(
        new Date(
          Math.max(
            file.uploadExpiresAt.getTime(),
            Date.now() + inFlightBoundMs,
          ),
        ),
      );
      await withOwner(db, p, (tx) =>
        tx.ownWorkFile.deleteMany({ where: { id } }),
      );
      return { status: "deleted" } as const;
    },
    /** The worker's cleanup: deletes the key if the API did not, then every stored object and version. */
    async purge(p: Principal, id: string) {
      await withOwner(db, p, (tx) =>
        tx.ownWorkFile.deleteMany({ where: { id } }),
      );
      await storage.remove(id);
    },
  };
}
export type OwnWork = ReturnType<typeof createOwnWork>;

function view(file: {
  id: string;
  name: string;
  bytes: number;
  status: "uploading" | "promoting" | "ready" | "failed";
  createdAt: Date;
}) {
  return {
    id: file.id,
    name: file.name,
    bytes: file.bytes,
    status: file.status,
    uploadedAt: file.createdAt,
  };
}
