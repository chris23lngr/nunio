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
