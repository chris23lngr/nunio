import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
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
