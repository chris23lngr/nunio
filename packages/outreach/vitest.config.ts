import { defineConfig } from "vitest/config";

// Integration tests start Postgres.
export default defineConfig({ test: { testTimeout: 30_000 } });
