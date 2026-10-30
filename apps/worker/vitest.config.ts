import { defineConfig } from "vitest/config";

// Workflow tests start Temporal's dev server and bundle workflow code; both are slow on CI runners.
export default defineConfig({ test: { testTimeout: 30_000 } });
