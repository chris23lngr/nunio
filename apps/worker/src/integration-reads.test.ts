import type { PrismaClient } from "@nunio/db";
import { principal } from "@nunio/delegation";
import { afterEach, expect, it, vi } from "vitest";
import { integrationReadsFromEnv } from "./agent-run-activities.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it("still reads nothing, but fails each read clearly and names the missing settings, when the worker has no Connection credential keys", async () => {
  const logged = vi.spyOn(console, "log").mockImplementation(() => {});
  // Never touched: without the keys no credential is read.
  const db = {} as PrismaClient;

  const reads = integrationReadsFromEnv({}, db);
  const session = reads.open(
    principal.fromSession({ studentId: "s-1" }),
    "connection-1",
  );
  const read = await session.read(
    "notes.search",
    { query: "Klausur" },
    { signal: new AbortController().signal },
  );
  await session.close();

  expect(read).toEqual({
    outcome: "failed",
    text: "This Connection can't be read right now.",
  });
  const lines = logged.mock.calls.map(([line]) => String(line));
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line).toContain("CONNECTION_CREDENTIAL_KEY_VERSION");
    expect(line).toContain("CONNECTION_CREDENTIAL_MASTER_KEYS");
  }
});
