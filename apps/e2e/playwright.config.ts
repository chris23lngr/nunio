import { defineConfig, devices } from "@playwright/test";
import { target } from "./origins.js";

export default defineConfig({
  testDir: "tests",
  testIgnore: target === "local" ? "**/sse-c-browser.spec.ts" : [],
  grep: target === "staging" ? /@staging/ : undefined,
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  globalTimeout: 5 * 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    // The local CA isn't in the browser's trust store; cookies still get https semantics.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
});
