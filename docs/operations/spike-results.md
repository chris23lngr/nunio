# Spike results (Phase 2)

Recorded results for the Phase 2 spikes in [implementation-plan.md](../implementation-plan.md). Spikes with an automated check name it here; numbers that can't be a test are written down.

## c. Hono on Vercel `fra1` (2026-10-30)

Run against the interim Hobby staging (`nunio-api`, Fluid compute, `fra1`; see [environments.md](environments.md#interim-vercel-staging-2026-10-30)) with the Neon `staging` branch in `aws-eu-central-1`, pooled URL. Repeat on the Pro team before any pilot user, because Hobby and Pro differ in how instances are kept warm.

The spike code lives in `apps/api/src/spike.ts` and is mounted only when `SPIKE_ROUTES=true`: the `/spike/raw-body` route, and a middleware that tags every response with `x-spike-instance`, `x-spike-pool-before` and `x-spike-pool`. It is spike-only: delete it once billing brings the real Stripe webhook (`stripe.webhooks.constructEvent`).

### Raw-body route: passes

`POST /spike/raw-body` verifies an HMAC-SHA256 over the request bytes (`x-spike-signature`, keyed by `SPIKE_WEBHOOK_SECRET`), the way Stripe signs webhooks. The same three cases run in-process (`apps/api/src/create-app.test.ts`) and over HTTP (`apps/e2e/tests/raw-body.spec.ts`, local HTTPS by default, the deployed API with `E2E_TARGET=staging`):

- the exact signed bytes → 200, 50 bytes seen;
- one byte changed (`1999` → `1998`) → 401;
- the same JSON with keys reordered → 401.

All three pass on staging, so Vercel's Node runtime hands Hono the request body unmodified, and `c.req.arrayBuffer()` is safe for signature checks. The handler must never parse and re-serialise before verifying.

### `attachDatabasePool` with `PrismaPg(pool)`: works, no leak

`createPool` in `@nunio/db` builds a `pg.Pool` (`idleTimeoutMillis: 5000`). `createPrismaClient(pool)` passes it to `PrismaPg` with `disposeExternalPool: true`, so `$disconnect()` still ends the pool. The API's `appFromEnv` calls `attachDatabasePool(pool)`, keeping `@nunio/db` free of Vercel code for the Render worker. Off Vercel, `attachDatabasePool` does nothing (it checks `VERCEL_URL` / `VERCEL_REGION`).

Every response reports the instance that served it plus its pool counts before and after the handler, so the evidence comes from the requests that did the work. Measured with `apps/api/scripts/spike-c-measure.sh pool`, using signed-in `get-session` calls; these read the session row because `cookieCache` is off:

| Round | Instances | Max pool total on any instance | Pool before each instance's first request |
| --- | --- | --- | --- |
| 30 sequential | 1 | 1 | 1 (open from sign-up) |
| 20 parallel | 18 (17 new) | 1 | 0 on the 17 new instances: they had just started |
| 3 × 20 parallel | the same 18 | 1 | 1 on all 18: their connection was reused |
| 10 sequential after 7 s idle | 1 | 1 | 0: the pool had drained |

Each instance holds at most one connection and reuses it across invocations. Fluid on Hobby answers a burst by starting instances rather than running many requests in one. After the idle timeout the pool is empty, so nothing leaks across invocations. Trade-off: after more than 5 s without queries, an instance's next request opens a new connection to the Neon pooler. Neon-side counts (`pg_stat_activity`) can't show client connections behind PgBouncer, which is why the evidence comes from the pool itself.

### Cold start: the database is the cold cost, not the function

Measured with `apps/api/scripts/spike-c-measure.sh health|session` from Germany. The "fresh deployment" rows come from running `vercel deploy --prebuilt --prod` on the same build output, then the script, with no other request in between. For the last row, the staging compute was suspended first (Neon API `suspend_postgres_endpoint`), and the deploy started once it reported `idle`. "Server" is time to first byte after the TLS handshake (`starttransfer − appconnect`), so it leaves out client DNS and TLS; the totals are 40–250 ms higher.

| Case | First request (server ms) | Following 10 (server ms) |
| --- | --- | --- |
| `/health`, warm | 77 | 43–136, median 78 |
| `/health`, first request to a fresh production deployment | 55 | 48–224, median 99 |
| `get-session`, warm | 40 | 36–88, median 45 |
| `get-session`, fresh deployment, Neon active | 382 | 1797 once, then 160–173; next run 39–95, median 52 |
| `get-session`, fresh deployment, Neon compute suspended | 1125 | 97–336 for about 6 s, then 49 |

- **The function itself:** no user-visible cold start on `/health`, even right after a fresh production deployment. Vercel pre-warms instances for production deployments ([What is Compute?](https://vercel.com/docs/fundamentals/what-is-compute), [How Fluid compute works](https://vercel.com/blog/how-fluid-compute-works-on-vercel)). Variation on warm requests (about 40–220 ms) comes from routing, not from Hono.
- **First database request on a new instance:** about 0.4 s, from opening the first pooled connection and Prisma/Better Auth's first query. One request at 1.8 s points to a second new instance doing the same while traffic moved. The pool run supports this: a burst starts new instances, and each one's first request opens its connection.
- **Neon waking up:** suspending the staging compute (autosuspend is the default 5 min) adds about 0.7–0.8 s to the first request, and requests stay slow for a few seconds while the 0.25 CU compute warms up. This is the largest cold cost, and it is Neon's, not Vercel's. For production, consider disabling autosuspend on the primary compute.
- **Not measured:** how long an idle Hobby instance lives before Vercel drops it. A 2 × 16 min idle run was started and stopped in favour of fresh-deployment readings. Vercel says cold starts can still happen in periods of low traffic. Re-run the idle case on the Pro team, which keeps at least one instance warm.

### Side finding: Better Auth's rate limit is per instance on Fluid

Better Auth limits sign-up to 3 requests per 10 s per client IP, with in-memory storage by default. On Fluid each instance keeps its own counter, so the effective limit depends on how many instances serve the traffic. The staging browser suite tripped it once all sign-ups landed on one pre-warmed instance, and its `signUp` helper now waits out the window once. Locally the limit never applies, because requests carry no `x-forwarded-for`. Before pilot users arrive (Phase 3), move the limiter to shared storage (`rateLimit.storage: "database"` or secondary storage) so it holds across instances.

## e. Hetzner SSE-C (2026-10-30)

Run against `nunio-staging-quarantine` and `nunio-staging-sources` in `fsn1`, created and configured by `packages/knowledge/spike-e/provision.ts` (idempotent; see [environments.md](environments.md)). Checks: `packages/knowledge/spike-e/storage.test.ts` (Vitest, S3 semantics) and `apps/e2e/tests/sse-c-browser.spec.ts` (Playwright, browser and CORS). Both skip without the Hetzner variables, and both run in the `main` pipeline.

| ADR-0007 gate check | Result |
| --- | --- |
| Presigned PUT with SSE-C headers and a signed `Content-Length` | Passes. A longer body (403), a missing SSE-C header (403) and a wrong key on download are rejected; a GET without the key fails (400), so objects really are encrypted. |
| CORS allowing PUT and the SSE-C headers from `app.` | Passes from `https://app.staging.nunio.app` and the local `https://app.nunio.test:8443`; a page on an untrusted origin is blocked. |
| Presigned GET with SSE-C via `fetch()` | Passes from the browser on `sources`. |
| CopyObject from `quarantine` to `sources` with SSE-C | **Fails: Hetzner (Ceph) answers 501 `NotImplemented`** for any CopyObject whose source is SSE-C, inside a bucket or across, with the AWS SDK and the AWS CLI alike. A multipart copy (`CreateMultipartUpload`, `UploadPartCopy`, `CompleteMultipartUpload`) works with SSE-C on both sides: server-side, versioned in `sources`, byte-identical, unreadable without the key. |
| Noncurrent-version expiry | Passes: `sources` is versioned with noncurrent versions expiring after 30 days; `quarantine` objects expire after 7 days (both read back). |

Decision (2026-10-30): stay on Hetzner and promote with a multipart copy; ADR-0007 is amended. The copy uses parts of up to 5 GiB; the multi-part branch (files over 5 GiB) is untested. A test pins the 501, so it starts failing if Hetzner implements CopyObject with SSE-C.

Notes for the upload flow: presign with the SSE-C headers as `unhoistableHeaders` (the key never goes in the URL) and `content-length` as a signed header. `quarantine` allows only browser PUTs and `sources` only GETs. Hetzner answers `CreateBucket` with `BucketAlreadyExists` even for a bucket you own, so check with `HeadBucket` first.

## f. OpenRouter (2026-10-30)

Run with international routing: on 2026-10-30 the EU-routing check was deferred, and ADR-0012 and ADR-0008 are amended. Checks: `packages/ai/spike-f/providers.test.ts` (Vitest, `@openrouter/ai-sdk-provider` 3.1.0 with AI SDK 7). The tests skip without `OPENROUTER_API_KEY` and run in the `main` pipeline. Every request sets `provider: { zdr: true, data_collection: "deny" }`.

| Check | Result |
| --- | --- |
| EU endpoint accepted, global endpoint rejected | **Deferred**, together with EU routing. |
| Claude through a zero-retention endpoint | Passes (`anthropic/claude-haiku-5.5`). |
| Structured output without forcing a tool | Passes: `Output.object` sends `response_format: json_schema`, with no `tools` or `tool_choice` in the request body. |
| Prompt caching passes through | Passes: with `cacheControl` on the `instructions` system message, the second call reports cache-read tokens. |
| Zero-retention embeddings exist (Phase 5 stop condition) | Passes: many exist, including multilingual models; `baai/bge-m3` embeds German text (1024 dimensions). The German retrieval eval still picks the model in Phase 5. |

Claude and embedding models with zero-retention endpoints, from `packages/ai/spike-f/list-models.ts`. Re-run it before relying on a model; Covered Models (Fable, Mythos) are filtered out.

| Model | Kind | ZDR providers | `structured_outputs` |
| --- | --- | --- | --- |
| `amazon/titan-embed-image-v1` | embedding | Amazon Bedrock | – |
| `amazon/titan-embed-text-v1` | embedding | Amazon Bedrock | – |
| `amazon/titan-embed-text-v2` | embedding | Amazon Bedrock | – |
| `anthropic/claude-haiku-4.5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-haiku-5.5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-4.1` | chat | Amazon Bedrock | no |
| `anthropic/claude-opus-4.5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-4.6` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-4.7` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-4.8` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-opus-5.5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-sonnet-4.5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-sonnet-4.6` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-sonnet-5` | chat | Amazon Bedrock, Google | yes |
| `anthropic/claude-sonnet-5.5` | chat | Amazon Bedrock, Google | yes |
| `baai/bge-base-en-v1.5` | embedding | DeepInfra | – |
| `baai/bge-large-en-v1.5` | embedding | DeepInfra | – |
| `baai/bge-m3` | embedding | DeepInfra, Parasail | – |
| `google/gemini-embedding-001` | embedding | Google | – |
| `google/gemini-embedding-2` | embedding | Google | – |
| `intfloat/e5-base-v2` | embedding | DeepInfra | – |
| `intfloat/e5-large-v2` | embedding | DeepInfra | – |
| `intfloat/multilingual-e5-large` | embedding | DeepInfra | – |
| `mistralai/codestral-embed-2505` | embedding | Mistral | – |
| `mistralai/mistral-embed-2312` | embedding | Mistral | – |
| `openai/text-embedding-3-large` | embedding | Azure | – |
| `openai/text-embedding-3-small` | embedding | Azure | – |
| `perplexity/pplx-embed-v1-0.6b` | embedding | Perplexity | – |
| `perplexity/pplx-embed-v1-4b` | embedding | Perplexity | – |
| `qwen/qwen3-embedding-4b` | embedding | DeepInfra | – |
| `qwen/qwen3-embedding-8b` | embedding | DeepInfra, Nebius, SiliconFlow | – |
| `sentence-transformers/all-minilm-l12-v2` | embedding | DeepInfra | – |
| `sentence-transformers/all-minilm-l6-v2` | embedding | DeepInfra | – |
| `sentence-transformers/all-mpnet-base-v2` | embedding | DeepInfra | – |
| `sentence-transformers/multi-qa-mpnet-base-dot-v1` | embedding | DeepInfra | – |
| `sentence-transformers/paraphrase-minilm-l6-v2` | embedding | DeepInfra | – |
| `thenlper/gte-base` | embedding | DeepInfra | – |
| `thenlper/gte-large` | embedding | DeepInfra | – |

Notes:
- AI SDK 7 rejects system messages in `messages`. Pass them as `instructions`, which also carries `providerOptions` for caching.
- The provider leaves `request.body` empty, so the test inspects request bodies through the `fetch` option.
- The account had never bought credits, so paid models failed with "Insufficient credits" until the organization was funded.

## d. Temporal worker on Render (2026-10-30)

Run with `apps/worker` (Temporal TypeScript SDK 1.25.0) on Render service `nunio-worker-staging` (`srv-dbi862on74is73b128pg`: background worker, Frankfurt, Starter, Docker from `apps/worker/Dockerfile`, `maxShutdownDelaySeconds: 30`, see `render.yaml`) against namespace `nunio-staging.lta09`. Automated checks run in the CI `checks` job on Temporal's local dev server. Staging checks use `apps/worker/scripts/staging.ts`.

| Check | Result |
| --- | --- |
| Connects to Temporal Cloud with an API key | Passes: `NativeConnection.connect({ address, tls: true, apiKey })`, from the container locally and on Render. The namespace has 7-day retention. |
| Workflow waits on a signal | Passes: `awaitApproval` waits on `condition()` until the Approval signal arrives (`src/workflows.test.ts`). |
| Survives a worker kill/restart and a redeploy | Passes: one run waited through a Render restart and two redeploys, then completed with the signalled decision. A run stranded by stopping the local container was completed by the Render worker. |
| Drains on SIGTERM within `maxShutdownDelaySeconds` | Passes: on Render, SIGTERM arrived with three Activities in flight; all finished on attempt 1 and the worker stopped 13.8 s later (grace 25 s, Render limit 30 s). Also covered by `src/shutdown.test.ts` on the real entrypoint and by `docker stop` locally (15 s Activity, exit 0 after 16 s). |
| Payload codec round trip; only ciphertext in Temporal | Passes: AES-256-GCM codec (`src/codec.ts`) on Client and Worker, with the key version in each payload's metadata. Raw histories on the dev server (`src/workflows.test.ts`) and in Temporal Cloud (`staging.ts ciphertext`) hold only `binary/encrypted (v1)` payloads. Without a codec server, the Cloud UI shows these payloads as ciphertext. |
| Replay test in CI | Passes: `src/replay.test.ts` replays `histories/await-approval.json` (recorded with `scripts/record-history.ts`); an unpatched timer added before the wait fails with `TMPRL1100 Nondeterminism error`. |

Findings:
- **Render overlaps old and new instances for about 3 minutes.** It reports a deploy live before the new worker has bundled its workflows, and SIGTERMs the old instance minutes later. Both poll the task queue meanwhile, which Temporal handles. Activities in flight during a cutover therefore usually finish undisturbed, and drain only matters for the final seconds of the old instance.
- The Temporal native bridge loads fine on `node:24-bookworm-slim`. `@temporalio/proto` is CommonJS, so plain Node needs its default import (Vitest hides this).
- Deploys go through `.github/scripts/render-deploy.sh` (pinned commit, polls until live; about 35–60 s).

Follow-ups:
- Done: the image went from 756 to 447 MB. That came from a production-only install filtered to the worker, a runtime stage without Bun, and only the Linux binaries of Temporal's core bridge. What remains is mostly the Node base image, the bridge, and `@temporalio/worker`'s declared webpack and swc dependencies.
- Done: workflows are bundled at build time (`scripts/bundle-workflows.ts`, `workflowBundle`), so the worker logs `worker running` 1.4 s after the container starts, without webpack.
- Open: switch the Render service's branch to `main` when PR #1 merges.

## g. Parser isolation (2026-10-30)

Run with Render private service `nunio-parser-staging` (`srv-dbi8lt67bikc73af3tr0`: Frankfurt, Starter, from `render.yaml`) and the worker from spike d. Automated checks: `apps/parser/src/index.test.ts` and the `checkParser` test in `apps/worker/src/workflows.test.ts`. Staging check: `apps/worker/scripts/staging.ts parser`.

| Check | Result |
| --- | --- |
| Runs as a Render private service | Passes: type `private_service`, with only the private address `nunio-parser-staging:10000`. |
| Holds no secrets | Passes: its Render environment is `PORT` alone. The entrypoint also refuses to start when any variable looks secret (`…SECRET…`, `…_KEY`, `DATABASE_URL`, tokens, passwords); it logs the names, never the values, and exits 1 (test, and `docker run -e DATABASE_URL=…`). |
| Reachable from the worker | Passes: a `checkParser` workflow on the Render worker got `{"status":"ok"}` from the parser over the private network on the first attempt (about 100 ms). The worker gets the address from Render's `fromService … hostport`. |
| Not reachable from the internet | Passes: the private hostname doesn't resolve publicly. `nunio-parser-staging.onrender.com` resolves only through Render's wildcard DNS, and Render's router answers `404 Not Found` (the parser would answer `{"status":"ok"}`). |
| Reachable *only* from the worker | **Partly:** [Render's private network](https://render.com/docs/private-network) spans every service in the same workspace and region. Today the worker is the only other Render service in Frankfurt, so in practice only the worker reaches the parser. Nothing enforces that, though. |

Options to enforce "only the worker" (not decided):
- [Environment isolation](https://render.com/docs/projects) (Pro workspace, `networking.isolation: enabled`) keeps other environments out, but services inside the same environment still reach each other.
- Requests signed by the worker and verified by the parser with a **public** key (for example Ed25519). The parser would still hold no secrets, and Render [recommends application-level authorization](https://render.com/articles/how-render-handles-private-networking) for service-to-service trust.

The parser can still make outbound requests. It needs them to fetch the presigned URL from Hetzner, so limiting egress beyond that is part of the parsing work (ADR-0009's limits on size, pages, decompression and time).
