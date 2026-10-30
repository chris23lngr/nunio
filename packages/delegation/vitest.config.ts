import { defineConfig } from "vitest/config";

// The revocation test starts the real operator command twice; process startup is slow on shared CI runners.
export default defineConfig({ test: { testTimeout: 15_000 } });
