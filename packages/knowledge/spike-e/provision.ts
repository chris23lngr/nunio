// Creates or updates the two buckets of ADR-0007; safe to re-run. Usage, from packages/knowledge:
//   set -a; . ./.env.staging; set +a; node spike-e/provision.ts
import type { S3Client } from "@aws-sdk/client-s3";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { hetzner } from "./hetzner.ts";

const appOrigins = (process.env.HETZNER_CORS_ORIGINS ?? "")
  .split(",")
  .filter(Boolean);
if (appOrigins.length === 0) throw new Error("HETZNER_CORS_ORIGINS is not set");

// Browsers send the Source's key with every request, so CORS must allow the SSE-C headers.
const sseCHeaders = [
  "x-amz-server-side-encryption-customer-algorithm",
  "x-amz-server-side-encryption-customer-key",
  "x-amz-server-side-encryption-customer-key-md5",
];

// Hetzner answers BucketAlreadyExists even for our own buckets, so check ownership first.
async function createBucket(s3: S3Client, bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`exists  ${bucket}`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`created ${bucket}`);
  }
}

async function allowBrowser(
  s3: S3Client,
  bucket: string,
  method: "PUT" | "GET",
) {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: appOrigins,
            AllowedMethods: [method],
            AllowedHeaders: ["content-type", ...sseCHeaders],
            ExposeHeaders: ["etag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}

const { s3, buckets } = hetzner();

// quarantine: browser upload target, unversioned, objects expire after 7 days.
await createBucket(s3, buckets.quarantine);
await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: buckets.quarantine,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "expire-after-7-days",
          Status: "Enabled",
          Filter: { Prefix: "" },
          Expiration: { Days: 7 },
        },
      ],
    },
  }),
);
await allowBrowser(s3, buckets.quarantine, "PUT");

// sources: versioned, noncurrent versions expire after 30 days.
await createBucket(s3, buckets.sources);
await s3.send(
  new PutBucketVersioningCommand({
    Bucket: buckets.sources,
    VersioningConfiguration: { Status: "Enabled" },
  }),
);
await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: buckets.sources,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "expire-noncurrent-after-30-days",
          Status: "Enabled",
          Filter: { Prefix: "" },
          NoncurrentVersionExpiration: { NoncurrentDays: 30 },
        },
      ],
    },
  }),
);
await allowBrowser(s3, buckets.sources, "GET");
console.log("done");
