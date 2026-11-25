import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { afterEach, expect, it } from "vitest";
import { testCertificate } from "./certificate.js";

let child: ChildProcess | undefined;

afterEach(() => {
  child?.kill();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

it("runs standalone over HTTPS on a given host and port, under its public URL", async () => {
  const { ca, key, cert } = testCertificate();
  setDefaultCACertificates([...getCACertificates("default"), ca]);
  const dir = mkdtempSync(join(tmpdir(), "nunio-fake-mcp-"));
  writeFileSync(join(dir, "tls.key"), key);
  writeFileSync(join(dir, "tls.crt"), cert);
  const port = await freePort();
  const url = `https://localhost:${port}`;

  child = spawn(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "run-fake-mcp.ts")],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        PUBLIC_URL: url,
        TLS_KEY: join(dir, "tls.key"),
        TLS_CERT: join(dir, "tls.crt"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    child!.stdout!.once("data", () => resolve());
    child!.once("exit", (code) => reject(new Error(`exited with ${code}`)));
  });

  const metadata = await fetch(
    `${url}/.well-known/oauth-protected-resource/mcp`,
  );
  expect(await metadata.json()).toMatchObject({
    resource: `${url}/mcp`,
    authorization_servers: [url],
  });
});
