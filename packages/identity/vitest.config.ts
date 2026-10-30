import { defineConfig } from "vitest/config";

// Password hashing against real Postgres is slow on shared 2-vCPU CI runners.
export default defineConfig({ test: { testTimeout: 15_000 } });
