# nunio pilot implementation plan

Status: proposed, 2026-10-29. No implementation has begun. Domain terms follow [GLOSSARY.md](../GLOSSARY.md). Decisions follow [ADRs 0001–0011](adr/). Module interfaces follow [delegation-gate.md](design/delegation-gate.md) and [knowledge-retrieval.md](design/knowledge-retrieval.md). Each phase is meant to be executable in a fresh session: read the phase's documentation references before writing code.

## Primary goal

Pilot students can upload their real course materials and, within ten minutes, review an accurate, sourced picture of their Courses and Obligations. They then spend a four-week pilot in which nunio keeps their Plan organized and helps them study. It acts only within permissions they explicitly granted, on infrastructure that keeps student data in the EU, deletes it on request, and survives failures without repeating consequential Actions.

## Decision gates outside the phases

- **Before Phase 2:** choose observability and error tracking (EU-hosted or EU-region). The brief requires background-job monitoring before the pilot, and the walking skeleton should ship with it.
- **Before Phase 10:** choose an email delivery provider (EU processing, DPA). Record it as an ADR.
- **Before Phase 9 (optional):** `prototype` the delegation gate's state machine (Approval expiry, Unconfirmed, Pause mid-Run, Budget exhaustion) as a throwaway.
- **Before connector work (post-pilot):** collect the pilot tool inventory. No Integration or verified Destination is built until then; Submissions are Handoffs during the pilot.

---

## Phase 0: Documentation discovery (complete)

> **How this serves the primary goal:** every later phase copies from verified APIs instead of guessing. Wrong APIs are the fastest way to fragile code, and the brief puts engineering quality before scope.

Consolidated from [foundation.md](research/foundation.md), [durable-ai.md](research/durable-ai.md), [identity-billing-security.md](research/identity-billing-security.md), [runtime-hosting.md](research/runtime-hosting.md), [ai-providers.md](research/ai-providers.md), [pilot-delivery.md](research/pilot-delivery.md), and three discovery passes on 2026-10-29. All versions are npm `latest` on that date. Pin exact versions and commit the lockfile.

### Version baseline

