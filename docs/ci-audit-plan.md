# CI audit and remediation plan

## Primary goal

Contributors receive fast, independent, trustworthy checks on each pull request, without repeated timeout fixes or skipped coverage masquerading as success. A validated main commit can then roll out to staging safely without blocking validation of subsequent commits.

Audit date: 2026-10-30 UTC. Base: `63946c8e3e82d549e902a3aa2cde8c9cb87280f9` (`origin/main`). Original working branch: `chore/ci-audit-plan`. The audit and proposed phases below describe that historical snapshot; the implementation record at the end tracks subsequent changes.

## Findings and evidence

### 1. Serial orchestration outside, excessive competition inside

`.github/workflows/ci.yml:20-38` puts almost all validation in one `checks` job: installation → Chromium installation → workspace build/typecheck/lint/test → UI checks → OpenAPI drift → local E2E. Independent checks wait behind earlier steps, and an early failure prevents later checks from reporting. Only commit lint runs independently on PRs. This is a topology decision, not GitHub refusing to parallelize jobs.

Inside the workspace step, `bun run build typecheck lint test` expands to **one multi-task Turbo invocation**, not four sequential commands. The logs explicitly show all four requested tasks. Turbo schedules ready tasks concurrently; each Vitest process can create its own workers, database containers, and subprocesses. Next builds and Temporal webpack/native test processes compete with them. Increasing inner parallelism would worsen this arrangement.

Commit `5f33db3` explicitly records Chromium starvation and fixes it by excluding UI from the first invocation and running UI checks later. That avoids one overlap but leaves the rest of the heavy tasks competing. This serial exclusion is a workaround for missing workload isolation. A negative package filter still permits `@nunio/ui#build` as an upstream dependency of web; the actual dry run confirms it. The filter isolates the UI browser test, not every UI task.

Recent failure evidence:

