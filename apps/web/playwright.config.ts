import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  testMatch: "**/*.browser.ts",
  workers: 1,
  outputDir: ".next/playwright-results",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node test/browser/api-server.ts",
      url: "http://localhost:3101/health",
    },
    {
      command: "bun run dev --port 3100",
      url: "http://localhost:3100/sign-in",
      env: { API_ORIGIN: "http://localhost:3101" },
      timeout: 120_000,
    },
  ],
});
