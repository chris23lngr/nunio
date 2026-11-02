import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

// ADR-0009: the parser holds no secrets, so a secret in its environment is a deployment mistake.
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", new URL("./index.ts", import.meta.url).pathname], {
    env: { PATH: process.env.PATH ?? "", PORT: "0", PARSER_QUARANTINE_BUCKET: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (output += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (output += d));
  return { child, output: () => output };
}

describe("the parser entrypoint", () => {
  it("refuses to start with a secret in its environment", async () => {
    const { child, output } = start({ HETZNER_S3_SECRET_ACCESS_KEY: "leaked" });
    const [code] = await once(child, "exit");
    expect(code).not.toBe(0);
    expect(output()).toContain("HETZNER_S3_SECRET_ACCESS_KEY");
    expect(output()).not.toContain("leaked");
  });

  it("starts with only non-secret variables", async () => {
    const { child, output } = start({ RENDER_SERVICE_NAME: "nunio-parser-staging", NODE_ENV: "production" });
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => output().includes("parser listening") && (clearInterval(timer), resolve()), 50);
    });
    child.kill("SIGTERM");
    await once(child, "exit");
  });
});

it("refuses a Source master-key map without disclosing its value", async () => {
  const { child, output } = start({ SOURCE_MASTER_KEYS: "master-key-material" });
  const exited = once(child, "exit");
  const timer = setTimeout(() => child.kill(), 1_500);
  try {
    await exited;
    expect(output()).toContain("refusing to start with secrets");
    expect(output()).toContain("SOURCE_MASTER_KEYS");
    expect(output()).not.toContain("master-key-material");
  } finally { clearTimeout(timer); }
});
