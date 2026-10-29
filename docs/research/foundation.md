# Technical foundation discovery

> **Superseded (2026-10-29)** as a stack proposal by [ADR-0003](../adr/0003-stack-and-runtimes.md) and the ADRs that follow it. The pnpm/Fastify/Drizzle baseline below was not adopted. These parts still apply: the Turborepo task and environment rules, the migration discipline (one controlled job, expand/contract, separate runtime and migration roles), the version-selection procedure, and the required implementation proofs.

Research date: 2026-10-29. Facts below come from official documentation inspected on this date; technology selections remain proposals. No implementation, benchmarks, deployment, or compatibility spike was performed.

## Inputs and proposed direction

Read `docs/product-brief.md` and the complete local Turborepo skill at `/Users/christoph.langer/.agents/skills/turborepo/SKILL.md`. The brief requires independent web/API/worker apps in a monorepo; it does not select the following technologies.

Proposed baseline: TypeScript, pnpm workspaces, Turborepo, a Next.js web app, a Fastify Node API, a separate Node worker app, and PostgreSQL. Drizzle with `node-postgres` is a candidate data layer, subject to stable-version and Better Auth adapter compatibility verification. These choices fit the requested app boundaries; they are not uniquely necessary.

Alternatives to evaluate only if requirements justify them: Vite/React for a client-rendered web app if server rendering adds no value; Hono for a Fetch-native API adapter; direct SQL with a typed query layer if Drizzle's stable release cannot satisfy the required compatibility. These are design alternatives, not a benchmark ranking.

## Allowed APIs and copy locations

