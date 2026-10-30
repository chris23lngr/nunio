import { fileURLToPath } from "node:url"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config.js"

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          plugins: [
            storybookTest({
              configDir: fileURLToPath(
                new URL("./.storybook", import.meta.url),
              ),
            }),
          ],
          test: {
            name: "storybook",
            // Keep Chromium within the CI runner's CPU/memory budget.
            maxWorkers: 1,
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  }),
)
