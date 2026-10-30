import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: TestDatabase;
const instances: Worker[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  // Separate workers isolate Better Auth's module-level memory counters, like API instances.
  for (let i = 0; i < 2; i++) {
    const instance = new Worker(`
      import { parentPort, workerData } from "node:worker_threads";
      import { createPool, createPrismaClient } from "@nunio/db";
      import { createAuth } from ${JSON.stringify(new URL("./auth.ts", import.meta.url).href)};

      const origin = "https://app.nunio.test";
      const prisma = createPrismaClient(createPool(workerData));
      const auth = createAuth({
        prisma,
        baseURL: "https://api.nunio.test",
        trustedOrigins: [origin],
        secret: "rate-limit-test-secret-that-is-long-enough",
        email: { projectId: "test-project", secretKey: "test-key", from: "accounts@nunio.test" },
      });
      parentPort.on("message", async ({ ip, count }) => {
        const responses = await Promise.all(Array.from({ length: count }, () =>
          auth.handler(new Request("https://api.nunio.test/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin, "content-type": "application/json", "x-forwarded-for": ip },
            body: JSON.stringify({ email: "unknown@example.com", password: "incorrect password" }),
          }))
        ));
        parentPort.postMessage(responses.map(response => response.status));
      });
      parentPort.postMessage("ready");
    `, {
      eval: true,
      execArgv: ["--import", "tsx"],
      workerData: db.connectionString,
      env: { ...process.env, NODE_ENV: "production" },
    });
    instances.push(instance);
    await once(instance, "message");
  }
}, 180_000);

afterAll(async () => {
  await Promise.all(instances.map(instance => instance.terminate()));
  await db?.stop();
});

async function attempts(instance: Worker, ip: string, count: number): Promise<number[]> {
  const response = once(instance, "message");
  instance.postMessage({ ip, count });
  const [statuses] = await response;
  return statuses;
}

describe("shared authentication rate limits", () => {
  it("limits combined sign-in attempts across independent API instances", async () => {
    const ip = "198.51.100.10";
    expect(await attempts(instances[0]!, ip, 2)).toEqual([401, 401]);
    expect(await attempts(instances[1]!, ip, 1)).toEqual([401]);
    expect(await attempts(instances[0]!, ip, 1)).toEqual([429]);
  });

  it("admits only three concurrent sign-in attempts across API instances", async () => {
    const responses = (await Promise.all(
      instances.map(instance => attempts(instance, "198.51.100.20", 12)),
    )).flat();

    expect(responses.filter(status => status === 401)).toHaveLength(3);
    expect(responses.filter(status => status === 429)).toHaveLength(21);
  });
});
