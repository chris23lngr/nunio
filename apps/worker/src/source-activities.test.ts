import { describe, expect, it } from "vitest";
import { createSourceActivities } from "./source-activities.js";

const env = {
  DATABASE_URL: "postgresql://runtime@127.0.0.1:5432/nunio",
  SOURCE_KEY_VERSION: "v1", SOURCE_MASTER_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString("base64") }),
  HETZNER_S3_ENDPOINT: "https://fsn1.your-objectstorage.com", HETZNER_S3_REGION: "fsn1",
  HETZNER_S3_ACCESS_KEY_ID: "access", HETZNER_S3_SECRET_ACCESS_KEY: "secret",
  HETZNER_QUARANTINE_BUCKET: "quarantine", HETZNER_SOURCES_BUCKET: "sources",
  OPENROUTER_API_KEY: "key", OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1", PARSER_HOSTPORT: "parser:10000",
};

describe("Source activities", () => {
  it("refuse to start without their settings, naming every missing one", async () => {
    const partial = { ...env, HETZNER_S3_ACCESS_KEY_ID: undefined, OPENROUTER_API_KEY: "" };
    expect(() => createSourceActivities(partial)).toThrow("Missing settings: HETZNER_S3_ACCESS_KEY_ID, OPENROUTER_API_KEY");
  });

  it("start with a complete configuration", async () => {
    const { close } = createSourceActivities(env);
    await close();
  });
});
