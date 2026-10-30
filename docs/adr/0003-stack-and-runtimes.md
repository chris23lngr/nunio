# Stack, runtimes, and API contract

nunio is a Turborepo monorepo with four independently deployed apps: `web` (Next.js), `api` (Hono, REST), `worker` (Temporal), and `parser` (see ADR-0009). Prisma 7 is the data layer and Better Auth the auth layer. All apps run on **Node in production**; Bun is used only as package manager and test runner. We chose Node because Temporal workers are officially Node-only, Bun as a production runtime is beta on Vercel and absent from the Next.js and Prisma 7 support matrices, and the brief puts engineering quality before experimental pieces. The API stays Fetch-native so moving it to Bun later is a configuration change, not a rewrite.

The API is REST with schema-defined Hono routes that generate an OpenAPI spec. `openapi.json` is committed, and CI fails when it drifts from the routes, so every contract change is a reviewable diff. The web app consumes a generated `packages/api-client` (`openapi-typescript` + `openapi-fetch`) rather than importing the API's types directly. That keeps the apps decoupled and serves planned native clients.

Pin exact versions: in particular `prisma` and `@prisma/client` at 7.10.x, because the CLI's `latest` tag currently points to a Prisma 8 release candidate. Evidence: [runtime-hosting.md](../research/runtime-hosting.md).

## Considered Options

- **Bun as production runtime**: the founder's original preference, deferred until a compatibility spike passes after the pilot stabilises.
- **tRPC, or Hono's typed client with a type-only import**: faster end-to-end types with a single client, rejected in favour of a documented HTTP contract that webhooks, the extension interface, and native apps can share.
- **Fastify / Elysia**: Fastify isn't Fetch-native, and Elysia is Bun-first.

## Amendment (2026-10-30): Vitest instead of `bun test`

Tests run on Node with Vitest, not with `bun test`. Production runs on Node, and Temporal strongly discourages running workers under Bun, so workflow and integration tests must run on the same runtime as production. Bun remains the package manager.
