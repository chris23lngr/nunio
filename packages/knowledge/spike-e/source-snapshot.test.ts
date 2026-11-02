import { randomBytes, randomUUID } from "node:crypto";
import { GetObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { createSourceStorage } from "../src/storage.js";
import { hetzner, sseCHeaders } from "./hetzner.ts";

it("parses and promotes the fixed quarantine snapshot even if the browser overwrites its upload", async () => {
  const { s3, buckets } = hetzner();
  const storage = createSourceStorage({ s3, ...buckets });
  const id = `phase5-snapshot/${randomUUID()}`;
  const key = randomBytes(32), original = randomBytes(100), replacement = randomBytes(100);
  try {
    const upload = await storage.upload(id, key, original.length);
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: original })).ok).toBe(true);
    const fixed = await storage.download(id, key);
    expect((await fetch(upload.url, { method: "PUT", headers: upload.headers, body: replacement })).ok).toBe(true);
    const read = await fetch(fixed.url, { headers: { ...sseCHeaders(key), "if-match": fixed.etag } });
    expect(read.status).toBe(200);
    expect(Buffer.from(await read.arrayBuffer())).toEqual(original);
    await storage.promote(id, key);
    const promoted = await s3.send(new GetObjectCommand({ Bucket: buckets.sources, Key: id,
      SSECustomerAlgorithm: "AES256", SSECustomerKey: key.toString("base64") }));
    expect(Buffer.from(await promoted.Body!.transformToByteArray())).toEqual(original);
  } finally { await storage.remove(id); }
  const remaining = await s3.send(new ListObjectVersionsCommand({ Bucket: buckets.sources, Prefix: id }));
  expect(remaining.Versions ?? []).toEqual([]);
  expect(remaining.DeleteMarkers ?? []).toEqual([]);
}, 60_000);