| Area | Verified names and behavior | Official copy location / sections |
| --- | --- | --- |
| Workspaces | Root `pnpm-workspace.yaml`; `packages` entries; internal dependency `workspace:*` resolves locally rather than falling back to a registry package. | [pnpm Workspace](https://pnpm.io/workspaces): “Declaring a workspace” and “Workspace protocol”; [Turborepo structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository): “Declaring directories for packages,” with `apps/*` and `packages/*`. |
| Reproducible install | `pnpm install --frozen-lockfile` rejects a needed lockfile change. | [pnpm install](https://pnpm.io/cli/install): `--frozen-lockfile`. |
| Task graph | `tasks`, `dependsOn: ["^build"]`, `outputs`, `inputs`, `$TURBO_DEFAULT$`, `cache: false`; upstream package dependencies must be declared. A transit task can preserve dependency-source invalidation for parallel type checking. | [Turborepo tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks): “Running tasks in the right order,” “Specifying outputs,” “Specifying inputs,” “Performing side-effects,” and “Dependent tasks that can be run in parallel.” |
| Build environment | `env`/`globalEnv` enter hashes; `passThroughEnv`/`globalPassThroughEnv` permit variables without hashing. Strict environment mode is default. | [Turborepo environment](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables): “Adding environment variables to task hashes,” “Environment Modes,” “Handling .env files.” |
| Independent build context | `turbo prune <package> --docker` produces pruned manifests, lockfile, and source; it is not a finished runtime image. | [Turborepo prune](https://turborepo.dev/docs/reference/prune): “Example,” `--docker`, “Task dependencies,” “Including globalDependencies.” |
| Web deployment | `output: 'standalone'`, `outputFileTracingRoot`, `outputFileTracingIncludes`, `outputFileTracingExcludes`. Standalone output does not automatically include `public` and `.next/static`. | [Next.js output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output): “Automatically Copying Traced Files” and “Caveats,” including monorepo tracing-root example. |
| API contract | Route `schema` validates input and specifies response serialization; `addSchema` registers reusable schemas; asynchronous authorization/data checks belong after basic validation, e.g. `preHandler`. | [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/): “Core concepts,” “Validation,” “Serialization,” and initial warnings. |
| API lifecycle/testing | `Fastify(...)`, `register`, `route`, `listen`, `close`, `inject`; `bodyLimit`, `requestTimeout`, `trustProxy` are server options. | [Fastify factory](https://fastify.dev/docs/latest/Reference/Server/): named option/method sections; [Fastify testing](https://fastify.dev/docs/latest/Guides/Testing/): “Benefits of using fastify.inject.” |
| Better Auth bridge | `fromNodeHeaders` from `better-auth/node`; `auth.handler(req)` for a Fetch `Request`; `auth.api.getSession({ headers })`; `trustedOrigins`; credentialed CORS restricted to configured origins. | [Better Auth Fastify](https://better-auth.com/docs/integrations/fastify): “Authentication Handler Setup,” “Trusted origins,” “Configuring CORS,” “Getting the User Session.” |
| Database connection | `Pool` from `pg`; `drizzle` from `drizzle-orm/node-postgres`; documented construction `drizzle({ client: pool })`. | [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql): “node-postgres,” “Step 2,” existing-driver example. **Current page installs RC packages: verify this signature against the selected stable release before copying.** |
| Reviewed migrations | `drizzle-kit generate` produces SQL; `drizzle-kit migrate` applies migrations. | [Drizzle migrations](https://orm.drizzle.team/docs/migrations): “Option 3,” code-first generated SQL workflow. |
| Transactions | `db.transaction(async (tx) => { ... })`, `tx.rollback()`, nested `tx.transaction`, PostgreSQL transaction configuration `isolationLevel`, `accessMode`, `deferrable`. | [Drizzle transactions](https://orm.drizzle.team/docs/transactions): transaction, rollback, and dialect-specific configuration examples. |
| Row isolation | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, and `FORCE ROW LEVEL SECURITY`; superuser/`BYPASSRLS` and ordinary table-owner bypass require special care. | [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): opening behavior and examples. |

## Design implications and anti-pattern guards

These are recommendations inferred from the verified mechanisms above:

- Create `apps/web`, `apps/api`, and `apps/worker` immediately. Keep shared contracts/domain/database/auth packages independently importable; do not share application internals via relative imports. Do not give the browser access to server-only packages or secrets.
- Put executable task scripts in their packages and let root scripts delegate through `turbo run`. Cache only deterministic tasks. Migrations, deployment, and destructive maintenance must not be cached. Include app-specific environment inputs in the right cache keys; avoid a root `.env` exposing all secrets to every app.
- Prove each application builds and boots from an isolated artifact. The Next monorepo tracing root alone does not prove every runtime asset is included. Ensure pruned builds include required shared configuration deliberately; avoid opting into future flags merely to conceal missing packaging inputs.
- `turbo boundaries` is explicitly [Experimental](https://turborepo.dev/docs/reference/boundaries). Do not make it the sole enforcement of architecture/security boundaries. Package exports, dependency declarations, lint rules, and browser-bundle checks must provide the required protections. Local skill examples use a canary schema and future flags: do not copy them uncritically into a stable baseline.
- Treat Fastify schemas as trusted application code, never as user/agent-generated input: the documentation warns that schema compilation executes generated functions. Use response schemas to limit accidental output exposure, but enforce authorization independently.
- Better Auth's Fastify page is an integration starting point, not a complete production security configuration. Test the bridge for all `Set-Cookie` headers, OAuth redirects, secure cookies, correct external HTTPS URLs, proxy trust, CSRF/origin handling, and raw-body-sensitive webhook routes. Do not trust an arbitrary incoming Host header to define the canonical authentication origin.
- Use a constrained runtime database role, separate from migration ownership. If row-level security is adopted, verify its policies with the actual runtime role and connection pool under concurrent users; never assume enabling it protects owner/superuser queries. Application authorization remains mandatory.
- Run reviewed SQL migrations as one controlled deployment job, not concurrently at every API/worker startup. Test compatibility while old and new app revisions overlap; plan expand/contract schema changes rather than assuming rollback can reverse data loss.
- Separate a worker process from the API lifecycle. Queue/workflow semantics need their own evidence; none of these framework docs alone establishes durable execution or exactly-once external actions.

## Version selection procedure

Do not infer supported versions from tutorial minimums or install a moving `latest`/`rc`/`canary` tag into the committed project. At implementation start, inspect official releases, package engine/peer requirements, and the chosen hosting runtime; select compatible stable releases; record exact resolutions and lockfile; run the integration spike and security checks before adopting them. Set a supported Node release in local tooling, CI, and runtime images.

The [Node release policy](https://nodejs.org/en/about/previous-releases) recommends supported LTS releases for production. The [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/) must be checked against the chosen Node release and Fastify major; its version table and the Better Auth guide's older minimum Node statement are not sufficient compatibility proof. Keep dependency updates reviewed and tested rather than freezing security fixes indefinitely.

## Required implementation proof

1. Clean, frozen install; each app builds/boots independently; shared-package edits invalidate affected build/typecheck caches; changed build environment does not reuse an incompatible artifact.
2. API contract tests exercise validation, output serialization, unauthorized requests, and restricted tenant data using `inject`; browser tests verify the real cookie/proxy/auth flow.
3. Actual PostgreSQL integration tests cover transaction rollback, migration from the preceding revision, and concurrent tenant isolation with runtime credentials.
4. SIGTERM/shutdown checks drain API work and close pools; worker interruption/restart is verified against the subsequently selected durable execution system.

## Confidence and gaps

High confidence in the listed documented mechanisms and the explicit experimental/RC cautions. Medium confidence in the proposed combination until a pinned compatibility spike proves it. Unknown: provider/runtime regions and terms, hosting and database costs, selected stable package versions, exact API contract tooling, worker engine, telemetry backend, production load targets, and pilot connector requirements. No performance or enterprise-readiness claim has been validated by this research.
