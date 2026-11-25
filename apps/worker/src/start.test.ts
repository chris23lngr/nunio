import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";

it("refuses to start on Render with INTEGRATION_FAKES set", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", new URL("./index.ts", import.meta.url).pathname],
    {
      env: { ...process.env, INTEGRATION_FAKES: "true", RENDER: "true" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const [code] = await once(child, "exit");

  expect(code).not.toBe(0);
  expect(stderr).toContain("INTEGRATION_FAKES must not be set on a deployment");
}, 30_000);
