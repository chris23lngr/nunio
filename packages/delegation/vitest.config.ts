import { defineConfig } from "vitest/config";

// Each test file starts its own Postgres container, and settle-held starts the real operator command
// several times. One file at a time keeps the shared CI runner from starving other packages' tests.
export default defineConfig({ test: { testTimeout: 30_000, fileParallelism: false } });
