import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { SourceStorage } from "./sources.js";

export function createSourceStorage({
  s3,
  quarantine,
  sources,
}: {
  s3: S3Client;
  quarantine: string;
  sources: string;
}): SourceStorage {
  const unhoistableHeaders = new Set([
    "x-amz-server-side-encryption-customer-algorithm",
    "x-amz-server-side-encryption-customer-key",
    "x-amz-server-side-encryption-customer-key-md5",
  ]);
  const ssec = (key: Buffer) => ({
    SSECustomerAlgorithm: "AES256",
    SSECustomerKey: key.toString("base64"),
  });
  const snapshotPath = (id: string) => `sealed/${id}`;
  const copy = async (
    from: string,
    fromKey: string,
    to: string,
    toKey: string,
    key: Buffer,
  ) => {
    const target = { Bucket: to, Key: toKey };
    const { UploadId } = await s3.send(
      new CreateMultipartUploadCommand({ ...target, ...ssec(key) }),
    );
    try {
      const { CopyPartResult } = await s3.send(
        new UploadPartCopyCommand({
          ...target,
          UploadId,
          PartNumber: 1,
          ...ssec(key),
          CopySource: `${from}/${fromKey}`,
          CopySourceSSECustomerAlgorithm: "AES256",
          CopySourceSSECustomerKey: key.toString("base64"),
        }),
      );
      await s3.send(
        new CompleteMultipartUploadCommand({
          ...target,
          UploadId,
          MultipartUpload: {
            Parts: [{ PartNumber: 1, ETag: CopyPartResult?.ETag }],
          },
        }),
      );
    } catch (error) {
      await s3.send(new AbortMultipartUploadCommand({ ...target, UploadId }));
      throw error;
    }
  };
  return {
    async upload(id, key, bytes) {
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: quarantine,
          Key: id,
          ContentLength: bytes,
          ...ssec(key),
        }),
        {
          expiresIn: 300,
          unhoistableHeaders,
          signableHeaders: new Set(["content-length"]),
        },
      );
      return {
        url,
        expiresAt: new Date(Date.now() + 300_000),
        headers: {
          "x-amz-server-side-encryption-customer-algorithm": "AES256",
          "x-amz-server-side-encryption-customer-key": key.toString("base64"),
          "x-amz-server-side-encryption-customer-key-md5": createHash("md5")
            .update(key)
            .digest("base64"),
        },
      };
    },
    async download(id, key) {
      // The signed browser PUT can be replayed. Parse a worker-only snapshot inside quarantine;
      // Hetzner does not enforce CopySourceIfMatch on multipart copy (Phase 5 live regression).
      await copy(quarantine, id, quarantine, snapshotPath(id), key);
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: quarantine,
          Key: snapshotPath(id),
          ...ssec(key),
        }),
      );
      if (!head.ETag) throw new Error("Missing upload ETag");
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: quarantine,
          Key: snapshotPath(id),
          IfMatch: head.ETag,
          ...ssec(key),
        }),
        { expiresIn: 300, unhoistableHeaders },
      );
      return { url, keyBase64: key.toString("base64"), etag: head.ETag };
    },
    async promote(id, key) {
      // ADR-0007 amendment / spike e: CopyObject returns501 for SSE-C; multipart copy works.
      await copy(quarantine, snapshotPath(id), sources, id, key);
      await s3.send(new DeleteObjectCommand({ Bucket: quarantine, Key: id }));
      await s3.send(
        new DeleteObjectCommand({ Bucket: quarantine, Key: snapshotPath(id) }),
      );
    },
    async remove(id) {
      await s3.send(new DeleteObjectCommand({ Bucket: quarantine, Key: id }));
      await s3.send(
        new DeleteObjectCommand({ Bucket: quarantine, Key: snapshotPath(id) }),
      );
      // Delete every retained version, not only a new delete marker. No Source key is required.
      let KeyMarker: string | undefined, VersionIdMarker: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectVersionsCommand({
            Bucket: sources,
            Prefix: id,
            KeyMarker,
            VersionIdMarker,
          }),
        );
        const versions = [
          ...(page.Versions ?? []),
          ...(page.DeleteMarkers ?? []),
        ]
          .filter((v) => v.Key === id)
          .map((v) => ({ Key: id, VersionId: v.VersionId }));
        if (versions.length) {
          const result = await s3.send(
            new DeleteObjectsCommand({
              Bucket: sources,
              Delete: { Objects: versions },
            }),
          );
          if (result.Errors?.length)
            throw new Error("Source object cleanup incomplete");
        }
        KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        VersionIdMarker = page.NextVersionIdMarker;
      } while (KeyMarker);
    },
  };
}
export function sourceStorageFromEnv(env: NodeJS.ProcessEnv): SourceStorage {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return createSourceStorage({
    s3: new S3Client({
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 15_000 },
      endpoint: required("HETZNER_S3_ENDPOINT"),
      region: required("HETZNER_S3_REGION"),
      credentials: {
        accessKeyId: required("HETZNER_S3_ACCESS_KEY_ID"),
        secretAccessKey: required("HETZNER_S3_SECRET_ACCESS_KEY"),
      },
    }),
    quarantine: required("HETZNER_QUARANTINE_BUCKET"),
    sources: required("HETZNER_SOURCES_BUCKET"),
  });
}
