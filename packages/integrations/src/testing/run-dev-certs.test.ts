import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

async function writeCerts(dir: string): Promise<void> {
  await run(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "run-dev-certs.ts")],
    { env: { ...process.env, CERTS_DIR: dir } },
  );
}

it("writes a dev CA and a mail.nunio.test certificate for GreenMail, and keeps them on the next run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nunio-dev-certs-"));

  await writeCerts(dir);

  const caPem = readFileSync(join(dir, "ca.crt"), "utf8");
  const ca = new X509Certificate(caPem);
  const leaf = new X509Certificate(readFileSync(join(dir, "tls.crt")));
  expect(leaf.checkHost("mail.nunio.test")).toBe("mail.nunio.test");
  expect(leaf.verify(ca.publicKey)).toBe(true);
  expect(new Date(leaf.validTo).getTime()).toBeGreaterThan(
    Date.now() + 300 * 24 * 3600 * 1000,
  );
  expect(readFileSync(join(dir, "greenmail.p12")).length).toBeGreaterThan(0);

  await writeCerts(dir);
  expect(readFileSync(join(dir, "ca.crt"), "utf8")).toBe(caPem);
}, 30_000);
