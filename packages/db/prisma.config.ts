import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/",
  migrations: { path: "prisma/migrations" },
  // Neon's unpooled URL, CLI only. Read leniently so `prisma generate` runs without it.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
