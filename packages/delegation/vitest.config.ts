import { defineConfig } from "vitest/config";

// Integration tests start Postgres and invoke the real operator command several times.
export default defineConfig({ test: { testTimeout: 30_000 } });
