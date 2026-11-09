import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { createCerts } from "./certs.js";
import {
  cookieDomain,
  origins,
  ports,
  spikeWebhookSecret,
  target,
} from "./origins.js";

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const certs = createCerts(join(here, ".certs"), [
    new URL(origins.app).hostname,
    new URL(origins.api).hostname,
    new URL(origins.evil).hostname,
  ]);
  const ca = readFileSync(certs.caPath);
  const tls = {
    NODE_EXTRA_CA_CERTS: certs.caPath,
    TLS_KEY: certs.keyPath,
    TLS_CERT: certs.certPath,
  };
  const children: ChildProcess[] = [];
  let db: TestDatabase | undefined;
  const cleanup = async () => {
    await Promise.all(children.map(stop));
    await db?.stop();
  };

  try {
    if (target === "staging") {
      const evil = start("evil", {
        ...process.env,
        ...tls,
        PORT: String(ports.evil),
      });
      children.push(evil);
      await waitFor(`${origins.evil}/`, ca, evil);
    } else {
      // Browser fixtures reset limiter state; they must never share an externally supplied database.
      if (process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) {
        throw new Error(
          "Local browser tests require a disposable database; unset DATABASE_URL and DATABASE_URL_UNPOOLED",
        );
      }
      db = await startTestDatabase();
      const shared = {
        ...process.env,
        NODE_ENV: "production" as const,
        ...tls,
      };
      children.push(
        start("api", {
          ...shared,
          PORT: String(ports.api),
          DATABASE_URL: db.runtimeConnectionString,
          BETTER_AUTH_URL: origins.api,
          BETTER_AUTH_SECRET: "spike-b-e2e-secret-that-is-long-enough",
          APP_ORIGIN: origins.app,
          COOKIE_DOMAIN: cookieDomain,
          SPIKE_ROUTES: "true",
          SPIKE_WEBHOOK_SECRET: spikeWebhookSecret,
          SCW_PROJECT_ID: "test-project",
          SCW_SECRET_KEY: "test-key",
          AUTH_EMAIL_FROM: "accounts@nunio.test",
          VAPID_PUBLIC_KEY: "test-vapid-key",
          UNSUBSCRIBE_SECRET: "test-unsubscribe-secret",
          SOURCE_KEY_VERSION: "test",
          SOURCE_MASTER_KEYS: JSON.stringify({
            test: Buffer.alloc(32, 1).toString("base64"),
          }),
          HETZNER_S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
          HETZNER_S3_REGION: "fsn1",
          HETZNER_S3_ACCESS_KEY_ID: "test",
          HETZNER_S3_SECRET_ACCESS_KEY: "test",
          HETZNER_QUARANTINE_BUCKET: "nunio-quarantine-test",
          HETZNER_SOURCES_BUCKET: "nunio-sources-test",
          // Required at API startup for Chat; no e2e flow asks a question, and the host never resolves.
          OPENROUTER_API_KEY: "test",
          OPENROUTER_BASE_URL: "https://openrouter.invalid/api/v1",
        }),
        start("web", {
          ...shared,
          PORT: String(ports.app),
          WEB_DIR: join(here, "../web"),
          API_ORIGIN: origins.api,
        }),
        start("evil", { ...shared, PORT: String(ports.evil) }),
      );

      // Only Playwright workers provision verified account fixtures.
      process.env.INVITATION_DATABASE_URL = db.connectionString;

      await Promise.all([
        waitFor(`${origins.api}/health`, ca, children[0]!),
        waitFor(`${origins.app}/sign-in`, ca, children[1]!),
        waitFor(`${origins.evil}/`, ca, children[2]!),
      ]);
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function start(name: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(here, "servers", `${name}.ts`)],
    {
      env,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  child.on("exit", (code) => {
    if (code) console.error(`[${name}] exited with code ${code}`);
  });
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
  });
}

async function waitFor(
  url: string,
  ca: Buffer,
  child: ChildProcess,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${url} server exited before readiness`);
    const ok = await new Promise<boolean>((resolve) => {
      const req = request(url, { ca, timeout: 1_000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
      req.end();
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not come up within ${timeoutMs} ms`);
}
