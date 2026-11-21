import { once } from "node:events";
import { Worker } from "node:worker_threads";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: TestDatabase;
const instances: Worker[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  // Separate workers isolate Better Auth's module-level memory counters, like API instances.
  for (let i = 0; i < 2; i++) {
    const instance = new Worker(
      `
      import { parentPort, workerData } from "node:worker_threads";
      import { createPool, createPrismaClient } from "@nunio/db";
      import { createAuth } from ${JSON.stringify(new URL("./auth.ts", import.meta.url).href)};

      const origin = "https://app.nunio.test";
      const prisma = createPrismaClient(createPool(workerData));
      const auth = createAuth({
        prisma,
        baseURL: "https://api.nunio.test",
        appOrigin: origin,
        trustedOrigins: [origin],
        secret: "rate-limit-test-secret-that-is-long-enough",
        email: { projectId: "test-project", secretKey: "test-key", from: "accounts@nunio.test" },
      });
      // Lets a test move this instance's clock past the 60-second resend wait.
      const realNow = Date.now;
      let offsetMs = 0;
      Date.now = () => realNow() + offsetMs;
      parentPort.on("message", async ({ ip, count, email, guess, clockOffsetMs = 0 }) => {
        offsetMs = clockOffsetMs;
        const request = (path, body, forwardedFor) =>
          auth.handler(new Request(\`https://api.nunio.test/api/auth\${path}\`, {
            method: "POST",
            headers: { origin, "content-type": "application/json", "x-forwarded-for": forwardedFor },
            body: JSON.stringify(body),
          }));
        const responses = await Promise.all(Array.from({ length: count }, (_, i) =>
          !email
            // A fresh address per attempt, so only the limit per IP applies.
            ? request("/sign-in/email-otp", { email: \`\${crypto.randomUUID()}@example.com\`, otp: "000000" }, ip)
            // One address from many IPs, so only the limits per address apply.
            : guess
              ? request("/sign-in/email-otp", { email, otp: guess }, \`\${ip}.\${i}\`)
              : request("/email-otp/send-verification-otp", { email, type: "sign-in" }, \`\${ip}.\${i}\`)
        ));
        parentPort.postMessage(responses.map(response => response.status));
      });
      parentPort.postMessage("ready");
    `,
      {
        eval: true,
        execArgv: ["--import", "tsx"],
        workerData: db.runtimeConnectionString,
        env: { ...process.env, NODE_ENV: "production" },
      },
    );
    instances.push(instance);
    await once(instance, "message");
  }
}, 180_000);

afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.terminate()));
  await db?.stop();
});

async function attempts(
  instance: Worker,
  ip: string,
  count: number,
  email?: string,
  options: { guess?: string; clockOffsetMs?: number } = {},
): Promise<number[]> {
  const response = once(instance, "message");
  instance.postMessage({ ip, count, email, ...options });
  const [statuses] = await response;
  return statuses;
}

describe("shared authentication rate limits", () => {
  it("limits combined code sign-in attempts across independent API instances", async () => {
    const ip = "198.51.100.10";
    expect(await attempts(instances[0]!, ip, 2)).toEqual([400, 400]);
    expect(await attempts(instances[1]!, ip, 1)).toEqual([400]);
    expect(await attempts(instances[0]!, ip, 1)).toEqual([429]);
  });

  it("admits only three concurrent code sign-in attempts across API instances", async () => {
    const responses = (
      await Promise.all(
        instances.map((instance) => attempts(instance, "198.51.100.20", 12)),
      )
    ).flat();

    expect(responses.filter((status) => status === 400)).toHaveLength(3);
    expect(responses.filter((status) => status === 429)).toHaveLength(21);
  });

  it("sends one code per address at a time across API instances", async () => {
    // The address has no account or Invitation, so nothing reaches Scaleway.
    const responses = (
      await Promise.all(
        instances.map((instance, i) =>
          attempts(instance, `198.51.${100 + i}`, 6, "concurrent@example.com"),
        ),
      )
    ).flat();

    expect(responses.filter((status) => status === 200)).toHaveLength(1);
    expect(responses.filter((status) => status === 429)).toHaveLength(11);
  });

  it("sends at most five codes an hour to one address across API instances", async () => {
    const statuses: number[] = [];
    for (let send = 0; send < 6; send++)
      statuses.push(
        ...(await attempts(
          instances[send % 2]!,
          `203.0.113.${send}`,
          1,
          "hourly@example.com",
          { clockOffsetMs: (send + 1) * 61_000 },
        )),
      );

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("allows ten wrong guesses an hour for one address across API instances", async () => {
    const guess = { guess: "000000" };
    const address = "guesses@example.com";
    expect(
      await attempts(instances[0]!, "203.0.114", 5, address, guess),
    ).toEqual(Array(5).fill(400));
    expect(
      await attempts(instances[1]!, "203.0.115", 5, address, guess),
    ).toEqual(Array(5).fill(400));
    expect(
      await attempts(instances[0]!, "203.0.116", 1, address, guess),
    ).toEqual([429]);
  });

  it("admits only ten concurrent wrong guesses for one address across API instances", async () => {
    const responses = (
      await Promise.all(
        instances.map((instance, i) =>
          attempts(
            instance,
            `203.0.${117 + i}`,
            6,
            "concurrent-guesses@example.com",
            {
              guess: "000000",
            },
          ),
        ),
      )
    ).flat();

    expect(responses.filter((status) => status === 400)).toHaveLength(10);
    expect(responses.filter((status) => status === 429)).toHaveLength(2);
  });
});