| Package | Version | Note |
|---|---|---|
| `next` | 16.4.3 | middleware is now `proxy.ts` (Node runtime) |
| `hono` | 4.13.14 | `export default app`; `hono/vercel` `handle` is deprecated |
| `@hono/zod-openapi` / `zod` | 1.6.3 / 4.x | requires Zod 4; import `z` from `@hono/zod-openapi` |
| `openapi-typescript` / `openapi-fetch` | 7.13.0 / 0.17.0 | openapi-fetch is 0.x, so pin it exactly |
| `better-auth` | 1.7.14 | |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | **7.10.1** | `latest` is 8.0.0-rc.28: always install `@7.10.1` |
| `@temporalio/*` | 1.24.x or 1.25.0 | 1.25.0 shipped 2026-10-27; pin all `@temporalio/*` to one version |
| `testcontainers`, `@testcontainers/postgresql` | 12.2.1 | image `pgvector/pgvector:0.8.7-pg18`, matching Neon's PG major |
| `turbo` | ≥ 2.10 (2.11.10 latest) | for Bun `bun.lock` pruning |
| `vercel` CLI | 65.8.0 | |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | 3.1160.0 | |
| `@vercel/functions` | 3.10.5 | `awsCredentialsProvider` from `@vercel/functions/oidc` |
| `@ai-sdk/amazon-bedrock` | AI SDK v7 line | use the `/anthropic` subpath |

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
- **AWS:**
  - Bedrock via `@ai-sdk/amazon-bedrock/anthropic` with `region: "eu-central-1"` and `eu.anthropic.claude-*-5-5` IDs only.
  - Retention `PUT /data-retention` `none`; `GetInferenceProfile` destination check.
  - Vercel OIDC: `awsCredentialsProvider({ roleArn, audience })`.
  - Sources: [ai-providers.md](research/ai-providers.md); vercel.com/docs/oidc/aws.
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
- Do not use Bedrock `global.*` or `us.*` profiles, Anthropic direct, Fable or Mythos models, forced `tool_choice`, `jsonTool` structured output, or batch inference for student content (ADR-0011).
- Do not use a cached session for authorization decisions (disable Better Auth's cookie cache), and do not use `advanced.disableCSRFCheck` / `disableOriginCheck`.

---

## Phase 1: Accounts, domains, and secrets (human steps)

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
   4. deploy api via `vercel deploy --prebuilt`;
   5. deploy worker and parser via the Render deploy API, polling until live;
   6. deploy web.

   Vercel `git.deploymentEnabled.main: false`, so PR preview builds stay UI-only (ADR-0005).
4. **Observability** from the gate decision: error tracking in all four apps, plus an alert when the Temporal worker is not polling.
5. **Spikes.** Each one is a test or script kept in the repo:
   - **a. Prisma 7 + Better Auth on Node:** sign-up, sign-in, session, and revocation through `prismaAdapter`. Run on Testcontainers and against the staging Neon branch.
   - **b. Cross-origin session:** `app.` → `api.` with the cookie on `.nunio.app`. Next.js server-side session check by forwarding the cookie to `https://api.nunio.app/api/auth/get-session`. This has no official recipe, so it must be proven here. Cover CSRF and origin rejection from an untrusted origin.
   - **c. Hono on Vercel `fra1`:** cold start, a Stripe-style raw-body route, and `attachDatabasePool` with `PrismaPg(pool)`.
   - **d. Temporal worker on Render:**
     - connects to Temporal Cloud with an API key;
     - a workflow waits on a signal, and survives a worker kill/restart and a redeploy;
     - drains on SIGTERM within `maxShutdownDelaySeconds`;
     - payload codec round trip, and the Temporal UI shows only ciphertext;
     - a replay test runs in CI.
   - **e. Hetzner SSE-C (ADR-0007 gate):**
     - presigned PUT with SSE-C headers and a signed `ContentLength` from a browser on `app.`;
     - CORS allowing PUT and the SSE-C headers;
     - CopyObject from `quarantine` to `sources` with SSE-C;
     - presigned GET with SSE-C via `fetch()`;
     - noncurrent-version expiry configured.

     **If any of these fail, switch to the S3 `eu-central-1` fallback and record it as an ADR amendment.**
   - **f. Bedrock guardrails:**
     - `GetInferenceProfile` for each allowlisted `eu.*` ID fails CI on a non-EU destination;
     - retention `none` is set and read back;
     - a `global.*` call is denied;
     - Vercel OIDC role assumption works from `api`;
     - **Render OIDC** works from `worker`. If it does, update ADR-0011 to drop worker access keys.
   - **g. Parser isolation:** `parser` runs as a Render private service with no secrets and is reachable only from `worker`.

**Documentation references.** Phase 0 Allowed APIs; ADR-0003–0007, 0009, 0011; [foundation.md](research/foundation.md) "Required implementation proof"; [runtime-hosting.md](research/runtime-hosting.md) "Verification to carry into the plan".

**Verification checklist.**
- [ ] A clean clone runs `bun install --frozen-lockfile`, then `turbo run build typecheck test`, all green.
- [ ] Each app builds from its pruned Docker or Vercel artifact alone.
- [ ] A commit on `main` deploys to staging in the documented order; a failing migration stops the pipeline before any app deploys.
- [ ] Spikes a–g each have a passing automated check or a recorded result in `docs/operations/spike-results.md`.
- [ ] Changing `apps/api` routes without regenerating `openapi.json` fails CI.

**Anti-pattern guards.** No feature code in this phase. Do not auto-run migrations on app startup. Do not commit `.env` files. Do not weaken CORS or origin checks to make spike b pass. Use only the allowed APIs from Phase 0.

---

## Phase 3: Identity and tenant isolation

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
5. Pilot entitlement record per student (pilot, expiring, capped Allowance) in `packages/billing`. No Stripe yet.

**Documentation references.**
- Phase 0 Better Auth and Next.js entries;
- [identity-billing-security.md](research/identity-billing-security.md), "Identity" and verification cases 1–3;
- [pilot-delivery.md](research/pilot-delivery.md), "Database isolation";
- PostgreSQL row security docs.

**Verification checklist.**
- [ ] User A cannot read or mutate user B's data by changing IDs: API tests plus an RLS test under the runtime role.
- [ ] A revoked session cannot call authenticated routes.
- [ ] An untrusted origin cannot perform an authenticated mutation.
- [ ] Concurrent requests for two users never leak `app.owner_id` across pooled connections.

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
   - Model registry with only EU-pinned Bedrock IDs (`customProvider`).
   - Default model per task (ADR-0011).
   - Bounded calls (`maxOutputTokens`, `maxRetries` coordinated with Temporal retries, `abortSignal`).
   - Each model carries a data-handling label.
3. Global AI kill switch (a configuration flag checked inside `meter`).

**Documentation references.** [delegation-gate.md](design/delegation-gate.md) "Invariants" (`meter`); [durable-ai.md](research/durable-ai.md) "AI SDK" and invariant 4; ADR-0011 rules for code; Phase 0 Bedrock entry.

**Verification checklist.**
- [ ] N concurrent `meter` calls against one Allowance never exceed it (Testcontainers race test).
- [ ] An uncertain call (timeout after send) keeps its reservation.
- [ ] The kill switch refuses new calls without breaking reads.
- [ ] The registry rejects any model ID outside the allowlist.

**Anti-pattern guards.** No model call outside `meter`. No SDK retries stacked on Temporal retries without explicit limits. No `global.*` IDs.

---

## Phase 5: Sources: upload, quarantine, parsing, and deletion

> **How this serves the primary goal:** uploads alone must be enough to deliver value. They must also be safe to accept and fully deletable.

**What to implement.**

1. `packages/keys`: generate a per-Source SSE-C key, wrap and unwrap it with a versioned master key, plus the Temporal payload codec key (ADR-0007).
2. **Upload flow:**
   1. The API validates the declared size and type, creates the Source record and key, and returns a presigned PUT to `quarantine` with SSE-C and a signed `ContentLength`.
   2. The browser uploads via `fetch()`.
   3. The API is notified and starts an ingestion Run.
3. **Ingestion workflow (worker):**
   - Signature sniffing and size, page, and decompression limits.
   - The parser is called with a presigned GET plus the single file's key, and returns structured text.
   - Scanned pages are detected and routed to Claude image input via `meter` (ADR-0011).
   - On success, CopyObject to `sources` and delete from `quarantine`.
4. Chunking, with chunk text encrypted under the Source key ([knowledge-retrieval.md](design/knowledge-retrieval.md)). Embeddings via the Bedrock embedding model chosen by the German eval (run the eval here; deprecation check first).
5. **Source deletion:** shred the key, delete embedding rows and derived rows in one transaction, and delete objects. Visible immediately everywhere.

**Documentation references.**
- ADR-0007, ADR-0009;
- [identity-billing-security.md](research/identity-billing-security.md), "Files and agent execution" and verification case 4;
- OWASP File Upload Cheat Sheet;
- Phase 0 Hetzner and Temporal entries;
- [ai-providers.md](research/ai-providers.md), "Embeddings".

**Verification checklist.**
- [ ] Oversized, mislabeled, malformed, and zip-bomb uploads never reach `sources` or retrieval.
- [ ] The parser container has no environment secrets (an automated check).
- [ ] After deletion, the object is unreadable with any key, chunks are gone, and retrieval returns nothing.
- [ ] The German/English embedding eval result is recorded and the chosen model ID and dimensions are stored per vector row.

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
3. A **review screen** in `web`: grouped by Course, each item showing its source passage, with confirm, correct, or dismiss actions. Progress and timing from upload to the first reviewable result is instrumented.
4. Projects (optional workspaces) and manual Obligation entry.

**Documentation references.** GLOSSARY ("Knowledge", "Study work", "Organization"); [knowledge-retrieval.md](design/knowledge-retrieval.md) "Correction merge"; brief "Complete study workflow" steps 1–3; ADR-0011.

**Verification checklist.**
- [ ] An extraction eval set of representative German and English syllabi, including scans, has its precision and recall for Obligations and deadlines recorded. Pilot thresholds are set by the founder.
- [ ] A Correction survives re-uploading a conflicting Source, and the conflict is flagged.
- [ ] Median time from upload to a reviewable result is measured on the eval set (target ≤ 10 minutes).
- [ ] A syllabus containing injection instructions produces no Actions and no scope change.

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
3. A Chat can start a Run. Proposing Actions from Chat waits for Phase 9.

**Documentation references.** [knowledge-retrieval.md](design/knowledge-retrieval.md) (entire); [durable-ai.md](research/durable-ai.md) "Postgres and pgvector" and invariant 5; OWASP Prompt Injection Cheat Sheet.

**Verification checklist.**
- [ ] The design doc's "Testing" scenarios all pass through the interface.
- [ ] A deleted Source shows as "gone" in older Chat messages.
- [ ] A foreign or deselected Course never reaches a model request (assert on the captured prompt).
- [ ] Measured German retrieval recall@k is recorded.

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
4. Home: attention needed (Shortfalls, flagged disagreements), ready Artifacts, ongoing work.

**Documentation references.** GLOSSARY ("Planning", "Limits"); brief "User experience and information model"; [knowledge-retrieval.md](design/knowledge-retrieval.md) planning scope.

**Verification checklist.**
- [ ] Table-driven tests cover the following:
  - `rebalance` never schedules into Protected Time or over Fixed Events;
  - it never moves a Locked Study Block;
  - it marks moves of student-placed blocks as needing Approval;
  - it reports a Shortfall instead of overfilling.
- [ ] Overload scenarios surface a Shortfall with tradeoffs on Home.

**Anti-pattern guards.** No I/O in `rebalance`. Never silently drop an Obligation or remove Protected Time.

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
- [ ] All gate-suite and contract-suite scenarios in the design doc pass.
- [ ] Killing the worker while a Run awaits Approval loses neither the Approval nor the continuation.
- [ ] A Pause between two Actions stops the second.
- [ ] Repeated Approval clicks dispatch once.
- [ ] A stale Artifact version is refused.
- [ ] Replaying recorded workflow histories against the current code succeeds in CI.

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

**Documentation references.** GLOSSARY ("Outreach"); [pilot-delivery.md](research/pilot-delivery.md), "Browser push"; brief "Proactivity and configuration".

**Verification checklist.**
- [ ] Duplicate triggers produce one Intervention.
- [ ] Denied push permission leaves the product fully usable.
- [ ] A push delivery never marks anything complete.
- [ ] Dismissal and acknowledgement are recorded separately.

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

**Documentation references.** GLOSSARY ("Understanding", "Handing in"); ADR-0002; [pilot-delivery.md](research/pilot-delivery.md), "Flashcard export"; brief "Completion, submission, and integrations".

**Verification checklist.**
- [ ] An Artifact never changes an Understanding Level.
- [ ] Disagreement between Self-assessment and Attempts shows as disputed.
- [ ] The Anki TSV round-trips German characters, delimiters, and multiline answers in the supported Anki version.
- [ ] Unknown AI-use rules cause nunio to ask instead of drafting.

**Anti-pattern guards.** No mastery percentages. No automatic Submission. No Destination is treated as verified.

---

## Phase 12: Pilot readiness gates

> **How this serves the primary goal:** the brief makes these controls preconditions for putting real students' data and studies in nunio's hands.

**What to implement and complete.**

1. **DPA review (ADR-0008):** Vercel, Neon, Temporal, Render, Hetzner, and AWS Bedrock with its four specific checks, plus the email and observability providers.
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
   - `global.anthropic`, `us.anthropic`, `tool_choice`, `jsonTool`;
   - `disableCSRFCheck`, `disableOriginCheck`, `FROM node:.*alpine`.
3. **Full test run.** Unit, contract, Testcontainers integration, workflow replay, and end-to-end on staging: upload a syllabus, review it, then a Responsibility Run proposes a Study Block, the student approves it, and the Action is done.
4. **First-use timing.** Re-measure the ten-minute result on staging with eval materials.

---

## Not in this plan

- Stripe paid plans (the pilot is free; Stripe follows once costs are measured).
- Calendar and LMS Connections and verified Destinations (they await the pilot tool inventory).
- Automatic Submission, native apps, per-PR environments, the Bun production runtime, and a second AI provider.
- Shared projects and study groups, and billing-state glossary work.
