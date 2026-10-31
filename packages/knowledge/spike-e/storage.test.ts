import { randomBytes, randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { hetzner, presignGet, presignPut, promote, sseCHeaders } from "./hetzner.ts";

describe("Hetzner storage (spike e)", () => {
  const { s3, buckets } = hetzner();

  it("expires quarantine objects after 7 days", async () => {
    const { Rules } = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: buckets.quarantine }),
    );
    expect(Rules).toEqual([
      expect.objectContaining({ Status: "Enabled", Expiration: expect.objectContaining({ Days: 7 }) }),
    ]);
  });

  it("versions sources and expires noncurrent versions after 30 days", async () => {
    const versioning = await s3.send(new GetBucketVersioningCommand({ Bucket: buckets.sources }));
    expect(versioning.Status).toBe("Enabled");

    const { Rules } = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: buckets.sources }),
    );
    expect(Rules).toEqual([
      expect.objectContaining({
        Status: "Enabled",
        NoncurrentVersionExpiration: expect.objectContaining({ NoncurrentDays: 30 }),
      }),
    ]);
  });

  it("stores an upload through a presigned PUT and returns it only with its key", async () => {
    const key = randomBytes(32);
    const body = randomBytes(1024);
    const objectKey = `spike-e/${randomUUID()}`;

    const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey, key, contentLength: body.length });
    const uploaded = await fetch(put, { method: "PUT", headers: sseCHeaders(key), body });
    expect(uploaded.status).toBe(200);

    const get = await presignGet(s3, { bucket: buckets.quarantine, objectKey, key });
    const withKey = await fetch(get, { headers: sseCHeaders(key) });
    expect(withKey.status).toBe(200);
    expect(Buffer.from(await withKey.arrayBuffer())).toEqual(body);

    const withoutKey = await fetch(get);
    expect(withoutKey.ok).toBe(false);
  });

  it("promotes an upload from quarantine to sources under the same key", async () => {
    const key = randomBytes(32);
    const body = randomBytes(2048);
    const objectKey = `spike-e/${randomUUID()}`;
    const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey, key, contentLength: body.length });
    expect((await fetch(put, { method: "PUT", headers: sseCHeaders(key), body })).status).toBe(200);

    const { versionId } = await promote(s3, { from: buckets.quarantine, to: buckets.sources, objectKey, key });
    expect(versionId).toBeTruthy();

    const get = await presignGet(s3, { bucket: buckets.sources, objectKey, key });
    const res = await fetch(get, { headers: sseCHeaders(key) });
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
  });

  // ADR-0007 amendment: if this starts passing, Hetzner supports plain CopyObject with SSE-C.
  it("answers CopyObject on an SSE-C source with 501 Not Implemented", async () => {
    const key = randomBytes(32);
    const objectKey = `spike-e/${randomUUID()}`;
    const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey, key, contentLength: 16 });
    expect((await fetch(put, { method: "PUT", headers: sseCHeaders(key), body: randomBytes(16) })).status).toBe(200);

    const sseKey = key.toString("base64");
    const copy = s3.send(
      new CopyObjectCommand({
        CopySource: `${buckets.quarantine}/${objectKey}`,
        Bucket: buckets.sources,
        Key: objectKey,
        CopySourceSSECustomerAlgorithm: "AES256",
        CopySourceSSECustomerKey: sseKey,
        SSECustomerAlgorithm: "AES256",
        SSECustomerKey: sseKey,
      }),
    );
    await expect(copy).rejects.toMatchObject({ $metadata: { httpStatusCode: 501 } });
  });

  describe("rejects", () => {
    const objectKey = () => `spike-e/${randomUUID()}`;

    it("a body longer than the signed length", async () => {
      const key = randomBytes(32);
      const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey: objectKey(), key, contentLength: 1024 });
      const res = await fetch(put, { method: "PUT", headers: sseCHeaders(key), body: randomBytes(4096) });
      expect(res.status).toBe(403);
    });

    it("an upload without the SSE-C headers", async () => {
      const key = randomBytes(32);
      const put = await presignPut(s3, { bucket: buckets.quarantine, objectKey: objectKey(), key, contentLength: 16 });
      const res = await fetch(put, { method: "PUT", body: randomBytes(16) });
      expect(res.status).toBe(403);
    });

    it("a download with the wrong key", async () => {
      const key = randomBytes(32);
      const ref = { bucket: buckets.quarantine, objectKey: objectKey(), key };
      const put = await presignPut(s3, { ...ref, contentLength: 16 });
      expect((await fetch(put, { method: "PUT", headers: sseCHeaders(key), body: randomBytes(16) })).status).toBe(200);

      const get = await presignGet(s3, ref);
      const res = await fetch(get, { headers: sseCHeaders(randomBytes(32)) });
      expect(res.ok).toBe(false);
    });
  });
});
