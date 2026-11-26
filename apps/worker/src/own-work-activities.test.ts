import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { SourceStorage } from "@nunio/knowledge";
import { createOwnWork } from "@nunio/knowledge";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowBundle } from "@temporalio/worker";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOwnWorkActivities } from "./own-work-activities.js";

const taskQueue = "own-work-test";
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;
let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the worker does. */
let runtime: PrismaClient;

beforeAll(async () => {
  [env, workflowBundle, db] = await Promise.all([
    TestWorkflowEnvironment.createLocal(),
    bundleWorkflowCode({
      workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    }),
    startTestDatabase(),
  ]);
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await Promise.all([env?.teardown(), db?.stop()]);
});

/**
 * The buckets in memory: the browser's upload in quarantine, the worker's snapshot, and every version in sources.
 * `afterSnapshot` runs once the snapshot is taken, as a replayed upload URL could; `afterPromote` once it is moved.
 */
function buckets(
  faults: {
    afterSnapshot?: (id: string) => void;
    afterPromote?: () => void;
  } = {},
) {
  const quarantine = new Map<string, Buffer>(),
    snapshots = new Map<string, Buffer>(),
    sources = new Map<string, Buffer[]>();
  const storage: SourceStorage = {
    upload: async (id) => ({
      url: `https://storage.invalid/quarantine/${id}`,
      headers: {},
      expiresAt: new Date(Date.now() + 300_000),
    }),
    download: async (id, key, location) => {
      const bytes =
        location === "sources" ? sources.get(id)?.at(-1) : quarantine.get(id);
      if (!bytes) throw new Error("NoSuchKey");
      if (location !== "sources") {
        snapshots.set(id, bytes);
        faults.afterSnapshot?.(id);
      }
      return {
        url: `https://storage.invalid/${id}`,
        keyBase64: key.toString("base64"),
        etag: "etag",
      };
    },
    promote: async (id) => {
      sources.set(id, [...(sources.get(id) ?? []), snapshots.get(id)!]);
      quarantine.delete(id);
      snapshots.delete(id);
      faults.afterPromote?.();
    },
    remove: async (id) => {
      quarantine.delete(id);
      snapshots.delete(id);
      sources.delete(id);
    },
  };
  return { quarantine, sources, storage };
}

/** A student's assignment with one confirmed Own Work file whose bytes are in quarantine. */
async function confirmedFile(storage: ReturnType<typeof buckets>) {
  const studentId = randomUUID(),
    courseId = randomUUID(),
    obligationId = randomUUID();
  await admin.user.create({
    data: {
      id: studentId,
      name: "Student",
      email: `${studentId}@example.com`,
      emailVerified: true,
    },
  });
  await admin.pilotEntitlement.create({ data: { studentId } });
  await admin.course.create({
    data: {
      id: courseId,
      studentId,
      title: "Analysis I",
      matchTitle: "analysis i",
      semester: "2026-ws",
      color: "rose",
      status: "accepted",
    },
  });
  await admin.obligation.create({
    data: {
      id: obligationId,
      studentId,
      courseId,
      matchKey: "sheet-1",
      kind: "assignment",
      enteredAt: new Date(),
      correctedTitle: "Problem sheet 1",
    },
  });
  const ownWork = createOwnWork({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    storage: storage.storage,
  });
  const p = principal.fromSession({ studentId });
  // Not a PDF: a file the parser would refuse.
  const bytes = Buffer.from("PK\u0003\u0004 Lösung.docx");
  const uploaded = await ownWork.upload(p, obligationId, {
    name: "Lösung.docx",
    bytes: bytes.length,
  });
  if (uploaded.status !== "ok") throw new Error(uploaded.status);
  const fileId = uploaded.file.id;
  storage.quarantine.set(fileId, bytes);
  await ownWork.confirm(p, obligationId, fileId);
  const list = async () => {
    const listed = await ownWork.list(p, obligationId);
    return listed.status === "ok" ? listed.files : [];
  };
  return { studentId, fileId, bytes, ownWork, list };
}

describe("Own Work promotion", () => {
  it("promotes the snapshot into sources as uploaded, without parsing, whatever a replayed upload writes after it", async () => {
    let fileId = "";
    const storage = buckets({
      afterSnapshot: (id) => {
        if (id === fileId) storage.quarantine.set(id, Buffer.from("replayed"));
      },
    });
    const file = await confirmedFile(storage);
    fileId = file.fileId;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createOwnWorkActivities(file.ownWork),
    });

    const result = await worker.runUntil(
      env.client.workflow.execute("promoteOwnWork", {
        taskQueue,
        workflowId: `promoteOwnWork/${file.fileId}`,
        args: [{ studentId: file.studentId, fileId: file.fileId }],
      }),
    );

    expect(result).toEqual({ status: "ready" });
    expect(storage.sources.get(file.fileId)).toEqual([file.bytes]);
    expect(await file.list()).toEqual([
      expect.objectContaining({ id: file.fileId, status: "ready" }),
    ]);
  });

  it("keeps the promoted file ready when the move completed but its answer was lost", async () => {
    let drops = 1;
    const storage = buckets({
      afterPromote: () => {
        if (drops-- > 0) throw new Error("socket hang up");
      },
    });
    const file = await confirmedFile(storage);
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createOwnWorkActivities(file.ownWork),
    });

    const result = await worker.runUntil(
      env.client.workflow.execute("promoteOwnWork", {
        taskQueue,
        workflowId: `promoteOwnWork/${file.fileId}`,
        args: [{ studentId: file.studentId, fileId: file.fileId }],
      }),
    );

    expect(result).toEqual({ status: "ready" });
    expect(storage.sources.get(file.fileId)).toEqual([file.bytes]);
  });

  it("shows the file failed once promotion gives up on an upload that never arrived", async () => {
    const storage = buckets();
    const file = await confirmedFile(storage);
    storage.quarantine.delete(file.fileId);
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createOwnWorkActivities(file.ownWork),
    });

    const result = await worker.runUntil(
      env.client.workflow.execute("promoteOwnWork", {
        taskQueue,
        workflowId: `promoteOwnWork/${file.fileId}`,
        args: [{ studentId: file.studentId, fileId: file.fileId }],
      }),
    );

    expect(result).toEqual({ status: "failed" });
    expect(await file.list()).toEqual([
      expect.objectContaining({ id: file.fileId, status: "failed" }),
    ]);
  });

  it("deletes the key and every stored version now, and again after the upload window", async () => {
    const storage = buckets();
    const file = await confirmedFile(storage);
    await file.ownWork.promote(
      principal.fromSession({ studentId: file.studentId }),
      file.fileId,
    );
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createOwnWorkActivities(file.ownWork),
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start("deleteOwnWork", {
        taskQueue,
        workflowId: `deleteOwnWork/${file.fileId}`,
        args: [
          {
            studentId: file.studentId,
            fileId: file.fileId,
            cleanupAfter: new Date(Date.now() + 3_000).toISOString(),
          },
        ],
      });
      while (storage.sources.has(file.fileId))
        await new Promise((resolve) => setTimeout(resolve, 50));
      // A replayed upload URL writes again while the cleanup waits.
      storage.quarantine.set(file.fileId, Buffer.from("replayed"));
      await handle.result();
    });

    expect(await file.list()).toEqual([]);
    expect(storage.quarantine.has(file.fileId)).toBe(false);
    expect(storage.sources.has(file.fileId)).toBe(false);
  });
});
