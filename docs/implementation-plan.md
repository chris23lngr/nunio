# nunio pilot implementation plan

Status: Phase 6 verified, 2026-11-08; Phase 7 implemented, pending founder review of the retrieval eval, 2026-11-08; Phase 8 implemented, pending the Estimate eval, 2026-11-09; Phase 10 implemented, pending push checks on real devices, 2026-11-09; Phase 11 implemented, pending an import into the supported Anki version, 2026-11-10. Phase 14 (Chat tools) planned, 2026-11-12; it precedes the Phase 12 gates. Phase 5 is complete apart from its staging checks: deletion during processing, and retrieval and citation deletion against staging. Domain terms follow [GLOSSARY.md](../GLOSSARY.md). Decisions follow [ADRs 0001–0014](adr/). Module interfaces follow [delegation-gate.md](design/delegation-gate.md), [knowledge-retrieval.md](design/knowledge-retrieval.md), [extraction.md](design/extraction.md), and [outreach.md](design/outreach.md). Each phase is meant to be executable in a fresh session: read the phase's documentation references before writing code.

## Primary goal

Pilot students can upload their real course materials and, within ten minutes, review an accurate, sourced picture of their Courses and Obligations. They then use an invite-only pilot with no fixed end date, in which nunio keeps their Plan organized and helps them study. It acts only within permissions they explicitly granted, on infrastructure that keeps student data in the EU, deletes it on request, and survives failures without repeating consequential Actions.

## Decision gates outside the phases

- **Before Phase 12 (deferred by the founder on 2026-10-30):** choose observability and error tracking (EU-hosted or EU-region). The brief requires background-job monitoring before the pilot, so this is a pilot-readiness gate. Until then, rely on platform logs (Vercel, Render) and the Temporal Cloud UI.
- **Phase 3:** Scaleway Transactional Email is selected for verification and password recovery (EU processing, DPA). The processing boundary is recorded in [ADR-0013](adr/0013-scaleway-for-authentication-email.md). Phase 10 notification email uses the same provider with content-free messages ([ADR-0014](adr/0014-content-free-notification-email-on-scaleway.md)).
- **Before Phase 9 (optional):** `prototype` the delegation gate's state machine (Approval expiry, Unconfirmed, Pause mid-Run, Budget exhaustion) as a throwaway.
- **Before connector work (post-pilot):** collect the pilot tool inventory. No Integration or verified Destination is built until then; Submissions are Handoffs during the pilot.

---

## Phase 0: Documentation discovery (complete)

> **How this serves the primary goal:** every later phase copies from verified APIs instead of guessing. Wrong APIs are the fastest way to fragile code, and the brief puts engineering quality before scope.

Consolidated from [foundation.md](research/foundation.md), [durable-ai.md](research/durable-ai.md), [identity-billing-security.md](research/identity-billing-security.md), [runtime-hosting.md](research/runtime-hosting.md), [ai-providers.md](research/ai-providers.md), [pilot-delivery.md](research/pilot-delivery.md), and three discovery passes on 2026-10-29. All versions are npm `latest` on that date. Pin exact versions and commit the lockfile.

### Version baseline

