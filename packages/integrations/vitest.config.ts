import { defineConfig } from "vitest/config";

// The mail tests start GreenMail and wait on client timeouts.
export default defineConfig({ test: { testTimeout: 30_000 } });
