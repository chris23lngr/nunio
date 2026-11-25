import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The deployed entrypoint never runs the fakes, even if the platform's own variable is missing.
it("refuses to start with INTEGRATION_FAKES set at all, without VERCEL", async () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("INTEGRATION_FAKES", "false");

  await expect(import("./index.js")).rejects.toThrow(
    "INTEGRATION_FAKES must not be set on a deployment",
  );
});
