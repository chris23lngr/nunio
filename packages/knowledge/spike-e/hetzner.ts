// Spike e (docs/operations/spike-results.md): Hetzner Object Storage access from the environment.
import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const hetznerConfigured = Boolean(process.env.HETZNER_S3_ACCESS_KEY_ID);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (packages/knowledge/.env.staging)`);
  return value;
}

export function hetzner() {
  return {
    s3: new S3Client({
      endpoint: required("HETZNER_S3_ENDPOINT"),
      region: required("HETZNER_S3_REGION"),
      credentials: {
        accessKeyId: required("HETZNER_S3_ACCESS_KEY_ID"),
        secretAccessKey: required("HETZNER_S3_SECRET_ACCESS_KEY"),
      },
    }),
    buckets: {
      quarantine: required("HETZNER_QUARANTINE_BUCKET"),
      sources: required("HETZNER_SOURCES_BUCKET"),
    },
  };
}

/** The SSE-C headers a client sends with every request for an object encrypted under `key`. */
export function sseCHeaders(key: Buffer): Record<string, string> {
  return {
    "x-amz-server-side-encryption-customer-algorithm": "AES256",
    "x-amz-server-side-encryption-customer-key": key.toString("base64"),
    "x-amz-server-side-encryption-customer-key-md5": createHash("md5").update(key).digest("base64"),
  };
}

// The key travels in headers, never in the URL, and the length is part of the signature.
const unhoistableHeaders = new Set(Object.keys(sseCHeaders(Buffer.alloc(32))));
const expiresIn = 300;

interface ObjectRef {
  bucket: string;
  objectKey: string;
  key: Buffer;
}

export function presignPut(
  s3: S3Client,
  { bucket, objectKey, key, contentLength }: ObjectRef & { contentLength: number },
) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentLength: contentLength,
    SSECustomerAlgorithm: "AES256",
    SSECustomerKey: key.toString("base64"),
  });
  return getSignedUrl(s3, command, {
    expiresIn,
    unhoistableHeaders,
    signableHeaders: new Set(["content-length"]),
  });
}

export function presignGet(s3: S3Client, { bucket, objectKey, key }: ObjectRef) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    SSECustomerAlgorithm: "AES256",
    SSECustomerKey: key.toString("base64"),
  });
  return getSignedUrl(s3, command, { expiresIn, unhoistableHeaders });
}

const maxPartBytes = 5 * 1024 ** 3;

/**
 * The worker's step: server-side copy from `from` to `to`, both sides under the Source's key.
 * Hetzner answers CopyObject on an SSE-C source with 501, so this is a multipart copy instead.
 */
export async function promote(
  s3: S3Client,
  { from, to, objectKey, key }: { from: string; to: string; objectKey: string; key: Buffer },
) {
  const ssec = { SSECustomerAlgorithm: "AES256", SSECustomerKey: key.toString("base64") };
  const copySource = {
    CopySource: `${from}/${objectKey}`,
    CopySourceSSECustomerAlgorithm: "AES256",
    CopySourceSSECustomerKey: ssec.SSECustomerKey,
  };
  const { ContentLength: size = 0 } = await s3.send(
    new HeadObjectCommand({ Bucket: from, Key: objectKey, ...ssec }),
  );
  const target = { Bucket: to, Key: objectKey };
  const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ ...target, ...ssec }));
  try {
    const parts = [];
    for (let start = 0, PartNumber = 1; start < size || PartNumber === 1; start += maxPartBytes, PartNumber++) {
      const end = Math.min(start + maxPartBytes, size) - 1;
      const { CopyPartResult } = await s3.send(
        new UploadPartCopyCommand({
          ...target,
          ...ssec,
          ...copySource,
          UploadId,
          PartNumber,
          ...(size > maxPartBytes && { CopySourceRange: `bytes=${start}-${end}` }),
        }),
      );
      parts.push({ PartNumber, ETag: CopyPartResult?.ETag });
    }
    const { VersionId } = await s3.send(
      new CompleteMultipartUploadCommand({ ...target, UploadId, MultipartUpload: { Parts: parts } }),
    );
    return { versionId: VersionId };
  } catch (error) {
    await s3.send(new AbortMultipartUploadCommand({ ...target, UploadId }));
    throw error;
  }
}
