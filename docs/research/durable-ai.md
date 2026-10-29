# Durable agent execution and scoped retrieval — documentation discovery

Checked: 2026-10-29. Input: [confirmed product brief](../product-brief.md). This is research and a proposed design, not an implemented or approved technology selection. No provider pricing, hosting region, model capability, or compliance promise has been verified here.

## Finding and recommendation

**Proposed:** use Temporal for durable orchestration in the dedicated worker app, subject to a deployment/cost spike; use AI SDK for bounded model calls within Activities; keep authorization, approval records, budgets, and action outcomes in application-owned Postgres tables. Start retrieval with exact, explicitly filtered pgvector queries and introduce approximate indexes only after measuring scoped recall and latency.

The architecture must distinguish a workflow resuming successfully from an external side effect happening exactly once. A workflow engine cannot remove an external provider's ambiguous timeout or create an idempotency guarantee the provider does not offer.

## Verified APIs and copy locations

### Temporal TypeScript

| Purpose | Verified API/configuration | Primary source and snippet location |
|---|---|---|
| Dedicated worker | `Worker.create({ connection, namespace, taskQueue, workflowsPath, activities })`, `worker.run()` | [Run a Worker](https://docs.temporal.io/develop/typescript/workers/run-worker-process), “Create and run a Worker”; linked `snippets/src/worker.ts` |
| Production workflow bundle | `bundleWorkflowCode({ workflowsPath })`, `workflowBundle: { codePath }` | Same page, linked `production/src/scripts/build-workflow-bundle.ts` and `production/src/worker.ts` |
| Deploy compatible workers | `workerDeploymentOptions: { version: { deploymentName, buildId }, useWorkerVersioning: true, defaultVersioningBehavior: 'PINNED' }` | Same page, “Run a versioned Worker”; validate installed SDK and server compatibility before adoption |
| Activity calls and retries | `proxyActivities<typeof activities>({ startToCloseTimeout, scheduleToCloseTimeout, retry: { initialInterval, maximumAttempts }, heartbeatTimeout })` | [Activity Timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts), “Activity Timeouts”, “Activity Retry Policy”, “Activity Heartbeat Timeout” |
| Cancellation observation | `Context.current().cancellationSignal`, `Context.current().cancelled`, `heartbeat(...)` | Same Activity Timeouts page, “Heartbeat an Activity”; use cancellation-aware I/O |
| Cancellation sequencing | `ActivityCancellationType.WAIT_CANCELLATION_COMPLETED` versus default `TRY_CANCEL` | [Cancel a Workflow](https://docs.temporal.io/develop/typescript/workflows/cancellation), “Set the Activity cancellation type” |
| Durable approval wait | `defineSignal<Args>(name)`, `setHandler(signal, handler)`, `condition(() => approved)` | [Workflow message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing), “Signal handlers”, “Wait for a Signal or Update to arrive” |
| Workflow code changes | `patched(changeId)`, `deprecatePatch(changeId)` | [Versioning](https://docs.temporal.io/develop/typescript/workflows/versioning), “Patching in new code”; linked `patching-api/src/workflows-v2.ts` and `workflows-v3.ts` |
| Test waiting and replay | `TestWorkflowEnvironment.createTimeSkipping()`, `Worker.runReplayHistory(options, history)` | [Testing](https://docs.temporal.io/develop/typescript/best-practices/testing-suite), “Set up time skipping”, “How to Replay a Workflow Execution” |

Workflow code is deterministic; external I/O belongs in Activities. Import Activity types rather than Activity implementations into workflow code. The workflow sandbox is for deterministic replay, not a security sandbox for arbitrary student or model code. [Workflow basics, “Develop Workflow logic”](https://docs.temporal.io/develop/typescript/workflows/basics).

Activities receive default retry policies unless overridden. Set explicit attempt and elapsed-time limits appropriate to each operation. Cancellation is cooperative: heartbeats deliver Activity cancellation, and the Activity must observe it. `TRY_CANCEL` can allow workflow progress while an Activity still executes; waiting for acknowledgment still does not undo an external action. [Activity Timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts), [Cancel a Workflow](https://docs.temporal.io/develop/typescript/workflows/cancellation).

Message handlers can interleave. Keep approval state transitions short and deterministic, or serialize them deliberately. Wait for active handlers before finishing a workflow when necessary. [Workflow message passing, “Use a lock to prevent concurrent handler execution” and “Ensure your handlers finish”](https://docs.temporal.io/develop/typescript/workflows/message-passing).

### BullMQ alternative

BullMQ documents `Queue.add(name, data, { attempts, backoff: { type: 'exponential', delay, jitter } })`; retries require idempotent jobs. Its production guide now distinguishes Redis-compatible and PostgreSQL backends, so do not describe current BullMQ as Redis-only. The Redis path requires deliberate persistence and `maxmemory-policy=noeviction`. [Retrying jobs](https://docs.bullmq.io/guide/retrying-failing-jobs), [Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [Going to production](https://docs.bullmq.io/guide/going-to-production).

**Assessment, not a benchmark:** BullMQ is a credible option for discrete queued work. For nunio's approvals, timers, follow-ups, cancellation, and long-lived responsibilities, an application state machine would still need to coordinate the jobs. Temporal supplies an explicit workflow model but adds its service, deployment/versioning discipline, and operational or managed-service cost. Validate those costs and workflow replay behavior before selecting it. Do not install both orchestration systems initially. BullMQ's newer PostgreSQL backend was observed in current docs but not evaluated for maturity or migration semantics.

### AI SDK: current documentation is v7

The current documentation explicitly labels itself **v7**. Pin a compatible stable release and matching provider packages; do not mix copied v6 examples into this API surface.

| Purpose | Verified API/configuration | Primary source and snippet location |
|---|---|---|
| Typed local tools | `tool({ inputSchema, execute })`, `generateText(...)`, `streamText(...)` | [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), opening example |
| Tool approval | `toolApproval: { toolName: 'user-approval' }`; `tool-approval-request` / `tool-approval-response` parts | Same page, “Configure toolApproval”, “Handling Approval Requests” |
| Bounded loop | `ToolLoopAgent`, `stopWhen: isStepCount(n)`, `prepareStep` | [Loop Control](https://ai-sdk.dev/docs/agents/loop-control), “Run Up to a Maximum Number of Steps”, “Context Management” |
| Model allowlist | `customProvider({ languageModels })`, `createProviderRegistry(...)`, `registry.languageModel(id)` | [Provider & Model Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), “Custom Providers”, “Provider Registry” |
| Request bounds | `maxOutputTokens`, `maxRetries`, `abortSignal`, `timeout` | [Settings](https://ai-sdk.dev/docs/ai-sdk-core/settings), “Request Options” |

`needsApproval` on a tool is deprecated in the inspected docs; use `toolApproval`. Manual approval returns from the generation call and requires a later continuation; it is not durable persistence. Provider-executed tools bypass this local approval mechanism. Consequently, do not expose provider-side consequential tools unless separately governed. Strict schemas are provider-dependent and do not replace application authorization. [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).

`isStepCount` bounds steps, not total money. A stop condition based on accumulated usage checks completed steps and cannot prevent concurrent jobs from consuming the same remaining allowance. `prepareStep` can manage context. `maxRetries` defaults to two; coordinate SDK retry limits with Activity retries to avoid multiplying requests. [Loop Control](https://ai-sdk.dev/docs/agents/loop-control), [Settings](https://ai-sdk.dev/docs/ai-sdk-core/settings).

### Postgres and pgvector

pgvector documents exact filtered nearest-neighbor queries and recommends indexing filter columns. Approximate index filtering happens after candidate scanning and can return too few matches. `SET hnsw.iterative_scan = strict_order` expands scanning within bounds; it is not a perfect-recall guarantee. Shared approximate indexes also permit other tenants' vectors to affect recall/performance. Copy patterns from [pgvector README: Filtering, Multitenancy, Iterative Index Scans](https://github.com/pgvector/pgvector#filtering).

Postgres RLS uses `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`. Enabled tables without applicable policies default-deny normal access. Superusers and `BYPASSRLS` roles bypass it; table owners normally do too unless forced. Copy owner/app-role separation and policy examples from [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). RLS alone does not establish the correct tenant context or govern object-storage access.

## Proposed application invariants

These are nunio design recommendations, not library guarantees or existing APIs:

1. **Action records:** persist an immutable action ID, authenticated owner, responsibility/config revision, connector identity, exact destination, artifact version/hash, proposed arguments, approval scope/expiry, and status. Changing consequential inputs invalidates approval.
2. **Execution gate:** recheck ownership, current permissions, revocation, course rules, approval validity, and budgets immediately before external dispatch. A model cannot provide the acting identity or permission grant.
3. **Safe dispatch:** commit intended work plus an outbox record transactionally; deliver it to the workflow service using a stable identity. Deduplicate incoming events. Keep stable provider idempotency keys where supported and record attempts/results. Worker restart after remote success but before local acknowledgment must reconcile; if success cannot be established, show `outcome_unknown` and require resolution rather than blind retry.
4. **Limits:** reserve conservative per-call usage atomically in Postgres before dispatch, account for concurrent work and retries, then settle actual measured usage. Do not release uncertain reservations merely because a local timeout fired. Apply per-user/responsibility concurrency limits, model/token ceilings, deadlines, and a global kill switch. Provider billing reconciliation is separate from estimated usage.
5. **Scope:** resolve the allowed owner/course/material IDs server-side; enforce them in the retrieval query and subsequent fetches. Empty scope means no sources. Snapshot the selected context revision per run, recheck access after deletions/revocations, and never broaden scope to compensate for weak retrieval. Apply scope to memory summaries and caches as well as source chunks.
6. **History:** store source content and large artifacts outside workflow histories; pass opaque references. Define history retention, payload encryption/redaction, deletion handling, and logs before personal data enters the service. A workflow record is another data processor/storage boundary.
7. **No arbitrary execution initially:** implement supported study tools as vetted application functions. If generated-code execution is later enabled, it requires a separately evaluated isolated runtime, resource limits, and egress policy; an AI SDK tool definition or Temporal sandbox is not sufficient.

## Verification to carry into the plan

- Kill and restart a worker while waiting for approval; approval and continuation survive.
- Replay old workflow histories against a proposed deployment; reject incompatible changes.
- Exercise duplicate events, repeated approval clicks, stale artifact approvals, revocation during waits, and permissions changed before dispatch.
- Simulate remote success followed by response loss; verify reconciliation or visible uncertainty, with no uncontrolled repeated submission.
- Race concurrent jobs against one allowance; reserved plus settled spend stays within the configured application limit, with uncertain charges retained for reconciliation.
- Test unauthorized tenant IDs, deselected courses, deleted materials, private chats, and retrieval caches; no forbidden context reaches model requests.
- Compare scoped approximate retrieval with exact results if an ANN index is introduced; record recall and latency under restrictive filters.
- Test cancellation propagation and notification deduplication without assuming remote side effects can be undone.

## Confidence and remaining gaps

High confidence in the documented API names and caveats above; documentation was inspected directly. No code was compiled, installed, or load-tested. Exact package versions, server compatibility, provider model support, provider retention/regions, workflow hosting economics, storage encryption, connector idempotency and reconciliation APIs, parser/OCR selection, and model evaluation thresholds remain implementation-discovery gates. This research does not establish a production SLA or legal compliance.
