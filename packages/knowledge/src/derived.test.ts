import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Principal } from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDerivedText } from "./derived.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
const keys = createSourceKeys({
  activeVersion: "v1",
  masters: { v1: randomBytes(32) },
});
const derived = createDerivedText(keys);
beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  return principal.fromSession({ studentId: id });
}
async function source(p: Principal) {
  const id = randomUUID();
  const { wrapped } = keys.generate(id);
  await admin.source.create({
    data: {
      id,
      studentId: (p as { studentId: string }).studentId,
      title: "Skript.pdf",
      bytes: 1,
      status: "ready",
      keyVersion: wrapped.version,
      keyCiphertext: wrapped.ciphertext,
      uploadExpiresAt: new Date(),
    },
  });
  return id;
}
async function connection(p: Principal) {
  const id = randomUUID();
  const { wrapped } = keys.generateConnectionKey(id);
  await admin.connection.create({
    data: {
      id,
      studentId: (p as { studentId: string }).studentId,
      integrationKey: "email",
      accountLabel: "student@uni.test",
      keyVersion: wrapped.version,
      keyCiphertext: wrapped.ciphertext,
    },
  });
  return id;
}
/** Seals and opens as callers do, inside the student's transaction. */
const seal = (
  p: Principal,
  id: string,
  sources: string[],
  connections: string[],
) =>
  withOwner(runtime, p, (tx) =>
    derived.seal(tx, id, sources, "Aus Mail und Skript", connections),
  );
const open = (
  p: Principal,
  id: string,
  sealed: NonNullable<Awaited<ReturnType<typeof seal>>>,
) => withOwner(runtime, p, (tx) => derived.open(tx, id, sealed));
const deleteSource = (id: string) =>
  admin.source.update({ where: { id }, data: { deletedAt: new Date() } });
/** Disconnect deletes the Connection row and its content key with it. */
const disconnect = (id: string) => admin.connection.delete({ where: { id } });

it("seals text under its Sources and Connections and opens it while all are there", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  expect(sealed).toMatchObject({
    derivedFrom: [sourceId],
    derivedFromConnections: [connectionId],
  });
  expect(sealed!.contentKey).not.toBeNull();
  expect(Buffer.from(sealed!.content).toString()).not.toContain("Mail");
  expect(await open(p, "message-1", sealed!)).toEqual({
    text: "Aus Mail und Skript",
    gone: null,
  });
});

it("seals text drawn only from a Connection", async () => {
  const p = await student();
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [], [connectionId]);
  expect(sealed!.contentKey).not.toBeNull();
  expect(Buffer.from(sealed!.content).toString()).not.toContain("Mail");
  expect(await open(p, "message-1", sealed!)).toMatchObject({
    text: "Aus Mail und Skript",
  });
});

it("is gone as source_deleted once a Source it drew on is deleted", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  await deleteSource(sourceId);
  expect(await open(p, "message-1", sealed!)).toEqual({
    text: null,
    gone: "source_deleted",
  });
});

it("is gone as connection_disconnected once a Connection it drew on is Disconnected", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  await disconnect(connectionId);
  expect(await open(p, "message-1", sealed!)).toEqual({
    text: null,
    gone: "connection_disconnected",
  });
});

it("is gone as connection_disconnected when its Source is deleted too", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  await deleteSource(sourceId);
  await disconnect(connectionId);
  expect(await open(p, "message-1", sealed!)).toEqual({
    text: null,
    gone: "connection_disconnected",
  });
});

it("seals nothing once a Connection is already Disconnected", async () => {
  const p = await student();
  const connectionId = await connection(p);
  await disconnect(connectionId);
  expect(await seal(p, "message-1", [], [connectionId])).toBeNull();
});

it("opens text sealed before Connections were recorded, which lists none", async () => {
  const p = await student();
  const sourceId = await source(p);
  const sealed = await withOwner(runtime, p, (tx) =>
    derived.seal(tx, "message-1", [sourceId], "Nur aus dem Skript"),
  );
  expect(sealed).not.toHaveProperty("derivedFromConnections");
  expect(await open(p, "message-1", sealed!)).toEqual({
    text: "Nur aus dem Skript",
    gone: null,
  });
});

it("cannot be opened without the Connection's own key", async () => {
  const p = await student();
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [], [connectionId]);
  const { wrapped } = keys.generateConnectionKey(connectionId);
  await admin.connection.update({
    where: { id: connectionId },
    data: { keyVersion: wrapped.version, keyCiphertext: wrapped.ciphertext },
  });
  await expect(open(p, "message-1", sealed!)).rejects.toThrow();
});

/** The keys, recording every Source and Connection key they unwrap, so a test can see each one is zeroed. */
function recordingKeys() {
  const unwrapped: Buffer[] = [];
  const record = (key: Buffer) => {
    unwrapped.push(key);
    return key;
  };
  return {
    unwrapped,
    derived: createDerivedText({
      ...keys,
      unwrap: (id, wrapped) => record(keys.unwrap(id, wrapped)),
      unwrapConnectionKey: (id, wrapped) =>
        record(keys.unwrapConnectionKey(id, wrapped)),
    }),
  };
}
const zeroed = (key: Buffer) => key.every((byte) => byte === 0);

it("zeroes the keys it unwrapped when the text fails to open", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  const { wrapped } = keys.generateConnectionKey(connectionId);
  await admin.connection.update({
    where: { id: connectionId },
    data: { keyVersion: wrapped.version, keyCiphertext: wrapped.ciphertext },
  });
  const { derived, unwrapped } = recordingKeys();

  await expect(
    withOwner(runtime, p, (tx) => derived.open(tx, "message-1", sealed!)),
  ).rejects.toThrow();
  expect(unwrapped).toHaveLength(2);
  expect(unwrapped.every(zeroed)).toBe(true);
});

it("zeroes the keys it unwrapped when a later key fails to unwrap", async () => {
  const p = await student();
  const sourceId = await source(p);
  const connectionId = await connection(p);
  const sealed = await seal(p, "message-1", [sourceId], [connectionId]);
  await admin.connection.update({
    where: { id: connectionId },
    data: { keyCiphertext: Buffer.alloc(60).toString("base64") },
  });
  const { derived, unwrapped } = recordingKeys();

  await expect(
    withOwner(runtime, p, (tx) => derived.open(tx, "message-1", sealed!)),
  ).rejects.toThrow();
  expect(unwrapped).toHaveLength(1);
  expect(unwrapped.every(zeroed)).toBe(true);
});
