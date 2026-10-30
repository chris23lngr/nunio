# Spike results (Phase 2)

Recorded results for the Phase 2 spikes in [implementation-plan.md](../implementation-plan.md). Spikes with an automated check name it here; numbers that can't be a test are written down.

## c. Hono on Vercel `fra1` (2026-10-30)

Run against the interim Hobby staging (`nunio-api`, Fluid compute, `fra1`; see [environments.md](environments.md#interim-vercel-staging-2026-10-30)) with the Neon `staging` branch in `aws-eu-central-1`, pooled URL. Repeat on the Pro team before any pilot user, because Hobby and Pro differ in how instances are kept warm.

The spike routes `/spike/raw-body` and `/spike/pool` live in `apps/api/src/spike.ts` and are mounted only when `SPIKE_ROUTES=true`. They are spike-only: delete them once billing brings the real Stripe webhook (`stripe.webhooks.constructEvent`).

### Raw-body route: passes

`POST /spike/raw-body` verifies an HMAC-SHA256 over the request bytes (`x-spike-signature`, keyed by `SPIKE_WEBHOOK_SECRET`), the way Stripe signs webhooks. The same three cases run in-process (`apps/api/src/create-app.test.ts`) and over HTTP (`apps/e2e/tests/raw-body.spec.ts`, local HTTPS by default, the deployed API with `E2E_TARGET=staging`):

- the exact signed bytes → 200, 50 bytes seen;
- one byte changed (`1999` → `1998`) → 401;
- the same JSON with keys reordered → 401.

All three pass on staging, so Vercel's Node runtime hands Hono the request body unmodified, and `c.req.arrayBuffer()` is safe for signature checks. The handler must never parse and re-serialise before verifying.

### `attachDatabasePool` with `PrismaPg(pool)`: works, no leak

`createPool` in `@nunio/db` builds a `pg.Pool` (`idleTimeoutMillis: 5000`) and calls `attachDatabasePool(pool)`. `createPrismaClient(pool)` passes it to `PrismaPg` with `disposeExternalPool: true`, so `$disconnect()` still ends the pool. Off Vercel, `attachDatabasePool` does nothing (it checks `VERCEL_URL` / `VERCEL_REGION`), so tests and local servers are unaffected.

`GET /spike/pool` returns a per-instance id plus the pool's counts. Measured with `apps/api/scripts/spike-c-measure.sh pool` (signed-in `get-session` calls, which read the session row because `cookieCache` is off):

| After | Instance | total / idle / waiting |
| --- | --- | --- |
| sign-up | `a2c7…` | 1 / 1 / 0 |
| 30 sequential requests | `a2c7…` | 1 / 1 / 0 |
| 20 parallel requests | `f217…` | 1 / 1 / 0 |
| 3 × 20 parallel requests | `be7d…` | 1 / 1 / 0 |
| 7 s idle | `be7d…` | 0 / 0 / 0 |

Each instance reuses one connection across invocations, Fluid spreads parallel load over several instances instead of growing one pool, and after the idle timeout the pool is empty. Nothing leaks across invocations. Trade-off: after more than 5 s of quiet, an instance's next query opens a new connection to the Neon pooler.

### Cold start: no user-visible function cold start observed

Measured with `apps/api/scripts/spike-c-measure.sh health|session` from Germany. "Server" is time to first byte after the TLS handshake (`starttransfer − appconnect`), so it leaves out client DNS and TLS; the totals are 40–250 ms higher.

| Case | First request (server ms) | Following 10 (server ms) |
| --- | --- | --- |
| `/health`, warm | 77 | 43–136, median 78 |
| `/health`, first request to a fresh production deployment | 55 | 48–224, median 99 |
| `get-session`, warm | 40 | 36–88, median 45 |
| `get-session`, fresh deployment, Neon active | 382 | 1797 once, then 160–173; next run 39–95, median 52 |
| `get-session`, fresh deployment, Neon compute suspended | 1125 | 97–336 for about 6 s, then 49 |

- **The function itself:** a fresh production deployment showed no cold start on `/health`. Vercel pre-warms instances for production deployments ([What is Compute?](https://vercel.com/docs/fundamentals/what-is-compute), [How Fluid compute works](https://vercel.com/blog/how-fluid-compute-works-on-vercel)). Variation on warm requests (about 40–220 ms) comes from routing, not from Hono.
- **First database request on a new instance:** about 0.4 s, from opening the first pooled connection and Prisma/Better Auth's first query. One request at 1.8 s points to a second new instance doing the same while traffic moved.
- **Neon waking up:** suspending the staging compute (autosuspend is the default 5 min) adds about 0.7–0.8 s to the first request, and requests stay slow for a few seconds while the 0.25 CU compute warms up. This is the largest cold cost, and it is Neon's, not Vercel's. For production, consider disabling autosuspend on the primary compute.
- **Not measured:** how long an idle Hobby instance lives before Vercel drops it. A 2 × 16 min idle run was started and stopped in favour of fresh-deployment readings. Vercel says cold starts can still happen in periods of low traffic. Re-run the idle case on the Pro team, which keeps at least one instance warm.

### Side finding: Better Auth's rate limit is per instance on Fluid

Better Auth limits sign-up to 3 requests per 10 s per client IP, with in-memory storage by default. On Fluid each instance keeps its own counter, so the effective limit depends on how many instances serve the traffic. The staging browser suite tripped it once all sign-ups landed on one pre-warmed instance, and its `signUp` helper now waits out the window once. Locally the limit never applies, because requests carry no `x-forwarded-for`. Before pilot users arrive (Phase 3), move the limiter to shared storage (`rateLimit.storage: "database"` or secondary storage) so it holds across instances.