| Run | Observed failure | Interpretation |
| --- | --- | --- |
| [41132004895](https://github.com/chris23lngr/nunio/actions/runs/41132004895) | Storybook Chromium suite `dropdown-menu.stories.tsx` failed during the combined workspace step | Historical motivation for the serial UI workaround; commit `5f33db3` documents the resource hypothesis |
| [41137158700](https://github.com/chris23lngr/nunio/actions/runs/41137158700) | `apps/worker/src/replay.test.ts:8`, timeout at 30,000 ms | Existing longer timeout did not prevent failure |
| [41137845348](https://github.com/chris23lngr/nunio/actions/runs/41137845348) | `packages/identity/src/auth.test.ts:114`, password-reset test timeout at 15,000 ms | Failure moved to another expensive suite on the next revision |

These logs prove timeouts and changing failure locations. CPU/memory contention is strongly supported by the topology and history, but **not proven by resource telemetry**, which is absent. Do not conclude there is no application defect until the exact suites are reproduced on isolated runners. The `temporary pilot activation failure` error in API logs is deliberately injected by a recovery test; it is not the failing assertion in the identity run.

### 2. Repeated setup and full execution have no cross-run cache

`.github/actions/setup/action.yml` provisions Node and Bun and installs the complete workspace in every job. There is no Bun dependency-download cache, persisted `.turbo` cache, or configured Turbo Remote Cache. Failing runs report `Remote caching disabled` and zero cached tasks. Local Turbo cache can help subsequent steps on the same runner, but disappears between fresh jobs/runs. `actions/setup-node` does not configure a Bun dependency cache here.

Every PR, including documentation-only changes, requests the whole task graph. There is no affected-package selection. Splitting jobs without fixing this would multiply cold installs and duplicate upstream builds. Caching is an optimization only after the cache contracts below are correct.

### 3. Generated artifacts have incorrect ownership and cache contracts

`turbo.json:5-8` defines `generate` globally using Prisma-only inputs (`prisma/**`, `prisma.config.ts`) and outputs (`src/generated/**`). This is valid for DB generation but incorrectly inherited by API-client generation.

`packages/api-client/package.json` reads `../../apps/api/openapi.json` and writes `src/schema.d.ts`. Neither is declared on its `generate` task. `packages/api-client/turbo.json` includes the contract only in `build` and `typecheck` inputs. A dry run confirms API-client `generate` hashes only package/config files and advertises `src/generated/**`. Restoring its cache cannot restore the actual generated schema or invalidate it when the contract changes.

Additionally, `build` and `typecheck` both call `bun run generate` even though Turbo already schedules `generate` before them. That redundant generation currently papers over the incomplete cache contract, and permits two concurrent writers to the same file. Fixing this is required before enabling cache reuse or deleting redundant generation.

The API OpenAPI task has **no prerequisites** (`bunx turbo run openapi --dry=json`). Its writer imports `apps/api/src/app.ts`, which imports compiled workspace packages such as billing and delegation. It currently succeeds after the previous workspace build by relying on artifacts left by another step. A standalone OpenAPI check needs explicit upstream build prerequisites. Preserve the committed-contract drift check; it is useful.

Web `typecheck` executes `next typegen` and web `build` executes `next build`; both may write `.next` type artifacts while the current multi-task invocation runs them concurrently. Treat this as a potential shared-output race to verify in a cold checkout, not a demonstrated cause of the captured failures. Separate runners for these lanes remove this collision without changing package exports.

### 4. Test infrastructure cost and interference drive timeout patches

`packages/db/src/testing.ts` starts and migrates a new pgvector Postgres container per `startTestDatabase()` call. Ten backend test files call it in their suite setup at the audited revision. Multiple package-local Vitest processes can start those containers concurrently, each running a synchronous Prisma migration subprocess. This provides good isolation, but its resource cost is not budgeted against other task runners.

Current mitigations include 15-second test budgets in API/identity/billing, 30 seconds in worker/delegation, 120/180-second setup hooks, and `fileParallelism: false` in delegation explicitly to avoid starving other packages. Those integration-test budgets are not inherently wrong, but repeatedly enlarging them or serializing individual packages cannot fix the global resource model.

`apps/worker/src/workflows.test.ts` already bundles workflows once per file; retain that useful optimization. Replay still passes `workflowsPath` to `Worker.runReplayHistory`, so it bundles inside the timed test rather than consuming the existing production bundle. Measure that setup separately; share a test bundle only after proving it represents the exact code/history being validated.

Commit `2856716` reduced pool-isolation test traffic from 40 to 20 transactions to stay inside Prisma's acquisition wait. It still tests reuse beyond the default pool size, so it is not automatically invalid. However, relying on a default pool size and queue timing makes the regression test fragile. Give the test an explicitly small pool and assert deterministic cross-owner reuse; keep load/performance stress separate from correctness.

`apps/e2e/tests/cross-origin-session.spec.ts:43-48` waits 10 seconds and retries sign-in when tests exhaust a shared client-IP quota. This is a concrete timing workaround. Unique account names do not isolate an IP-based limiter. Isolate limiter state or the local test server per worker; preserve dedicated tests of the production rate limit. Do not bypass production authentication checks or change real client-IP trust to accelerate tests.

`apps/e2e/global-setup.ts` manually spawns three servers and returns teardown only after readiness succeeds. A startup failure before return can leave the DB/children alive until runner termination. Readiness accepts any status below 500, including 404, and the HTTPS request has no individual request timeout, so the outer deadline does not bound a hung request. Guarantee cleanup on partial startup, verify the expected endpoint response, and bound readiness requests. Use Playwright lifecycle facilities where they fit; dynamic database credentials and custom HTTPS still require explicit fixture ownership.

### 5. Some green checks are weaker than their names imply

Many scaffold packages run `vitest run --passWithNoTests`, including packages that now have tests. This silently succeeds if discovery breaks. Remove test scripts from genuinely empty packages instead of launching a process that proves nothing; remove `--passWithNoTests` from packages expected to have tests. Inventory actual test counts first so coverage is preserved.

Provider tests live alongside ordinary package tests and use `describe.skipIf` or `test.skip` when credentials are missing (`packages/ai/spike-f`, `packages/knowledge/spike-e`, `apps/e2e/tests/sse-c-browser.spec.ts`). Secret-free PR checks legitimately cannot exercise live providers, but a designated staging/provider job should fail configuration validation rather than succeed with all relevant cases skipped. Give these suites explicit names and selection commands. Run live tests directly or make their Turbo task uncached; provider availability and configuration are external state.

`spikes` runs after `checks`, in parallel with `migrate`, but no deployment job depends on it. Therefore live-provider failures do **not** stop deployment. Decide the role explicitly: this plan recommends a separately reported provider compatibility check, and makes post-deployment staging smoke the rollout gate. If a provider assertion is a pre-deploy prerequisite, add that edge explicitly instead. A green PR must not imply live-provider validation.

There are no workflow artifact uploads, despite Playwright retaining traces. A failed job loses the most useful browser diagnostics. Jobs also lack explicit duration budgets. The commit-lint job installs the full workspace and retains a historical baseline exception; check whether that baseline is still reachable as an active condition before retiring it.

Read-only API inspection found `main` has no classic branch protection (`404: Branch not protected`) and the repository ruleset listing was empty. Thus the fetched configuration does not enforce passing checks before merge. Protection changes belong to implementation, after stable check names are available; do not treat the existence of a CI workflow as merge enforcement.

### 6. Continuous integration is coupled to a long deployment chain

The top-level `concurrency: ci-${{ github.ref }}` serializes **the whole main workflow**, not individual checks within a run. A newer main commit waits while the previous run migrates, deploys API, parser, worker, web, and executes staging E2E. PR concurrency groups differ and correctly cancel superseded PR runs. Main's serialization also replaces older pending runs; it is not a durable FIFO queue.

Migrations preceding deploys are justified. Whether every service needs to wait for every other service to become live is a separate question. The code currently encodes `migrate → API → parser → worker → web → staging-e2e`. Document expand/contract compatibility before removing any edge; runtime dependence alone does not prove deployment dependence when the previous version is healthy.

The composite Vercel deploy action runs separate builds from CI's validation build. Environment-specific builds can be justified; they are additional deployment work, not evidence that validation checks themselves take that long. Preserve the provider-specific build semantics until artifact reuse is demonstrated safe.

### Practices to preserve

- Pinned Bun version, frozen lockfile installation, Node runtime separate from Bun package management, read-only workflow token, and shared composite setup are conventional.
- Compiled `dist` workspace exports justify upstream `^build` requirements for consumers. Replacing all build edges with source imports or `--parallel` would break the intended architecture.
- Turbo's `transit → ^transit` dependency pattern is documented for parallel invalidation; it is not an improvised workaround.
- Playwright's one-worker CI setup is recommended for constrained runners. Increase throughput with runner isolation/sharding only when useful; do not equate every serial operation with bad practice.
- Real pgvector/Postgres, RLS runtime-role tests, HTTPS parent-domain cookies, hostile-origin checks, and migration-before-deployment test actual requirements. Do not replace them with mocks to make CI green.

## Proposed job design

PR/main validation starts independent jobs for: lint; typecheck; backend database tests; Temporal tests; lightweight remaining tests; Storybook browser tests; production build plus local E2E; OpenAPI drift; and PR commit lint. These are fixed workload lanes, not a dynamic workflow generator. Each lane executes only its actual prerequisite builds through Turbo. Keep production build and local E2E together initially so `.next` and workspace artifacts are reused without an artifact distribution system. Builds required by other lanes are reused from cache once safe.

An always-evaluated `checks` aggregation job depends on every mandatory validation lane and fails on any unexpected failure, cancellation, or skip. If commit lint exists only on PRs, explicitly account for its expected non-PR skip. Preserve `checks` as the stable required-check name. Add affected selection only after this full-coverage topology is working.

A separate deployment workflow receives the successful main CI result, checks the source workflow, branch, event and successful conclusion, checks out the exact validated SHA, and serializes the **entire staging rollout** with one environment concurrency group. Validation continues independently. Never lock each deployment job separately: two commits could interleave their services. Explicitly accept latest-pending-wins semantics, and reject stale promotion where appropriate. No deployment credentials or privileged workflow execution on untrusted PR code.

## Phase 0: Documentation discovery and baseline (completed for planning)

**How this serves the primary goal:** Establishes what is actually broken and which supported mechanisms can correct it without replacing one workaround with another.

Read full workflow/composite setup, package scripts, Turbo graph/config, test setup/config and relevant git history. Inspected recent GitHub job metadata and failed logs, and queried branch enforcement. Ran both workspace and OpenAPI `--dry=json` graph inspections. No application tests, live provider tests, migrations, or deployments were executed in this audit.

Documentation and allowed mechanisms:

- Installed Turbo 2.11.10: `node_modules/turbo/docs/README.md`; `crafting-your-repository/{configuring-tasks,constructing-ci,using-environment-variables}.mdx`; `reference/{configuration,run,package-configurations}.mdx`. Supported: `dependsOn`, package task overrides, `inputs`, `$TURBO_DEFAULT$`, `$TURBO_ROOT$`, `outputs`, `env`, `passThroughEnv`, `cache`, `--filter`, `--concurrency`, `--affected`, `TURBO_SCM_BASE`, `TURBO_SCM_HEAD`, `--dry=json`.
- [GitHub jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs): independent jobs and real `needs` dependencies; aggregation must evaluate failed/skipped dependencies explicitly.
- [GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency): workflow/job groups, cancellation, pending-run replacement.
- [Bun installation](https://bun.sh/docs/pm/cli/install): frozen installation with official setup action; retain the committed lockfile.
- [Playwright CI](https://playwright.dev/docs/ci): bounded worker count, browser dependencies and report artifacts.
- [Playwright web servers](https://playwright.dev/docs/test-webserver): `webServer` object/array with `command`, `url`, `env`, `cwd`, `timeout`, `reuseExistingServer`, `ignoreHTTPSErrors`, and graceful shutdown. Avoid deprecated `port` configuration. Built-in readiness alone is not a substitute for checking application health semantics.
- During implementation also read current [workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [required check troubleshooting](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks), and the installed Turbo GitHub cache guide before copying configuration.

Verification: evidence is tied to actual run URLs and the audited revision. Remaining unknowns: CPU/memory profiles, account runner-concurrency quota, exact isolated-test durations, remote deployment compatibility and environment settings. Do not promise a speedup percentage or assume all timeouts share one cause.

## Phase 1: Correct task and generated-file ownership

**How this serves the primary goal:** Makes clean jobs and cache hits reproduce the same artifacts instead of relying on earlier steps to repair missing output.

Implement in `turbo.json`, `packages/api-client/turbo.json`, API task overrides as needed, and API-client scripts. Copy the package override and input/output patterns from the installed configuration docs. Scope Prisma generation to DB, declare API-client generation inputs including the committed contract and outputs including `src/schema.d.ts`, then remove duplicate generation from build/typecheck scripts. Give OpenAPI generation the upstream prerequisites its imports require. Keep direct developer commands usable and document Turbo as the orchestration entry point. Check web type generation ownership before changing its task graph.

Verification: in a disposable clean checkout, generate/typecheck/build succeed without pre-existing dist or schema files. Run once, delete declared generated outputs, and confirm a cache hit restores them. Change only OpenAPI content and prove generation/consumer invalidation; change Prisma schema and prove DB/dependent invalidation. `--dry=json` shows the expected dependencies and file inputs.

Guards: no CI pre-generation step to compensate for wrong task edges; no shared file written by concurrent tasks; no removal of `^build` where exports still resolve to dist; do not enable shared caching before these checks pass.

## Phase 2: Split validation into independent resource lanes

**How this serves the primary goal:** Produces early independent results and prevents browser, Temporal, database and production-build workloads from starving each other.

Implement the fixed job design above in `.github/workflows/ci.yml`; reuse `.github/actions/setup`. Copy standard independent-job and `needs` examples from GitHub docs. Install Chromium only in jobs using browsers. Backend lane selects db/delegation/billing/identity/api; Temporal selects worker; the remaining test lane covers parser, AI unit tests and commitlint-config, plus any other package with real tests found in the inventory. Storybook selects UI. Lint/typecheck cover all applicable packages. Production build covers all build scripts and immediately runs local E2E. OpenAPI drift is independently runnable after Phase 1.

Set explicit runner/task worker budgets per lane based on available CPU and memory, accounting for both Turbo and Vitest workers. Start the multi-package DB lane with a conservative package concurrency and increase only after measurement. A measured resource budget is standard scheduling, unlike ad hoc exceptions for whichever package timed out last. Do not add a global build prerequisite to all jobs.

Add bounded `timeout-minutes`, Playwright reports/traces, and test diagnostics uploaded on failure or non-cancellation as appropriate. Preserve stable aggregate `checks`, accounting explicitly for the PR-only commit job. Retire the historical commit baseline exception only after proving it no longer changes the lint range.

Verification: job start timestamps overlap; a deliberate lint failure does not prevent browser/test results from reporting, and fails the aggregate. A failed or unexpectedly skipped required lane cannot produce a green aggregate. Inventory confirms every existing test/build/lint/typecheck command remains covered. Verify on Linux CI, not only a developer machine.

Guards: no background shell jobs, `--parallel` bypass of dependencies, `continue-on-error`, indiscriminate retries, or increased timeout as the primary fix. Do not enable affected selection yet.

## Phase 3: Make expensive tests isolated and deterministic

**How this serves the primary goal:** Removes shared-state delays and unnecessary setup work while preserving meaningful integration and security checks.

Measure identity password reset and Temporal replay alone versus their previous combined workload. Attribute setup, bundle, hash, migration and assertion time separately. Fix any remaining real failure before removing timeout mitigations. Preserve realistic integration/setup budgets justified by measurements.

Keep Testcontainers initially. If container/migration startup remains a material bottleneck, implement one container per test lane with a separate migrated database and runtime role per test worker/file; prove isolation before replacing the current helper. A shared mutable database or connection-URL override is not enough: role/DDL/fault-injection tests must not contaminate one another. Avoid a speculative database-pool service.

Remove the E2E 10-second wait/retry by isolating the local API/limiter state per worker or fixture. Staging tests must preserve production limits and avoid concurrent suites sharing the same quota; pre-authenticated fixtures can cover non-login behavior while explicit login tests exercise the real path. Use explicit small pool fixtures for connection-reuse correctness. Guarantee partial-startup teardown and bounded health requests; copy Playwright lifecycle configuration where suitable and preserve HTTPS/cookie semantics.

Verification: repeated isolated password-reset and replay runs pass without retries; browser suite order does not trigger quota sleeps. Pool tests demonstrate actual reuse and reject owner leakage. Force server startup failure and verify all children/containers terminate. Compare full test inventory before/after. Only then reassess delegation's blanket file serialization and per-package timeout patches.

Guards: no production auth/RLS weakening, fake password hashing in integration coverage, shared destructive DB fixtures, or reduced assertion strength. Do not remove existing working tests to meet a timing target.

## Phase 4: Enable correct cache reuse and affected execution

**How this serves the primary goal:** Stops reinstalling and rebuilding unchanged work without allowing stale or missing artifacts to pass validation.

Copy Bun cache-directory guidance and installed Turbo GitHub cache examples into shared setup. Begin with GitHub Actions persistence of Bun's download cache and `.turbo`; use keys scoped by OS/toolchain/lockfile and job lane with restore prefixes that permit Turbo's own hashes to select valid entries. Keep frozen installs; avoid caching all node_modules or treating a restored cache as proof installation is unnecessary. Cross-run reuse is sufficient initially; Remote Cache is optional if later needed for sharing concurrent jobs' work.

Audit environment-sensitive tasks with Turbo strict environment mode. Declare task `env` for output-affecting values and narrowly scoped `passThroughEnv` for runtime-only values. Keep external/live integration tasks uncached. Do not use global loose mode or hash secrets unnecessarily. Define DB URL behavior explicitly rather than letting ambient URLs silently redirect integration tests to shared databases.

Then add documented `--affected` selection to PR task commands with enough fetched history and explicit base/head where needed. Full validation remains on main. Treat root lockfile, shared configuration, workflow/setup changes and missing comparison history conservatively. Keep local E2E full until selection can prove its API/web/DB and global-configuration dependencies; the initially small suite does not justify a bespoke path-change engine.

Verification: unchanged second run shows meaningful build/cache hits; cold run still succeeds. Contract/schema/shared-config/lockfile changes select every dependent task. Documentation-only PR is fast but still emits the required aggregate. Validate fork PR behavior without secrets and confirm failing tasks cannot leave reusable success entries. Cache invalidation tests from Phase 1 still pass.

Guards: caching cannot fix bad dependencies; no shell-maintained package graph, cache keyed only by branch name, cached live-provider successes, or skipped mandatory job without an explicit aggregate policy.

## Phase 5: Separate deployment serialization and make gates honest

**How this serves the primary goal:** Lets subsequent commits validate immediately while staging remains consistent and its reported success means required tests actually ran.

Add a deployment workflow using the documented successful-main `workflow_run` pattern and exact validated SHA; scope environment-wide concurrency to the whole deployment workflow. Keep CI supersession behavior separate. Retain migration ordering and existing service order initially; shorten only edges proven unnecessary by a written compatibility contract. Verify both provider build actions and Render API script deploy the exact SHA. A failed migration must stop all rollout steps.

Separate live-provider selections from ordinary tests. Validate required staging credentials before execution; unexpected zero/all-skipped live cases fail the designated check. Document whether provider compatibility is advisory or a deploy prerequisite; staging smoke remains a required rollout result. Retain real Hetzner SSE-C tests, including the documented unsupported CopyObject behavior, rather than substituting generic S3 assumptions. Remove `--passWithNoTests` from packages with expected tests and remove empty scaffold test commands. Document genuinely excluded live coverage on PRs.

After check names stabilize, configure a main ruleset requiring PRs and successful aggregate `checks` (and any other deliberate merge policy). This is a repository setting, not a YAML-only guarantee. Add merge-queue event support only if a queue is enabled.

Verification: a second main commit starts CI during the previous deployment; staging rollouts never overlap or interleave commits; only successful trusted main validation triggers promotion. Migration failure blocks all deploys; staging smoke failure marks rollout failed. Missing live credentials cannot produce a green live-test gate. A deliberately failing required check blocks merge under the actual ruleset.

Guards: no privileged execution of PR artifacts through `workflow_run`, per-job environment locks that interleave rollouts, dropping migration safeguards, or manual secrets copied into PR jobs.

## Phase 6: Prove correctness, reliability and improvement

**How this serves the primary goal:** Makes completion depend on trustworthy checks and measured throughput, rather than a single green rerun.

Run workflow validation with actionlint and compare implementation to official examples. Exercise deliberate failures, startup cleanup, cache restore/invalidation, missing credentials, skipped lanes, PR supersession and deployment serialization. Run the complete applicable test suite on a cold Linux runner and with a warm cache. Confirm required branch policy reflects actual job names.

Collect queue delay, setup duration, each lane's duration, total PR wall time, total runner minutes, cache hit rate and retry-free success over at least ten representative PR/main validations. Include both captured failing suites. Initial acceptance target: zero unexplained timeout failures or manual reruns across those observations; independent lanes overlap; warm unchanged work hits cache; no lost tests or silently skipped required provider cases. If a failure occurs, diagnose it and restart the reliability observation window after the fix.

Compare with the baseline below, using equivalent changes and separating CI from deployment. Set a numeric latency target from the first isolated cold/warm measurements, not an invented promised percentage. Account quotas may cap simultaneous jobs; inspect actual queued time before buying larger runners or adding shards.

Baseline from successful [PR run 41133037041](https://github.com/chris23lngr/nunio/actions/runs/41133037041): `checks` 5m02s; setup 51s; Chromium installation 26s; workspace tasks 2m29s; serial UI 30s; OpenAPI 1s; E2E 39s, plus job overhead. Successful [main run 41133845765](https://github.com/chris23lngr/nunio/actions/runs/41133845765): checks 5m26s, then deployment/staging tail; overall workflow creation to last job completion 13m00s. These are illustrative observed runs, not a p50/p95 estimate. Main head run `41138455550` was still in progress when sampled and is not used as a completed baseline.

Guards: no claiming success from local cached tests alone, fewer assertions, increased retries, or a single successful rerun. Stop adding checks once the stated acceptance criteria pass unless new failures justify more work.

## Scope and rollout

Implement phases in order, keeping each change reviewable. Phases 1–2 address the immediate structural problem; Phase 3 resolves remaining test causes; Phase 4 reduces repeated work; Phase 5 separates delivery and enforces honest gates. No CI change, settings mutation, commit, push, PR, deployment or live-provider execution was performed for this planning task.

Defer changing package managers, converting every internal package to source exports, replacing test frameworks, buying larger runners, broad test rewrites, and new infrastructure. None is justified by current evidence. Revisit sharding or Remote Cache only if measured lane duration and cache transfer costs warrant it.

## Implementation record (2026-10-31)

Artifact ownership and independent validation jobs were merged in [PR #6](https://github.com/chris23lngr/nunio/pull/6). Test isolation, cache reuse, affected selection, separate staging delivery, explicit live suites, and the remaining reliability fixes are in [PR #7](https://github.com/chris23lngr/nunio/pull/7), on `chore/ci-remediation`. The main [ruleset](https://github.com/chris23lngr/nunio/rules/26246644) is active: pull requests and successful GitHub Actions `checks` are required, with an up-to-date base and no bypass actors.

The first parallel [PR validation](https://github.com/chris23lngr/nunio/actions/runs/41140066368) and its [main validation](https://github.com/chris23lngr/nunio/actions/runs/41140501512) passed. A later [follow-up validation](https://github.com/chris23lngr/nunio/actions/runs/41141118430) exposed a switch-story assertion that read its color during a CSS transition. A focused reproduction confirmed the correct dark token and a running transition; the existing exact final-color assertion now waits for that state. It passed five targeted runs and the full UI suite without changing the component or broadening the expected color.

Local verification on the follow-up implementation:

| Check | Result |
| --- | --- |
| Full lint / typecheck | 20 / 29 Turbo tasks passed, in separate invocations |
| Database/API integration tests | 89 tests passed, with one package and file worker at a time |
| Temporal tests | 5 tests passed |
| Lightweight tests | 41 tests passed in Phase 5; their sources are unchanged |
| Storybook browser tests | 57 tests across 16 files passed |
| Production builds / local E2E | 18 build tasks and all 9 browser tests passed |
| Workflow and installation validation | actionlint and frozen-lockfile dry installation passed |

Earlier probes also verified byte-identical generated-artifact restoration, contract/schema/shared-configuration affected selection, startup-failure cleanup, aggregate failure/skip handling, and missing-configuration rejection. Staging discovery selects eight cases; live calls were not executed locally. The redundant delegation-only file-serialization override was removed: CI owns its worker budget through `--maxWorkers=1`. Integration/setup timeouts remain explicit budgets for real password hashing, database startup and operator subprocesses; no timeout was increased to hide a failing test.

Phase 6 remains open for the final PR Linux result, a post-merge rollout of the new deployment workflow, and at least ten representative validations after the last reliability fix. Record cold/warm cache behavior, queue and lane durations, runner minutes and retry-free outcomes during that window. The successful intermediate runs and local checks above do not establish that observation window or prove the new staging rollout.