| Package                                               | Version                 | Note                                                                |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `next`                                                | 16.4.3                  | middleware is now `proxy.ts` (Node runtime)                         |
| `hono`                                                | 4.13.14                 | `export default app`; `hono/vercel` `handle` is deprecated          |
| `@hono/zod-openapi` / `zod`                           | 1.6.3 / 4.x             | requires Zod 4; import `z` from `@hono/zod-openapi`                 |
| `openapi-typescript` / `openapi-fetch`                | 7.13.0 / 0.17.0         | openapi-fetch is 0.x, so pin it exactly                             |
| `better-auth`                                         | 1.7.14                  |                                                                     |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg`      | **7.10.1**              | `latest` is 8.0.0-rc.28: always install `@7.10.1`                   |
| `@temporalio/*`                                       | 1.24.x or 1.25.0        | 1.25.0 shipped 2026-10-27; pin all `@temporalio/*` to one version   |
| `testcontainers`, `@testcontainers/postgresql`        | 12.2.1                  | image `pgvector/pgvector:0.8.7-pg18`, matching Neon's PG major      |
| `turbo`                                               | ≥ 2.10 (2.11.10 latest) | for Bun `bun.lock` pruning                                          |
| `vercel` CLI                                          | 65.8.0                  |                                                                     |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | 3.1160.0                |                                                                     |
| `@vercel/functions`                                   | 3.10.5                  | `awsCredentialsProvider` from `@vercel/functions/oidc`              |
| `@openrouter/ai-sdk-provider`                         | 3.1.0                   | peer `ai ^7`; base URL `https://eu.openrouter.ai/api/v1` (ADR-0012) |

### Allowed APIs (copy from these locations)

- **Turborepo:** `tasks`, `dependsOn: ["^build"]`, `outputs`, `inputs`, strict env mode, `turbo prune <app> --docker` (`out/json`, `out/full`). Sources: [foundation.md](research/foundation.md) table; turborepo `examples/with-docker/apps/web/Dockerfile` (adapt from yarn to Bun).
- **Vercel:**
  - One project per app with Root Directory `apps/web` or `apps/api`. `vercel.json` `{"regions":["fra1"]}` and `"git": {"deploymentEnabled": {"main": false}}`, which keeps PR preview builds.
  - CI: `vercel pull --yes --environment=…`, `vercel build [--prod]`, `vercel deploy --prebuilt [--prod]`, with `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`.
  - Sources: vercel.com/docs/monorepos/turborepo; vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel; vercel.com/docs/project-configuration/git-configuration.
- **Hono:**
  - `new OpenAPIHono({ defaultHook })`, `createRoute({ method, path, request, responses })`, `app.openapi(route, handler)`, `c.req.valid('json'|'param'|'query')`.
  - The `getOpenAPI31Document(config)` result is written to `apps/api/openapi.json`.
  - Sources: vercel.com/docs/frameworks/backend/hono, "Exporting the Hono application"; honojs/middleware `packages/zod-openapi/README.md`, "Usage" and "OpenAPI v3.1".
- **API client:**
  - `openapi-typescript ./openapi.json -o src/schema.d.ts`.
  - `createClient<paths>({ baseUrl, credentials: "include" })`; middleware via `client.use()`.
  - Source: openapi-ts.dev/openapi-fetch.
- **Better Auth:**
  - `app.all("/api/auth/*", c => auth.handler(c.req.raw))`, after `cors({ origin: "https://app.nunio.app", credentials: true })`.
  - Options `trustedOrigins`, `baseURL`, `advanced.crossSubDomainCookies: { enabled: true, domain: "nunio.app" }`.
  - Session lookup `auth.api.getSession({ headers })`. Client: `createAuthClient({ baseURL: "https://api.nunio.app" })` from `better-auth/react`.
  - Prisma adapter `prismaAdapter(prisma, { provider: "postgresql" })`.
  - Sources: better-auth.com/docs/integrations/hono, /docs/concepts/cookies "Cross Subdomain Cookies", /docs/adapters/prisma, /docs/concepts/session-management.
- **Next.js 16:** `proxy.ts` with `export function proxy(request)` and a static `config.matcher`; `getSessionCookie()` from `better-auth/cookies` for presence-only checks. Source: nextjs.org/docs/app/api-reference/file-conventions/proxy.
- **Prisma 7:**
  - `prisma.config.ts` via `defineConfig` / `env` from `prisma/config`, with `schema: "prisma/"` (multi-file schema is GA). `datasource.url` is Neon's **unpooled** URL, used for the CLI only.
  - Generator `provider = "prisma-client"`, with `output` required.
  - Runtime client: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`, or `new PrismaPg(pool)` with `attachDatabasePool(pool)` on Vercel Fluid compute.
  - pgvector: `CREATE EXTENSION IF NOT EXISTS vector;` inside a `migrate dev --create-only` migration. The column is `embedding Unsupported("vector(N)")?` (optional), written and queried via `$queryRaw`.
  - Deploy with `prisma migrate deploy`.
  - Sources: prisma.io/docs/orm/v7/... pages only (generators, schema location, postgresql-extensions, raw-queries, migrate deploy).
- **Neon:** pooled (`-pooler`, transaction mode) URL at runtime; unpooled for migrations; TCP `pg` on Fluid compute and Render. Use `SET LOCAL` inside transactions, never session `SET`. Sources: neon.com/docs/guides/prisma, /docs/connect/connection-pooling, /docs/guides/vercel-connection-methods.
- **Testcontainers:** `new PostgreSqlContainer("pgvector/pgvector:0.8.7-pg18").start()`, `getConnectionUri()`, `snapshot()` / `restoreSnapshot()`. Run `prisma migrate deploy` against it before the suite. Source: testcontainers-node `docs/modules/postgresql.md`.
- **Temporal:**
  - Workers: `Worker.create`, `proxyActivities` with explicit timeouts and retry, signals with `condition`, `patched()` / `deprecatePatch()`, and `TestWorkflowEnvironment` plus `Worker.runReplayHistory`. Source: [durable-ai.md](research/durable-ai.md).
  - Schedules: `client.schedule.create({ scheduleId, spec, action: { type: 'startWorkflow', … }, policies: { overlap } })`; `getHandle(id).pause()`, `.unpause()`, `.delete()`. Sample: `samples-typescript/schedules/src/*`.
  - Payload codec: `PayloadCodec { encode, decode }` instances passed as `dataConverter: { payloadCodecs: [...] }` to **both** `Worker.create` and `new Client`. Sample: `samples-typescript/encryption/src/encryption-codec.ts`.
  - Cloud connection: `NativeConnection.connect({ address, tls: true, apiKey })` for workers and `Connection.connect({ … })` for clients, or `loadClientConnectConfig()` from `@temporalio/envconfig`.
  - Docker: glibc base (`node:24-bookworm(-slim)` plus `ca-certificates`), never Alpine. CMD is `node` directly. SIGTERM is handled by default; set `shutdownGraceTime`.
- **Render:**
  - `render.yaml` with `type: worker` / `type: pserv`, `runtime: docker`, `region: frankfurt`, `dockerfilePath`, and `dockerContext` at the repo root. Use no `rootDir` (it breaks `turbo prune`). Also `buildFilter.paths`, `autoDeployTrigger: off`, and `maxShutdownDelaySeconds`.
  - Deploy from CI with `POST https://api.render.com/v1/services/{id}/deploys` `{ commitId }`, then poll.
  - OIDC to AWS: GA, Pro workspace, runtime only.
  - Sources: render.com/docs/blueprint-spec, /docs/private-services, /docs/oidc; api-docs.render.com/reference/create-deploy.
- **AI provider (interim, ADR-0012):**
  - OpenRouter via `@openrouter/ai-sdk-provider` with the EU base URL `https://eu.openrouter.ai/api/v1` only.
  - The organization guardrail restricts data regions to the EU; Zero Data Retention is enforced account-wide.
  - Sources: openrouter.ai/docs/guides/features/sovereign-ai, /docs/guides/features/guardrails, /docs/guides/routing/provider-selection.
  - The Bedrock entries in [ai-providers.md](research/ai-providers.md) (ADR-0011) apply after the switch back.
- **Hetzner S3:**
  - `new S3Client({ endpoint: "https://fsn1.your-objectstorage.com", region: "fsn1", requestChecksumCalculation: "WHEN_REQUIRED" })`.
  - `getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentLength, SSECustomerAlgorithm: "AES256", SSECustomerKey, SSECustomerKeyMD5 }), { expiresIn })`. The SSE-C headers stay signed headers that the browser must send. `ContentLength` is signed.
  - CORS via `aws s3api put-bucket-cors`.
  - Sources: aws-sdk-js-v3 `packages/s3-request-presigner`; docs.hetzner.com object-storage pages.
- **GitHub Actions:**
  - `oven-sh/setup-bun@v2`; `permissions: contents: read` by default; third-party actions pinned to full commit SHAs.
  - Environments and their secrets need **GitHub Pro or Team** for a private repo. Required reviewers are not available on private repos below Enterprise, so protect deploys with branch protection plus environment secrets.

### Anti-patterns (things that do not exist or must not be used)

- Do not use `npx prisma`, `bunx prisma`, or unversioned Prisma docs URLs: they resolve to Prisma 8.
- Do not use `directUrl`, the `postgresqlExtensions` preview flag, `connection_limit` / `pool_timeout` URL params, or `prisma-client-js` (all removed or deprecated in v7).
- Do not use `hono/vercel` `handle`. Do not use Zod 3 with `@hono/zod-openapi`.
- Do not use `middleware.ts` in Next 16 (use `proxy.ts`), and do not set `runtime` in it.
- There is no `payloadCodecPath` option on Temporal's DataConverter. Do not use Alpine images for Temporal workers. Do not use `cronSchedule` (use Schedules).
- Do not use session-level `SET` through Neon's pooler, or `rootDir` on Render services built with `turbo prune`.
- Do not use OpenRouter's global endpoint (`openrouter.ai/api/v1`), Anthropic direct, Fable or Mythos models, forced `tool_choice`, structured-output modes that force a tool, or batch inference for student content (ADR-0011 rules, ADR-0012).
- Do not use a cached session for authorization decisions (disable Better Auth's cookie cache), and do not use `advanced.disableCSRFCheck` / `disableOriginCheck`.

---

## Phase 1: Accounts, domains, and secrets (human steps)

**Status (2026-10-30): done except the Vercel team.** It was completed with `scripts/setup-phase-1.sh`, and the record is in [operations/environments.md](operations/environments.md). The deviations:
- **Vercel team pending.** Deploys of `api` and `web` are blocked until it exists. `VERCEL_ORG_ID` must be set and `VERCEL_TOKEN` likely re-issued for the team.
- **AI provider is OpenRouter EU (ADR-0012)** instead of Bedrock. One AWS account is reserved for the later switch.
- **AWS policies** (retention, SCPs, OIDC roles) are not needed until the switch back to Bedrock.

> **How this serves the primary goal:** nothing can reach pilot students without real EU environments, and only the founder can create the accounts behind them.

**What to implement.** Generate a step-by-step script with the `wizard` skill, then run through it to:

1. Buy `nunio.app`. Choose a marketing domain, which must not be `nunio.app` (ADR-0005).
2. Create:
   - **GitHub:** the private repo (already initialised locally), on a plan with environments (Pro or Team).
   - **Vercel:** Pro team, two projects (`web`, `api`), staging and production environments.
   - **Render:** Pro workspace in Frankfurt, needed for OIDC.
   - **Neon:** a project in `aws-eu-central-1` with `staging` and `production` branches, production scale-to-zero off, PITR window ≤ 30 days (ADR-0007).
   - **Temporal Cloud:** namespaces `nunio-staging` and `nunio-prod` in AWS `eu-central-1`, retention 7 days, API keys.
   - **Hetzner:** an Object Storage project in `fsn1` (buckets are created in Phase 2).
   - **AWS:** an Organization with `bedrock-staging` and `bedrock-prod` accounts, SCPs from ADR-0011, Bedrock model access in `eu-central-1`.
3. Generate per-environment, per-purpose master keys (storage key-wrapping and the Temporal payload codec) with version IDs (ADR-0007), and store them only as platform secrets.
4. Record every account, region, and secret name, never secret values, in `docs/operations/environments.md`.

**Documentation references.** ADR-0004, 0005, 0007, 0008, 0011; [runtime-hosting.md](research/runtime-hosting.md) V6/V7; Temporal and Neon facts in this plan's Phase 0.

**Verification checklist.**
- [ ] Every service shows an EU region in its dashboard: Vercel `fra1`, Render Frankfurt, Neon `aws-eu-central-1`, Temporal `aws-eu-central-1`, Hetzner `fsn1`, Bedrock `eu-central-1`.
- [ ] `docs/operations/environments.md` lists each staging and production resource.
- [ ] No secret value appears in the repo (`git grep` for key prefixes).

**Anti-pattern guards.** Never accept a default region; Vercel defaults to `iad1`. Staging and production never share keys, databases, namespaces, or AWS accounts.

---

## Phase 2: Walking skeleton and compatibility spikes

> **How this serves the primary goal:** it proves the whole delivery path, from commit through CI and migrations to four running EU apps, before any feature depends on it. It also resolves every "unverified" compatibility question that could otherwise break a later slice.

**What to implement.**

1. **Monorepo.**
   - Bun workspaces plus Turborepo. Apps: `apps/web` (Next.js 16), `apps/api` (Hono plus `@hono/zod-openapi`), `apps/worker` (Temporal), `apps/parser` (Node HTTP, no secrets).
   - Packages: `db` (Prisma 7 multi-file schema, one file per owning module), `api-client` (generated), `keys`, `delegation`, `knowledge`, `planning`, `understanding`, `integrations`, `billing`, `identity`, `ai`, `ui`.
   - Copy the task graph rules from [foundation.md](research/foundation.md) and the Dockerfile shape from turborepo `examples/with-docker`, adapted to Bun.
2. **API contract.**
   - A health route defined with `createRoute`.
   - A script writes `getOpenAPI31Document()` to `apps/api/openapi.json`.
   - `packages/api-client` generated with `openapi-typescript`.
   - A CI drift check fails when `openapi.json` is stale (ADR-0003).
3. **CI (GitHub Actions)**, in this order:
   1. install (`bun install --frozen-lockfile`);
   2. typecheck, lint, and test (Testcontainers);
   3. `prisma migrate deploy` (unpooled URL);
   4. deploy api via `vercel deploy --prebuilt` (verified on interim Hobby staging);
   5. deploy worker and parser via the Render deploy API, polling until live;
   6. deploy web (verified on interim Hobby staging).

   Vercel `git.deploymentEnabled.main: false`, so PR preview builds stay UI-only (ADR-0005).
4. **Observability (deferred):** no error-tracking service yet. Apps log structured JSON to stdout so a provider can be added later without code changes; the Temporal Cloud UI shows worker and workflow health.
5. **Spikes.** Each one is a test or script kept in the repo:
   - **a. Prisma 7 + Better Auth on Node:** sign-up, sign-in, session, and revocation through `prismaAdapter`. Run on Testcontainers and against the staging Neon branch.
   - **b. Cross-origin session (verified on interim Hobby staging):** `app.` → `api.` with the cookie on `.nunio.app`. Next.js server-side session check by forwarding the cookie to `https://api.nunio.app/api/auth/get-session`. This has no official recipe, so it must be proven here. Cover CSRF and origin rejection from an untrusted origin.
   - **c. Hono on Vercel `fra1` (verified on interim Hobby staging):** cold start, a Stripe-style raw-body route, and `attachDatabasePool` with `PrismaPg(pool)`. Done on the interim Hobby staging; results in [spike-results.md](operations/spike-results.md#c-hono-on-vercel-fra1-2026-10-30). Re-run the idle cold start on the team.
   - **d. Temporal worker on Render:**
     - connects to Temporal Cloud with an API key;
     - a workflow waits on a signal, and survives a worker kill/restart and a redeploy;
     - drains on SIGTERM within `maxShutdownDelaySeconds`;
     - payload codec round trip, and the Temporal UI shows only ciphertext;
     - a replay test runs in CI.

     Done on 2026-10-30 ([spike-results.md](operations/spike-results.md#d-temporal-worker-on-render-2026-10-30)).
   - **e. Hetzner SSE-C (ADR-0007 gate):**
     - presigned PUT with SSE-C headers and a signed `ContentLength` from a browser on `app.`;
     - CORS allowing PUT and the SSE-C headers;
     - CopyObject from `quarantine` to `sources` with SSE-C;
     - presigned GET with SSE-C via `fetch()`;
     - noncurrent-version expiry configured.

     **If any of these fail, switch to the S3 `eu-central-1` fallback and record it as an ADR amendment.** Done: CopyObject with SSE-C is not implemented on Hetzner, so promotion uses a multipart copy and we stay on Hetzner (ADR-0007 amendment; [spike-results.md](operations/spike-results.md#e-hetzner-sse-c-2026-10-30)).
   - **f. OpenRouter EU check (ADR-0012), replacing the Bedrock guardrails below until the switch back:**
     - a request via `eu.openrouter.ai` succeeds, and one via the global endpoint is rejected (403);
     - list which Claude models and **embedding** models are served in-region with zero retention, and set the allowlist from that list;
     - structured output works without forcing a tool, and prompt caching passes through;
     - if no in-region embeddings exist, stop and raise a new decision before Phase 5.

     Done with international routing (2026-10-30): EU routing and the global-endpoint rejection are deferred to before pilot release. ZDR Claude and embedding models, structured output and caching are verified ([spike-results.md](operations/spike-results.md#f-openrouter-2026-10-30); ADR-0012 and ADR-0008 amendments).
   - **f′. Bedrock guardrails (only after switching back to ADR-0011):**
     - `GetInferenceProfile` for each allowlisted `eu.*` ID fails CI on a non-EU destination;
     - retention `none` is set and read back;
     - a `global.*` call is denied;
     - Vercel OIDC role assumption works from `api`;
     - **Render OIDC** works from `worker`. If it does, update ADR-0011 to drop worker access keys.
   - **g. Parser isolation:** `parser` runs as a Render private service with no secrets and is reachable only from `worker`. Done on 2026-10-30, with one limit: Render's private network admits every service in the workspace and region, so "only from the worker" holds in practice but isn't enforced ([spike-results.md](operations/spike-results.md#g-parser-isolation-2026-10-30)).

**Documentation references.** Phase 0 Allowed APIs; ADR-0003–0007, 0009, 0011; [foundation.md](research/foundation.md) "Required implementation proof"; [runtime-hosting.md](research/runtime-hosting.md) "Verification to carry into the plan".

**Verification checklist.**
- [x] A clean clone runs `bun install --frozen-lockfile`, then `turbo run build typecheck test`, all green. Verified by the CI `checks` job (also lint and local e2e).
- [x] Each app builds from its pruned Docker or Vercel artifact alone. Worker and parser Docker images run on Render; API and web deploy as Vercel prebuilt artifacts.
- [x] A commit on `main` deploys to staging in the documented order. [Successful run on `f115d29`](https://github.com/chris23lngr/nunio/actions/runs/41057920257): migration → API → parser/worker → web → staging e2e.
- [ ] A failing migration stops the pipeline before any app deploys. Enforced by the workflow's `needs` chain; a deliberate failing-migration exercise remains unperformed.
- [x] Spikes a–g each have a passing automated check or a recorded result in `docs/operations/spike-results.md`.
- [x] Changing `apps/api` routes without regenerating `openapi.json` fails CI. Drift rejection was proven during PR #1; the check remains in CI.

Closeout (2026-10-30): the walking skeleton is deployed and verified on interim staging. The migration-failure exercise above remains open. Carry forward the recorded spike limitations: repeat idle cold-start measurement on the Pro team, move auth rate limiting to shared storage in Phase 3, verify OpenRouter EU routing before pilot release, and decide how to enforce worker-only parser access before real parsing. The Render Blueprint now tracks `main` for both services.

**Anti-pattern guards.** No feature code in this phase. Do not auto-run migrations on app startup. Do not commit `.env` files. Do not weaken CORS or origin checks to make spike b pass. Use only the allowed APIs from Phase 0.

---

## Phase 3: Identity and tenant isolation

Agreed scope and sequencing: [identity-and-pilot-access.md](design/identity-and-pilot-access.md) (2026-10-30).

> **How this serves the primary goal:** every pilot student's materials and plans must be reachable only by them. Isolation has to exist before the first real upload.

**What to implement.**

1. `packages/identity`: the Better Auth server config (database sessions, cookie cache disabled, `trustedOrigins` = `app.` only, cross-subdomain cookie on `nunio.app`) and `authenticate(request) → Actor`.
2. Sign-up, sign-in, sign-out, session revocation, and account deletion request (initially queued for manual completion) in `web`.
3. `principal.fromSession` / `fromRun` (branded `Principal`, [delegation-gate.md](design/delegation-gate.md)).
4. **Postgres row-level security baseline.**
   - Separate migration and runtime roles.
   - `ENABLE` and `FORCE ROW LEVEL SECURITY` on owner-scoped tables.
   - A transaction-scoped `SET LOCAL app.owner_id`.
   - A pool-leakage test.
5. Pilot entitlement record per student in `packages/billing`: no fixed expiry, explicit founder revocation, finite Allowance that only the founder increases manually, with no automatic reset. Phase 4 defines and enforces usage amounts. No Stripe yet.

**Documentation references.**
- Phase 0 Better Auth and Next.js entries;
- [identity-billing-security.md](research/identity-billing-security.md), "Identity" and verification cases 1–3;
- [pilot-delivery.md](research/pilot-delivery.md), "Database isolation";
- PostgreSQL row security docs.

**Verification checklist.**
- [x] User A cannot read or mutate user B's data by changing IDs: API tests plus an RLS test under the runtime role. On staging (2026-10-30), the API connects as `nunio_api` (in `nunio_runtime`, no `BYPASSRLS`) and owner-scoped tables have forced RLS.
- [x] A revoked session cannot call authenticated routes. The local entitlement API test rejects a replayed cookie after sign-out; on staging, per-session sign-out, sign out everywhere, password reset and a deletion request each ended the affected sessions. Pilot revocation separately preserves the session and read access.
- [x] An untrusted origin cannot perform an authenticated mutation. Better Auth routes and `/api/me/*` refuse cookie-bearing requests from other origins; staging returns `403 forbidden_origin` for a foreign `Origin` on `/api/me/deletion-request`.
- [x] Concurrent requests for two users never leak `app.owner_id` across pooled connections. Proven by the `withOwner` pool test under the runtime role; staging runs the same code through the Neon pooler. [Deployed by run on `f4c0e62`](https://github.com/chris23lngr/nunio/actions/runs/41120921403).

**Anti-pattern guards.** Do not authorize from the cookie-presence check in `proxy.ts`. Never use the table owner or a `BYPASSRLS` role at runtime. Do not put Better Auth's server instance in `web`.

---

## Phase 4: Usage metering and Allowance

> **How this serves the primary goal:** the pilot is free with explicit usage limits, and extraction (Phase 6) is the first model call. Every model call must be reserved and settled before it happens.

**What to implement.**

1. In `packages/delegation`: `meter(p, estimate, call)` from [delegation-gate.md](design/delegation-gate.md).
   - Atomic reservation against the student's Allowance (and the Responsibility's Budget once Phase 9 exists), in one transaction with `SELECT … FOR UPDATE`.
   - Settle actual usage after the call; hold uncertain reservations.
   - Return `budget_exhausted` / `allowance_exhausted` as values.
2. `packages/ai`:
   - Model registry with only the in-region, zero-retention OpenRouter model IDs from spike f (`customProvider`). It is built so that switching to Bedrock (ADR-0011) changes only the registry.
   - Default model per task (ADR-0011 defaults, served via ADR-0012).
   - Bounded calls (`maxOutputTokens`, `maxRetries` coordinated with Temporal retries, `abortSignal`).
   - Each model carries a data-handling label.
3. Global AI kill switch (a configuration flag checked inside `meter`).

**Documentation references.** [delegation-gate.md](design/delegation-gate.md) "Invariants" (`meter`); [durable-ai.md](research/durable-ai.md) "AI SDK" and invariant 4; ADR-0011 rules for code; Phase 0 Bedrock entry.

**Verification checklist.**
- [x] N concurrent `meter` calls against one Allowance never exceed it (Testcontainers race test under the runtime role; automated CI coverage).
- [x] An uncertain call (timeout after send) keeps its reservation. Automated tests verify held reservations, manual settlement, and release after a definite provider rejection.
- [x] The kill switch refuses new calls without breaking reads. Automated coverage plus founder-confirmed manual staging checks (2026-11-02).
- [x] The registry rejects any model ID outside the allowlist. Automated registry tests.

Manual staging evidence (2026-11-02): the founder confirmed all manual Phase 4 checks passed, including the Allowance read, founder grant and audit check, and kill switch. This records founder-reported verification; concurrency and failure-path guarantees are covered by the automated tests above.

**Anti-pattern guards.** No model call outside `meter`. No SDK retries stacked on Temporal retries without explicit limits. No `global.*` IDs.

---

## Phase 5: Sources: upload, quarantine, parsing, and deletion

> **How this serves the primary goal:** uploads alone must be enough to deliver value. They must also be safe to accept and fully deletable.

**What to implement.**

1. `packages/keys`: generate a per-Source SSE-C key, wrap and unwrap it with a versioned master key, plus the Temporal payload codec key (ADR-0007).
2. **Upload flow:**
   1. The API validates the declared size and type, creates the Source record and key, and returns a presigned PUT to `quarantine` with SSE-C and a signed `ContentLength`.
   2. The browser uploads via `fetch()`.
   3. The API is notified and starts the ingestion workflow.
3. **Ingestion workflow (worker):**
   - Signature sniffing and size, page, and decompression limits. _Accepted deviation:_ these run in the parser, not the worker, so untrusted bytes are inspected only inside the secretless sandbox (ADR-0009).
   - The parser is called with a presigned GET plus the single file's key, and returns structured text.
   - Scanned pages are detected and routed to Claude image input via `meter` (ADR-0011).
   - Snapshot uploads to a worker-only key inside quarantine before parsing; on success, promote that snapshot to `sources` with SSE-C multipart copy and delete the quarantine copies (ADR-0007 amendment).
4. Chunking, with chunk text encrypted under the Source key ([knowledge-retrieval.md](design/knowledge-retrieval.md)). Embeddings via an in-region OpenRouter embedding model from spike f, chosen by the German eval (run the eval here; deprecation check first). _Accepted exception:_ the chosen model is not in-region; see the ADR-0012 Phase 5 amendment.
5. **Source deletion:** shred the key, delete embedding rows and derived rows in one transaction, and delete objects. Visible immediately everywhere.
6. Upload and AI entry points refuse students with a pending deletion request or a non-active pilot entitlement ([identity-and-pilot-access.md](design/identity-and-pilot-access.md)).

**Documentation references.**
- ADR-0007, ADR-0009;
- [identity-billing-security.md](research/identity-billing-security.md), "Files and agent execution" and verification case 4;
- OWASP File Upload Cheat Sheet;
- Phase 0 Hetzner and Temporal entries;
- [ai-providers.md](research/ai-providers.md), "Embeddings".

**Verification checklist.**
- [x] Oversized, mislabeled, malformed, and decompression-bomb uploads are refused by the Source/parser tests and never published. Linux container checks passed (2026-11-02); retrieval does not exist until Phase 7.
- [x] The parser refuses secret-bearing environments, including Source master-key maps; automated entrypoint and Linux container checks passed (2026-11-02).
- [ ] Staging deletion during processing and Phase 7 retrieval checks pending; staging deletion with both physical-cleanup sweeps passed (2026-11-02). Implemented: immediate key/chunk/vector deletion and a durable two-pass physical purge; the live storage regression verifies no versions remain after purge. Previously distributed keys/URLs and asynchronous cleanup are documented in the runbook.
- [x] Runtime-role Source tests refuse pending-deletion and revoked students at upload, completion and ingestion; metering also checks pending deletion before reserving. Staging acceptance remains pending.
- [x] Synthetic German/English embedding eval recorded in [phase-5-embedding-eval.json](operations/phase-5-embedding-eval.json); initial choice `baai/bge-m3`, 1024 dimensions, stored per vector row. The catalog/ZDR/deprecation check and synthetic German scan eval passed (2026-11-02); representative-syllabus quality thresholds remain a pilot-readiness gate.

Implementation evidence and deployment settings: [PDF Sources runbook](operations/environments.md#pdf-sources-phase-5). Local tests, container checks and synthetic live provider checks are not a staging end-to-end acceptance. Settings are provisioned and staging is deployed (2026-11-02); Phase 5 remains in progress until the remaining staging acceptance in the runbook is recorded.

**Anti-pattern guards.** Do not upload through the API body (4.5 MB Vercel limit). Never pass a master key to the parser or the browser. Do not trust MIME headers.

---

## Phase 6: Extraction and review (the ten-minute result)

> **How this serves the primary goal:** this is the brief's first-use value. From uploads alone, the student reviews their Courses, Obligations, Topics, and key Facts, each with its Provenance and uncertainty, within ten minutes.

**What to implement.**

1. An extraction workflow per Source: Haiku 5.5 via `meter` with `outputFormat` structured output (no personal data in schemas) produces Courses, Obligations (deadline, Destination if stated), Topics, course rules, and exam logistics. Each is a Fact with Provenance (Source and location) and uncertainty.
2. **Correction handling:**
   - Corrections win over re-extraction.
   - Disagreement from a newer Source is flagged, never applied.
   - Re-uploading a Source never silently overwrites a Correction (glossary: Correction).
3. A **review screen** in `web`: grouped by Course, each item showing its source passage, with Confirm, Correct, or Reject actions. Progress and timing from upload to the first reviewable result is instrumented.
4. Manual Obligation entry. _Moved:_ Projects are implemented in Phase 8, where planning first uses them (decided 2026-11-02).

The accepted design, including slicing, matching, and the eval, is [extraction.md](design/extraction.md).

**Documentation references.** [extraction.md](design/extraction.md); GLOSSARY ("Knowledge", "Study work", "Organization"); [knowledge-retrieval.md](design/knowledge-retrieval.md) "Correction merge"; brief "Complete study workflow" steps 1–3; ADR-0011.

**Verification checklist.**
- [x] An extraction eval set of representative German and English syllabi, including scans, has its precision and recall for Obligations and deadlines recorded. Pilot thresholds are set by the founder. Founder spot-checked labels; thresholds (2026-11-08): Obligations precision ≥ 0.95 and recall ≥ 0.85, deadlines precision ≥ 0.95 and recall ≥ 0.90, no invented dates. Haiku 5.5 meets them (Obligations 1.0/0.895, deadlines 1.0/1.0): [phase-6-extraction-eval.json](operations/phase-6-extraction-eval.json).
- [x] A Correction survives re-uploading a conflicting Source, and the conflict is flagged. Covered by `packages/knowledge/src/facts.test.ts`.
- [x] Median time from upload to a reviewable result is measured on the eval set (target ≤ 10 minutes). Measured: 14.8 s.
- [x] A syllabus containing injection instructions produces no Actions and no scope change. The injection document matched its labels exactly in the eval, and the adapter's recorded-response test covers it.

**Anti-pattern guards.** Never invent Obligations (glossary). No forced tool calls. Do not store extracted values without Provenance.

---

## Phase 7: Retrieval and Chat with citations

> **How this serves the primary goal:** sourced explanations of the student's own material are a core way the pilot helps them study. Scope enforcement is what makes them safe.

**What to implement.**

1. `packages/knowledge` read side, exactly as [knowledge-retrieval.md](design/knowledge-retrieval.md) specifies: `pin`, `retrieve`, `cite`, `ScopeRef`, the `Untrusted` type, `render()`, an exact filtered pgvector strategy, and the `{ planning: true }` Facts scope.
2. Chat in `web` and `api`:
   - explicit selection of Courses and Sources (empty means no Sources);
   - Sonnet 5.5 answers via `meter`, with retrieved data in a data slot;
   - citations stored as `CitationRef`s only and resolved via `cite()` at display time.
3. A Chat can start a Run. Proposing Actions from Chat waits for Phase 9. _Moved:_ `pin`, Run snapshots, widening, and starting a Run from a Chat move to Phase 9, where Runs and Run Principals exist (decided 2026-11-08).

**Documentation references.** [knowledge-retrieval.md](design/knowledge-retrieval.md) (entire); [durable-ai.md](research/durable-ai.md) "Postgres and pgvector" and invariant 5; OWASP Prompt Injection Cheat Sheet.

**Verification checklist.**
- [ ] The design doc's "Testing" scenarios all pass through the interface. The scope, deletion, Correction, untrusted-text and metering scenarios pass in `packages/knowledge/src/reader.test.ts`. Snapshot and widening scenarios move to Phase 9. Disconnect and operational items wait for Connections and Fixed Events (Phase 8). Strategy parity applies only once a second strategy exists. The error classes, the query-embedding cache, `revision`, `truncated` and the Fact tie-break are implemented and tested.
- [x] A deleted Source shows as "gone" in older Chat messages (`apps/api/src/create-app.test.ts`, "Chat").
- [x] A foreign or deselected Course never reaches a model request. The API test asserts on the captured prompt for a deselected and a foreign Source; the reader test covers a deselected Course and foreign IDs in `narrow`.
- [x] Measured German retrieval recall@k is recorded: [phase-7-retrieval-eval.json](operations/phase-7-retrieval-eval.json). Recall@1 0.43, @5 0.70, @8 0.74 on 23 draft questions over two module-handbook excerpts, at the calibrated relevance floor of 0.45; 12 unanswerable questions calibrate the floor. Labels pending founder spot-check; thresholds not yet set.

**Anti-pattern guards.** Do not splice retrieved text into system prompts. Do not widen scope on weak results. Do not add an approximate index without the parity suite.

---

## Phase 8: Planning and Home

> **How this serves the primary goal:** "I know what needs my attention" is the central promise. The Plan and Home turn reviewed Obligations into an actionable day.

**What to implement.**

1. `packages/planning`: a pure `rebalance(state) → proposal`.
   - Inputs: Tasks, Estimates, Obligations, Fixed Events, Protected Time, Preferences, Priorities, Locks, and Study Blocks the student placed.
   - Output: moves, a Shortfall with proposed tradeoffs, and which moves need Approval.
   - Planning never writes anything itself.
2. Tasks (visible and completable), Estimates (proposed and correctable), Study Blocks inside nunio's Plan, Locks, Priorities, Preferences, and Protected Time.
3. Fixed Events from manual entry or an uploaded `.ics` file, treated as operational Facts. Calendar Connections wait for the pilot tool inventory.
4. Projects (optional workspaces), moved from Phase 6: create, rename, and delete, related to zero or more Courses and optionally one Obligation.
5. Home: attention needed (Shortfalls, flagged disagreements), ready Artifacts, ongoing work.

**Documentation references.** GLOSSARY ("Planning", "Limits"); brief "User experience and information model"; [knowledge-retrieval.md](design/knowledge-retrieval.md) planning scope.

**Verification checklist.**
- [x] Table-driven tests cover the following (`packages/planning/src/rebalance.test.ts`):
  - `rebalance` never schedules into Protected Time or over Fixed Events;
  - it never moves a Locked Study Block;
  - it marks moves of student-placed blocks as needing Approval;
  - it reports a Shortfall instead of overfilling.
- [x] Overload scenarios surface a Shortfall with tradeoffs on Home (`apps/api/src/create-app.test.ts`, "Home").

**Anti-pattern guards.** No I/O in `rebalance`. Never silently drop an Obligation or remove Protected Time.

**Phase 8 decisions (2026-11-09; the founder approved each after the Phase 8 review).**
- **The student applies moves.** Approval, Actions and Grants arrive in Phase 9, so in Phase 8 the student applies a proposed move themselves, as their own decision. A move applies only while it matches a freshly computed proposal, so a stale or forged move is refused. Automatic Rebalance under Grants comes with Phase 9.
- **Rebalance** places work earliest deadline first, breaking ties by Priority, in 30-minute slots inside the study window and within the daily limits, on the student's local days. A Shortfall offers three tradeoffs: exceed the daily limit (breaks a Preference, so needs Approval), free time planned or just proposed for lower-Priority work, or reduce the Estimate. Obligations it cannot plan are `unplanned` (no Estimate, no deadline, past due), and a block the calendar now overlaps that stays put is an `overlap` (Locked, or no room before its deadline); nothing is dropped silently.
- **Unreviewed Obligations** are planned, so none is left out, but flagged on the Plan and Home as not reviewed.
- **Deadlines.** A deadline with only a date counts from the start of that day, so work is planned before an exam day, not on it.
- **Estimates** for Obligations and Tasks are proposed by Haiku 5.5 (task `estimation`) from the kind, title and Course only, in one metered call, and never replace the student's own. The proposals still need an eval before the pilot.
- **Preferences** apply task over course over global for the daily limit: a Task's own limit wins over its Course's, which wins over the global one, and the global limit still caps each day's total. The study window and time zone are global.
- **Priority** is one ranking of Courses, Projects and Obligations. An Obligation's own rank wins over that of a Project toward it, which wins over its Course's.
- **Protected Time** is weekly, or a one-off span such as a trip (up to a year).
- **Fixed Events** come from manual entry or a calendar Source: an `.ics` file the student adds (`ical.js`, MPL-2.0). Recurrences are expanded for the coming year when it is added, so adding it again extends them; each file's own `VTIMEZONE`s are honoured, floating times use the student's time zone, and all-day events are skipped and counted. Deleting a calendar Source removes its events immediately. Its events are operational, not course material, so they are not encrypted under a Source key. `knowledge`'s planning scope serves them as `fixed_event` Facts on the operational channel; a Chat cannot read them.
- **Projects** live in `knowledge` beside Courses, so retrieval can narrow to a Project's Courses.
- **Home** shows Shortfalls with tradeoffs, flagged Disagreements, overlapping blocks and unplannable work, then work in progress. Ready Artifacts (Phase 11) and Agent work (Phase 9) are shown as empty placeholders.

---

## Phase 9: Delegation gate, Responsibilities, and Runs

> **How this serves the primary goal:** "the work of keeping my studies organized is largely handled" requires proactive Runs. The gate is what guarantees they act only within explicit permissions and never repeat a consequential Action.

**What to implement.**

1. The rest of `packages/delegation` per [delegation-gate.md](design/delegation-gate.md):
   - `perform`, `decide`, `reconcile`, `history`;
   - per-kind definitions with a contract suite;
   - Restrictions that can only tighten;
   - the pure decision core;
   - an outbox, Attempts, and Unconfirmed handling.

   Pilot Action kinds: `studyBlock.create` and `studyBlock.move` within nunio's Plan.
2. Responsibilities as records plus Temporal Schedules (ADR-0006): Grants, Budget, Paused/Ended. Pause pauses the Schedule and stops the next Action. Budget exhaustion pauses and asks.
3. Runs as one workflow each:
   - Approval waits via signal with an expiry timer (7 days, capped at the Obligation's deadline);
   - an expired Approval raises an Intervention;
   - `reconcile` runs on a Schedule.
4. Approval cards in `web` showing the exact Action and fingerprint (ADR-0010). Chat-proposed Actions always go through the card.
5. Pilot Responsibility presets: "keep this course organized" (Rebalance plus Study Blocks) and "prepare me for this exam" (Topic coverage plus practice scheduling).
6. Responsibility screen: scope, Grants, recent Actions, next planned Action, usage against Budget, and pause control.

**Documentation references.** [delegation-gate.md](design/delegation-gate.md) (entire); ADR-0001, 0004, 0006, 0010; [durable-ai.md](research/durable-ai.md) "Verification to carry into the plan"; Phase 0 Temporal Schedules entry.

**Verification checklist.**
- [x] All gate-suite and contract-suite scenarios in the design doc that apply to the pilot pass (`gate.test.ts`, `kinds.test.ts`, `decision.test.ts`). Not applicable until Connections exist: `disconnected`. Vacuous for Study Block kinds, which make no model calls: "the estimate is at least the measured usage".
- [x] Killing the worker while a Run awaits Approval loses neither the Approval nor the continuation (`apps/worker/src/runs.test.ts`).
- [x] A Pause between two Actions stops the second (`gate.test.ts`, `runs.test.ts`).
- [x] Repeated Approval clicks dispatch once (`gate.test.ts`, `runs.test.ts`).
- [x] A stale Artifact version is refused: not applicable until Artifacts and Submissions exist (Phase 11). Its pilot counterpart, a block moved since its Approval, is refused with `approval_mismatch` (`gate.test.ts`).
- [x] Replaying recorded workflow histories against the current code succeeds in CI (`apps/worker/src/replay.test.ts`, including `responsibility-run`).

**Progress (2026-11-10).** The gate in `packages/delegation` is implemented: the gate suite (`gate.test.ts`), the contract suite (`kinds.test.ts`) and the table-driven decision core (`decision.test.ts`), with the pilot deviations recorded in [delegation-gate.md](design/delegation-gate.md). It covers "a Pause between two Actions stops the second", "repeated Approval clicks dispatch once", and, standing in for a stale Artifact version, a moved block refused with `approval_mismatch`.

**Progress (2026-11-11).** Responsibilities and Runs are implemented:
- `createResponsibilities` (create, pause, resume, end, view, startRun) with a `Schedules` port; the Temporal adapter in `apps/api` starts a Run daily at 06:00 in the student's time zone and skips a day while a Run still waits.
- The `responsibilityRun` workflow performs the preset's Actions under `runId:step` keys, waits on the `approvalDecided` signal or the Approval's expiry, raises an Intervention for an expired Approval or an Unconfirmed Action, and stops on Paused or Ended. Its tests (`apps/worker/src/runs.test.ts`) cover a worker restart while awaiting Approval, a Pause between Actions, and repeated Approval clicks; its recorded history replays in CI.
- `reconcileActions` runs every five minutes on a Schedule the worker ensures at start.
- The Plan executor (`createPlanExecutor`) records each key's effect with the effect itself, so its `lookup` is always certain; "keep this course organized" proposes the Rebalance of its Course (`plan.intentsFor`).
- Interventions are minimal records (`intervention`), deduplicated per trigger, for Phase 10's inbox.

**Progress (2026-11-12).** Approval cards and the Responsibility screen are implemented:
- `GET /api/me/approvals` shows each waiting Action exactly (work, Course, where its block is and would go), with its fingerprint and expiry; `POST /api/me/approvals/{actionId}` approves only the fingerprint shown (409 otherwise, 404 for another student's) or denies, then signals `approvalDecided` to the Run by its stored workflow and run ID. `GET /api/me/actions/unconfirmed` and `POST /api/me/actions/{actionId}/resolve` let the student resolve what nunio could not confirm.
- Responsibility routes create "keep this course organized" (fixed $1 Budget), list, show (scope, Grants, recent Actions, next Run at 06:00 and its first Action, Budget), pause, resume and end; the API reaches Temporal through `runWorkflowsFromEnv`. Home's Agent work lists the waiting Approvals and each Responsibility.
- `web` shows the cards on Home (`features/approvals`), and `/responsibilities` with each Responsibility's screen (`features/responsibilities`).
- Chat-origin Actions are not proposed yet: no Chat proposes an Action until a Chat can, so every card is a Run's.

**Progress (2026-11-13).** "Prepare me for this exam" is implemented as a reduced preset: a Responsibility scoped to one exam Obligation, with Grants to create and move Study Blocks for that exam only, whose Runs propose the Rebalance of that exam and its Tasks (`plan.intentsFor(p, { obligationId })`). Only an exam of the student's own qualifies. Topic coverage and practice scheduling wait for Phase 11, where practice items and Attempts exist; per-Topic Tasks would need a new Action kind.

**Anti-pattern guards.** No app code checks Grants itself. `delegation` never imports Temporal. Free text is never treated as an Approval. There are no global Grants.

---

## Phase 10: Outreach

> **How this serves the primary goal:** proactivity only helps if nunio reaches the student at the right time with the right Intervention, and the pilot measures Dismissals.

**What to implement.**

1. An in-app inbox as the source of truth for Interventions and Briefings (Dismissal means "not useful"; acknowledging is separate).
2. A daily Briefing preset; change alerts for flagged disagreements, Shortfalls, expired Approvals, and Unconfirmed Actions.
3. Email via the provider chosen at the decision gate.
4. Opt-in browser push (service worker, `PushManager.subscribe()`, generic payloads).
5. Quiet hours and frequency settings. Messages are deduplicated, and they are not Actions (glossary).

**Documentation references.** GLOSSARY ("Outreach"); [outreach.md](design/outreach.md) (entire); [outreach-delivery.md](research/outreach-delivery.md); [pilot-delivery.md](research/pilot-delivery.md), "Browser push"; ADR-0014 and the ADR-0008 amendment of 2026-11-09; brief "Proactivity and configuration".

**Verification checklist.**
- [x] Duplicate triggers produce one Intervention (`packages/outreach/src/tick.test.ts`, "raising Interventions from their causes").
- [x] Denied push permission leaves the product fully usable (`apps/web/test/push.test.tsx`, `apps/e2e/tests/push-denied.spec.ts`). Delivery on real Chrome, Firefox and iOS Home Screen devices is still to be checked after deploying.
- [x] A push delivery never marks anything complete (`tick.test.ts`, "push").
- [x] Dismissal and acknowledgement are recorded separately (`packages/outreach/src/inbox.test.ts`, `apps/web/test/inbox.test.tsx`).

**Progress (2026-11-09).** Outreach is implemented in `packages/outreach` per [outreach.md](design/outreach.md):
- The Inbox lists Interventions, open first, and the last seven Briefings. The student acknowledges or dismisses an open Intervention; either closes it once.
- A five-minute `outreachTick` Schedule in the worker derives each student's causes (Shortfalls, Disagreements, expired Approvals, Unconfirmed Actions), raises one Intervention per new cause, and lapses those whose cause is gone. Phase 9's `raiseIntervention` stays so recorded Runs replay; its rows use the same cause keys.
- A daily Briefing, at a time the student sets in their Plan's time zone, bundles open Interventions, waiting Approvals and active Responsibilities; it makes no model calls, and an empty day has none.
- Email (ADR-0014) and opt-in browser push carry no content: email gives a count and the Inbox link, push is empty and the service worker shows fixed text. Each channel is sent and retried independently; a push service's 404 or 410 deletes the subscription. Quiet Hours hold both; a daily limit counts announcements, not channel copies, and leaves Briefings out.
- Briefing emails carry RFC 8058 one-click unsubscribe headers, after a staging send confirmed TEM's DKIM signature covers them; the link stops only Briefing emails.
- Deviations from the design: `Pusher` names the VAPID key it signs with (`keyId`), and push is sent with `web-push` 3.6.7's `generateRequestDetails` and `fetch`, since the library always uses `https`. A `briefingEmail` setting and an `unsubscribe` signing dependency were added for one-click unsubscribe.

**Anti-pattern guards.** Do not route messages through the delegation gate. Do not put personal content in push payloads.

---

## Phase 11: Study execution

> **How this serves the primary goal:** the pilot measures work completed and demonstrated understanding separately. Students need practice, Feedback, explanations, and drafting help on their own material.

**What to implement.**

1. Practice sets as Artifacts, built from a Topic's scoped passages.
2. Attempts, Feedback, Self-assessment, and Evidence.
3. Understanding Levels: not yet practiced, shaky, solid, or disputed, each with a last-Evidence date and no decay (ADR-0002).
4. Flashcard export as an Anki-compatible TSV with an import preview ([pilot-delivery.md](research/pilot-delivery.md)).
5. Assignment drafting and review within the course AI-use rules (ask when they are unknown). Finished work goes through a **Handoff**: the student submits and confirms, which gives Reported as Submitted.

**Documentation references.** GLOSSARY ("Study work", "Understanding", "Handing in"); [study-execution.md](design/study-execution.md) (entire); ADR-0002; [pilot-delivery.md](research/pilot-delivery.md), "Flashcard export"; brief "Completion, submission, and integrations".

**Verification checklist.**
- [x] An Artifact never changes an Understanding Level (`packages/understanding/src/understanding.test.ts`, "moves a Topic's Level only through graded Attempts, never through Artifacts").
- [x] Disagreement between Self-assessment and Attempts shows as disputed (`levels.test.ts`, both directions; `understanding.test.ts`; `apps/web/test/study.test.tsx`).
- [ ] The Anki TSV round-trips German characters, delimiters, and multiline answers in the supported Anki version. The file format follows the Anki manual and is pinned by `packages/artifacts/src/anki.test.ts`; importing a file into Anki is still to be done.
- [x] Unknown AI-use rules cause nunio to ask instead of drafting (`packages/artifacts/src/artifacts.test.ts`, "refuses to write while the AI-use Rule is unknown…"; `apps/web/test/study.test.tsx`, "asks for the AI-use Rule while it is unknown…").

**Progress (2026-11-10).** Study execution is implemented per [study-execution.md](design/study-execution.md):
- `packages/artifacts` makes practice sets, flashcards, drafts and Critiques in Runs the student starts, from material pinned when they ask; every version is shredded with any Source it was drawn from. Drafts and Critiques follow the Obligation's AI-use Rule, checked at the request and again before the model is called; exams get none. Flashcards export as an Anki text file whose GUIDs survive edits.
- `packages/understanding` records Attempts with Feedback and Self-assessments; only graded Attempts move a Level, solid after two correct ones in a row.
- AI-use Rules are a Fact (`ai_use_rule`), and Reported as Submitted is a column on the Obligation that stops its planning.
- The worker makes each Artifact in an `artifactRun` workflow with a single attempt; the API serves the routes in the design; the web has `/study` (Topics with Levels, practice, flashcards, drafts, Critiques and the Handoff) and `/study/artifacts/[id]`, and Home lists ready Artifacts.
- Left for later: Briefings bundling ready Artifacts, practice inside the exam Responsibility, Practice Items quoted from the student's own Sources (`quoteFrom`), and photos of handwritten work.

**Anti-pattern guards.** No mastery percentages. No automatic Submission. No Destination is treated as verified.

---

## Phase 12: Pilot readiness gates

> **How this serves the primary goal:** the brief makes these controls preconditions for putting real students' data and studies in nunio's hands.

**What to implement and complete.**

1. **DPA review (ADR-0008):** Vercel, Neon, Temporal, Render, Hetzner, OpenRouter and the providers it routes to (ADR-0012), plus the email and observability providers. AWS Bedrock with its four checks joins the review on the switch back.
2. **Key operations:** documented rotation and compromise procedures for each master key, with one rotation rehearsed on staging.
3. **Evals:**
   - German retrieval;
   - scanned PDFs;
   - model defaults per task;
   - **agent safety:** permission enforcement, malicious document instructions, extraction errors, duplicate Actions, and false success claims.

   Thresholds are set by the founder.
4. **Backups and rollback:**
   - a tested Neon point-in-time restore into a scratch branch;
   - a documented app rollback per platform, plus a migration expand/contract rehearsal.
5. **Monitoring:** worker polling, workflow failures, stuck Approvals and Unconfirmed Actions, `meter` refusals, and error rates, all alerting.
6. **Data rights:**
   - data export end to end;
   - Source and account deletion end to end;
   - documented backup deletion schedules (30 days);
   - Disconnect behavior.
7. **Pilot limits:** per-student Allowance, Responsibility Budgets, and the kill switch documented.
8. **Pilot measurement:** coordination effort, Obligations caught or missed, work completed, Corrections and Dismissals, and willingness to pay (brief "Validation").

**Documentation references.** Brief "Security, privacy, and reliability" and "Validation"; ADR-0007, 0008, 0011; [identity-billing-security.md](research/identity-billing-security.md) verification cases 1–8.

**Verification checklist.**
- [ ] Each item above has a dated record in `docs/operations/pilot-readiness.md`.
- [ ] A restore drill has been performed, not just documented.
- [ ] Every eval has its result recorded next to its threshold.

**Anti-pattern guards.** No pilot release with any open gate. No real student data in staging.

---

## Phase 13: Verification

> **How this serves the primary goal:** this phase confirms that the system the students will use matches the decisions and designs it was planned against.
1. **Docs vs code.** Each module's interface matches its design doc (delegation, knowledge), and the ADRs match the deployed configuration (regions, retention, origins, models).
2. **Anti-pattern greps.** No hits on any of:
   - `prisma-client-js`, `directUrl`, `postgresqlExtensions`, `hono/vercel`, `middleware.ts`, `payloadCodecPath`, `cronSchedule`;
   - `https://openrouter.ai/api` (global endpoint), `global.anthropic`, `us.anthropic`, `tool_choice`, `jsonTool`;
   - `disableCSRFCheck`, `disableOriginCheck`, `FROM node:.*alpine`.
3. **Full test run.** Unit, contract, Testcontainers integration, workflow replay, and end-to-end on staging: upload a syllabus, review it, then a Responsibility Run proposes a Study Block, the student approves it, and the Action is done.
4. **First-use timing.** Re-measure the ten-minute result on staging with eval materials.

---

## Phase 14: Chat tools

> **How this serves the primary goal:** the student asks in one place about their material and what is due, and has nunio plan or prepare practice there, instead of switching screens. The Chat's selection, `meter` and the delegation gate keep this within explicit permissions.

Phase 14 is built before the Phase 12 gates, and its evals join them. Work happens on the integration branch `feat/chat-tools`, with one PR per stage into it and a single PR to `main` at the end.

**What to implement.**

1. **`packages/chat` and history.**
   - Move `createChats` and the ask flow out of `knowledge` without changing behaviour ([knowledge-retrieval.md](design/knowledge-retrieval.md), "Chat tools decisions").
   - Then send the last 10 questions and answers (ADR-0019, "History").
2. **Tool loop and search.**
   - First, a spike that verifies three things, each from `ai@7`'s behaviour, not its types. A check that fails becomes a decision for the founder before code builds on it.
     - Merging one `toUIMessageStream` per step renders in `useChat` without duplicated or reordered parts.
     - A server-built approval response continues a turn.
     - `@openrouter/ai-sdk-provider` passes `provider.require_parameters` through.
   - Then the step loop under `meter` (at most 6 steps, the last without tools) and `searchMaterial`.
   - Tool parts with client-only outputs and the sealed `parts` column (ADR-0016 amendment).
   - Removing `POST /api/me/chats/{id}/messages`.
   - The Model Catalog's tool-support condition (ADR-0018 amendment).
3. **Read tools** (ADR-0020):
   - `agenda({ from, to })`, up to 31 days: Obligations with deadline and review state, Tasks, Study Blocks and Fixed Events;
   - `courseFacts({ courseId })`: a Course's Facts with Provenance.
4. **Proposals.**
   - `proposeStudyBlockCreate` and `proposeStudyBlockMove`, checked against the Plan's rules and held for the student through `toolApproval`.
   - The gate Action recorded at commit.
   - The approval response on the stream route, then the continuation message.
   - Cards in the Chat and on Home.
5. **Artifacts.**
   - Tools that start a practice set or flashcards Run at commit, at most one per turn and only within the selection.
   - A status card linking to the Artifact.

**Documentation references.** ADR-0001, 0010, 0011, 0016, 0018, 0019, 0020; [delegation-gate.md](design/delegation-gate.md) "Chat origin"; [knowledge-retrieval.md](design/knowledge-retrieval.md) "Chat tools decisions"; [study-execution.md](design/study-execution.md); the AI SDK docs shipped in `packages/ai/node_modules/ai/docs`.

**Verification checklist.**
- [x] A follow-up question carries the history. The captured prompt holds the earlier questions and answers, without withdrawn answers or old tags (`packages/chat/src/history.test.ts`; `apps/api/src/create-app.test.ts`, "answers a follow-up with the earlier questions and answers…").
- [x] Every step is metered on its own, and a turn refused at any step records nothing (`apps/api/src/create-app.test.ts`, "refuses a turn when the Allowance no longer covers a later step…").
- [x] The last step has no tools, and no request forces a tool (`create-app.test.ts`, "lets the model search at most five times…"; `packages/ai/src/answer.test.ts`, "offers the tools without forcing one…").
- [x] Neither the stream nor the stored message contains a full tool result (`create-app.test.ts`, "gives the model the passages a search found…").
- [x] Deleting a Source withdraws every answer whose tool results held its passages or extracted wording (`apps/api/src/create-app.test.ts`, "lists earlier messages… withdrawing an answer…" and "withdraws an answer built on the Plan…").
- [x] A Chat proposal is performed only after the student approves the fingerprint shown (`apps/api/src/create-app.test.ts`, "performs a proposal approved in the Chat…", which refuses another fingerprint with 409). A changed proposal needs a new Approval, and repeated clicks perform once (`packages/delegation/src/gate.test.ts`).
- [x] A Model without a tool-capable zero-retention endpoint is not offered (`packages/delegation/src/model-catalog.test.ts`; `packages/ai/src/prices.test.ts`).
- [x] Retrieval eval with model-driven search, including the share of questions about the material answered without a search, is recorded: [phase-14-chat-search-eval.json](operations/phase-14-chat-search-eval.json). The founder sets thresholds; labels are still pending the founder's spot-check.
- [ ] Injection eval: Sources with embedded instructions start no Artifact Run, and any proposal they cause appears only as a card.

**Progress (2026-11-12).** Stage 1 is implemented.
- `createChats` and the ask flow live in `packages/chat`, unchanged apart from the history.
- Each answer is given the last 10 questions and answers, oldest first, without withdrawn turns or Citation tags. It is withdrawn with the Sources of those earlier answers too.
- Retrieval still searches with the question's text alone until stage 2, so a follow-up such as "and at what time?" finds no material and can only refer to the history.

**Progress (2026-11-12).** Stage 2 is implemented.
- The spike passed all three checks against `ai@7.0.157`: one `toUIMessageStream` per step renders as one message in `useChat`, a server-built approval response continues a turn as a new assistant message, and `require_parameters` reaches OpenRouter. It also found that an approved tool part shows twice on the client, once as answered and once with its output; stage 4 handles that.
- `packages/ai` offers one answer step (`Answerer.step`). `packages/chat` runs the loop, at most 6 metered steps with the last one sent `toolChoice: "none"`, and `searchMaterial`, whose tags run on across a turn through `render({ tagFor })`. A Chat with nothing selected is offered no search.
- Answers store their parts (`chat_message.partsContent`), and the API returns them for every message. Older answers get parts from their reasoning and text.
- Searches show as one compact line each (`Durchsucht: „…“`, with what they found), live and after reopening. They are not collapsed after the answer, unlike the reasoning.
- `catalog_model.toolsAvailable` defaults to true, so Models stay offered until the first sync after the migration records the real value. An operator login made before it needs the new column grant (environments runbook).
- `POST /api/me/chats/{id}/messages` is removed.
- The Chat search eval (`apps/worker/evals/chat-search.ts`) asks the Phase 7 questions, each in a fresh Chat, with `sonnet-5.5-reasoning-high`. On 23 answerable and 12 unanswerable questions:
  - no question about the material was answered without a search;
  - a search reached the expected page for all 23, against recall@8 0.74 for the single query in Phase 7, with 2.2 searches per question on average;
  - every answer cited the expected page.

  Of the unanswerable questions, 9 got no Citation. A read of the other 3 shows each also says the material does not answer the question and cites only related passages, so all 12 were declined. The run cost $2.63, about $0.075 per question. This is one run, and ingestion is not deterministic. Figure readings (#66) and the two embedding providers vary, so two runs of the unchanged Phase 7 retrieval eval on 2026-11-12 gave recall@1 0.348 and 0.391, against 0.435 recorded on 2026-11-08. Thresholds should allow for that spread.

**Progress (2026-11-12).** Stage 3 is implemented.
- Each turn's context message gives the date in the student's time zone (`plan.timeZone`) and their Courses (not rejected, merged or Archived) under handles such as `K1`, fenced as data. Tools take handles, so the model never handles IDs and Course titles stay out of tool schemas (ADR-0011).
- `agenda({ from, to })` reads `plan.view` for up to 31 days: Obligations due in the range, with their Tasks, unreviewed or reported-submitted state and a tag from the planning scope's Facts, then Study Blocks and Fixed Events. All of it is fenced as data. The student sees counts only.
- `courseFacts({ course })` reads a Course's Obligations, exam logistics, course rules, AI-use Rule and Topics through the planning scope, which now also serves `exam_logistics` and `ai_use_rule`. The student sees the Course and a count.
- Both tools are offered in every Chat, and a Chat with nothing selected still has no search. The model's instructions bind dates and the Plan to these tools' results.
- The web shows them as steps (`Plan gelesen: 16.11.–22.11.`, `Kursinfos gelesen: Analysis I`).

**Progress (2026-11-12).** Stage 4 is implemented; the ADR-0019 amendment records where it departs from the decision as first written.
- `plan.check` refuses a proposed Study Block that breaks a hard rule and notes broken Preferences.
- The Plan tool names work and blocks `O1`, `T1` and `B1`, and `proposeStudyBlock` and `proposeStudyBlockMove` are checked through `toolApproval` before the student is asked. A valid proposal ends the turn.
- The gate asks each Action right after the answer is saved, under `chatId:messageId:n`, and the API decorates each card with its Action and status.
- The API performs an approved Chat Action wherever it was approved. From the Chat card, the model then reports the outcome in a new answer, which the web reads apart from `useChat` so the card never shows twice.
- Expired Chat Approvals drop out of Approvals and Home, and later turns see each earlier proposal's status.

**Progress (2026-11-13).** Stage 5 is implemented; the ADR-0019 amendment records the details.
- `startPracticeSet` and `startFlashcards` take Topic tags and check them against the Chat's scope. They claim the turn's one Artifact before awaiting, and the Artifact starts after the answer is saved, through `artifacts.request` with a chosen `artifactId` and the API's workflow port.
- A failed turn starts nothing, and a Topic outside the selected Courses goes back to the model with the reason.
- The web shows a step line and a card that opens the Artifact under Study.
- Later turns see where each started Artifact stands.

**Anti-pattern guards.**
- `toolChoice` is only `auto` or `none`.
- An AI SDK approval response never grants authority by itself; only `decide` does.
- Never accept message history from the client.
- No Drafts or Critiques from a Chat.
- Never splice tool results into the system prompt.

---

## Not in this plan

- Stripe paid plans (the pilot is free; Stripe follows once costs are measured).
- Calendar and LMS Connections and verified Destinations (they await the pilot tool inventory).
- Automatic Submission, native apps, per-PR environments, the Bun production runtime, and a second AI provider.
- Shared projects and study groups, and billing-state glossary work.
