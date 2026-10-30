import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTestDatabase } from "@nunio/db/testing";
import { createCerts } from "./certs.js";
import { cookieDomain, origins, ports, spikeWebhookSecret, target } from "./origins.js";

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const certs = createCerts(join(here, ".certs"), [
    new URL(origins.app).hostname,
    new URL(origins.api).hostname,
    new URL(origins.evil).hostname,
  ]);
  const ca = readFileSync(certs.caPath);
  const tls = { NODE_EXTRA_CA_CERTS: certs.caPath, TLS_KEY: certs.keyPath, TLS_CERT: certs.certPath };

  if (target === "staging") {
    const evil = start("evil", { ...process.env, ...tls, PORT: String(ports.evil) });
    await waitFor(`${origins.evil}/`, ca);
    return async () => {
      evil.kill();
    };
  }

  const db = await startTestDatabase();

  const shared = {
    ...process.env,
    NODE_ENV: "production" as const,
    ...tls,
  };
  const children = [
    start("api", {
      ...shared,
      PORT: String(ports.api),
      DATABASE_URL: db.connectionString,
      BETTER_AUTH_URL: origins.api,
      BETTER_AUTH_SECRET: "spike-b-e2e-secret-that-is-long-enough",
      APP_ORIGIN: origins.app,
      COOKIE_DOMAIN: cookieDomain,
      SPIKE_ROUTES: "true",
      SPIKE_WEBHOOK_SECRET: spikeWebhookSecret,
      SCW_PROJECT_ID: "test-project",
      SCW_SECRET_KEY: "test-key",
      AUTH_EMAIL_FROM: "accounts@nunio.test",
    }),
    start("web", {
      ...shared,
      PORT: String(ports.app),
      WEB_DIR: join(here, "../web"),
      API_ORIGIN: origins.api,
    }),
    start("evil", { ...shared, PORT: String(ports.evil) }),
  ];

  // Only Playwright workers provision verified account fixtures.
  process.env.INVITATION_DATABASE_URL = db.connectionString;

  await Promise.all([
    waitFor(`${origins.api}/health`, ca),
    waitFor(`${origins.app}/sign-in`, ca),
    waitFor(`${origins.evil}/`, ca),
  ]);

  return async () => {
    for (const child of children) child.kill();
    await db.stop();
  };
}

function start(name: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", join(here, "servers", `${name}.ts`)], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    if (code) console.error(`[${name}] exited with code ${code}`);
  });
  return child;
}

async function waitFor(url: string, ca: Buffer, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      request(url, { ca }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      })
        .on("error", () => resolve(false))
        .end();
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not come up within ${timeoutMs} ms`);
}
