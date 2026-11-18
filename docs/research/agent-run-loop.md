# How a Run drives the model through an Agent's instructions

Checked: 2026-11-18. Question: [#141](https://github.com/chris23lngr/nunio/issues/141), on map [#140](https://github.com/chris23lngr/nunio/issues/140) (Agents v1). This is research and a proposed design, not an accepted decision. "Agent" here means the student-owned delegation the map defines (formerly Responsibility). Code names below (`responsibilityRun`, `responsibilityId`) are as they are in the checkout.

Inputs: [ADR-0001](../adr/0001-grants-only-within-responsibilities.md), [ADR-0004](../adr/0004-temporal-cloud-for-durable-execution.md), [ADR-0006](../adr/0006-one-workflow-per-run.md), [ADR-0010](../adr/0010-approval-requires-confirming-the-exact-action.md), [ADR-0011](../adr/0011-claude-on-bedrock-eu.md), [ADR-0018](../adr/0018-model-catalog-in-the-database.md), [ADR-0019](../adr/0019-the-chat-model-calls-tools.md), [durable-ai.md](durable-ai.md). Primary sources: the installed `ai@7.0.157` package (its bundled `docs/` and `dist/index.d.ts`), `@temporalio/workflow` and `@temporalio/client` 1.25.0 type definitions, Temporal's documentation, and the npm registry entry for `@temporalio/vercel-ai-sdk`. No code was written or run.

## Finding and recommendation

**Recommended: a nunio-owned loop in the workflow, one Activity per model step, in two phases.**

1. **Work phase (minutes).** The workflow loops over model steps. Each step is one Activity, `agentStep(runId, n)`. It makes one metered `generateText` call with the AI SDK's default single step, runs any read tools the model called, persists the step to Postgres, and hands the workflow only the Action calls. Action tools have no `execute` function. The workflow sends each Action through the existing gate (`performAction`). An Action under a Grant happens at once and its outcome goes back to the model. An Action that needs Approval goes back as "asked the student; it has not happened". The model never waits for an Approval.
2. **Settle phase (up to 7 days).** Once the model has finished, the workflow waits for all of the Run's open Approvals in parallel, using the `approvalDecided` signal and `condition` with a timeout at each Approval's `expiresAt`. It then asks the gate again for each one. No further model steps run.

Bounds: a step cap with a forced final answer, a cap on Actions per Run, `meter` on every step against the Agent's Budget and the Allowance, a size cap on tool results, and a Run lifetime of the work phase plus at most one Approval window. A Pause stops the Run at the next step or Action at the latest, because `meter` and the gate both recheck the Agent's state. A wake signal on Pause also ends the settle phase at once, instead of after 7 days.

This is the shape the code already has. The Chat loop (ADR-0019) makes one metered `streamText` call per step in nunio's own loop. `responsibilityRun` already gates Actions, waits for Approvals by signal and timeout, and stops on `paused`/`ended`/`unconfirmed`. The new parts are the model loop moving into the workflow, step persistence, and the two-phase split.

## What the stack offers

### AI SDK v7 (`ai@7.0.157`, installed)

| Fact | Source |
| --- | --- |
| `generateText`/`streamText` default to `stopWhen: isStepCount(1)`. One call is one model step, plus the execution of any tools it called that have an `execute`. | `dist/index.d.ts`, `stopWhen` on the call settings ("@default isStepCount(1)") |
| The loop stops when the finish reason is not `tool-calls`, when **a tool without an `execute` function is called**, when a call needs approval, or when a stop condition is met. | `dist/index.d.ts`, `StopCondition` doc comment; `docs/03-agents/04-loop-control.mdx` |
| `execute` is optional "because you might want to forward tool calls to the client or to a queue instead of executing them in the same process". | `docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx` |
| Built-in stop conditions: `isStepCount(n)`, `hasToolCall(...)`, `isLoopFinished()`. Custom conditions see all `steps` with their `usage`, so a cost condition is possible. `ToolLoopAgent` defaults to `isStepCount(20)`. | `docs/03-agents/04-loop-control.mdx`, "Stop Conditions" |
| `prepareStep` can swap tools (`activeTools`), `toolChoice`, model settings and `messages` per step. `pruneMessages` compacts history. | Same page, "Prepare Step", "Context Management" |
| `activeTools` limits which tools the model may call. `toolCallConcurrency` (default: all concurrent) controls parallel tool execution within a step. | `dist/index.d.ts`, call settings |
| `toolApproval` returns a `tool-approval-request` and needs a second call with a `tool-approval-response`. It applies only to SDK-executed tools. | `docs/03-agents/06-tool-approvals.mdx` |
| `WorkflowAgent` (`@ai-sdk/workflow`) gives a durable loop, but only on Vercel's Workflow DevKit runtime (`'use workflow'`), and applies **no** default step limit. | `docs/03-agents/07-workflow-agent.mdx`, "Loop Control" |

A custom `stopWhen` that sums usage "checks completed steps and cannot prevent concurrent jobs from consuming the same remaining allowance" ([durable-ai.md](durable-ai.md)). nunio's `meter` already does the right thing instead: it reserves before each call under a row lock.

### Temporal

| Fact | Source |
| --- | --- |
| Workflow code must be deterministic. Model calls and other I/O belong in Activities. | [Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics); [AI SDK integration](https://docs.temporal.io/develop/typescript/integrations/ai-sdk) |
| `condition(fn, timeout)` resolves `true` if `fn` became true, or `false` when the timeout fires. | `@temporalio/workflow` 1.25.0 `lib/workflow.d.ts` |
| Signals with `setHandler` and `condition` are the documented durable wait. Handlers can interleave. | [Message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing) |
| Event History is limited to 51,200 events or 50 MB, with a warning at 10,240 events or 10 MB. Each request payload is limited to 2 MB, and each history transaction to 4 MB. | [Workflow limits](https://docs.temporal.io/workflow-execution/limits); [Cloud limits](https://docs.temporal.io/cloud/limits) |
| Schedule overlap policy defaults to `SKIP`: a new Action is not started while the previous one runs. | `@temporalio/client` 1.25.0 `lib/schedule-types.d.ts`, `ScheduleOverlapPolicy` |
| Cancellation is cooperative. Activities see it only through heartbeats, and it cannot undo an external effect. | [Cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation); [Activity timeouts](https://docs.temporal.io/develop/typescript/activities/timeouts) |
| Temporal's own AI SDK plugin, `@temporalio/vercel-ai-sdk` (2.0.0, peer `ai ^7.0.127`; `@temporalio/ai-sdk` forwards to it), runs `generateText`/`streamText` **in workflow code** and turns each model call into an Activity behind the scenes. Tool `execute` functions run in the workflow and must call Activities for I/O. The page documents no timeout or retry options for the model Activity. | [AI SDK integration](https://docs.temporal.io/develop/typescript/integrations/ai-sdk); npm registry, `@temporalio/vercel-ai-sdk@latest` |

### What nunio already has

- **Chat loop** (`packages/chat/src/chats.ts`, `packages/ai/src/answer.ts`): nunio's own `for` loop, at most 6 steps. Each step is `delegation.meter(estimate, answerer.step(...))`, and the last step is sent with `toolChoice: "none"` (ADR-0011 forbids forcing a tool, not withholding tools). `maxRetries: 0` on the model, and rate limits are retried in `retryRateLimited`, metered per attempt. Tool results are fenced (`fenced`) as data.
- **Run workflow** (`apps/worker/src/workflows.ts`, `responsibilityRun`): `startRun` (refuses unless active), `proposeActions` (preset), then for each intent `performAction` with key `${runId}:${i+1}`. On `awaiting_approval` it waits on `approvalDecidedSignal` with `condition(..., expiresAt - now)` and asks the gate again. It raises an Intervention on `approval_expired` and `unconfirmed`, and returns `stopped` on `paused`/`ended`. Retries skip `InvalidIntentError` and `KeyConflictError`.
- **Gate** (`packages/delegation/src/gate.ts`, `decision.ts`): `perform(principal.fromRun(runId), { key, intent })` returns `done`/`refused`/`awaiting_approval`/`unconfirmed`. It refuses `paused` or `ended` from the Agent's current state and creates the Approval with `expiresAt = min(now + 7 days, Obligation deadline)`. `decide` never dispatches; the API signals `approvalDecided` with the action ID, which carries no authority.
- **Meter** (`packages/delegation/src/meter.ts`): for a Run with a `responsibilityId`, a conditional `UPDATE` reserves the estimate against the Budget only while the state is `active`. On exhaustion it pauses the Agent (`pausedBy: "budget"`) in the same transaction, then reserves against the Allowance. A refusal comes back as a value (`paused`, `ended`, `budget_exhausted`, ...), never thrown.

## Recommended design

### Loop shape

```
agentRun(ref)                                  // workflow, deterministic
  runId = startRun(ref)                        // Activity: refuses unless the Agent is active; snapshots its config
  for n in 1..maxSteps:
    s = agentStep({ runId, n, last: n == maxSteps })   // Activity: meter + one generateText + read tools + persist step
    if s.status == "refused": stop(s.reason)           // paused | ended | budget_exhausted | allowance_exhausted | model_unavailable ...
    if s.actions is empty: break                       // the model answered
    for each a in s.actions:                           // in call order
      outcome = performAction({ runId, key: `${runId}:${n}:${a.index}`, intent: a.intent })
      recordOutcome({ runId, n, toolCallId: a.toolCallId, outcome })   // becomes the tool result the next step sees
      if outcome is refused paused|ended, or unconfirmed: stop(...)
  settle(open Approvals)                       // parallel waits; gate decides again after each wake or expiry
```

- **One model step per Activity.** `agentStep` loads the Run's transcript from Postgres, builds the `ToolSet` from the tools the Agent chose (snapshotted at `startRun`), and calls `generateText` with the default `isStepCount(1)`. Read tools have an `execute` and run inside the call. Action tools have none, so the SDK returns their calls unexecuted. The Activity checks each Action call's arguments the way Chat's `approveProposal` does (`plan.check`, handles from this Run). A violation is written back as that call's tool result with its reason, and only valid intents go to the workflow.
- **Workflow state stays small.** The workflow holds step numbers, action keys and outcomes. Messages, tool results and Source text never cross the workflow boundary. ADR-0004 lets Temporal store only ciphertext and opaque IDs, and durable-ai.md (invariant 6) keeps content out of histories. It also stays far below the 2 MB payload and 50 MB history limits.
- **`generateText`, not `streamText`.** Nobody watches a background Run token by token. "Läuft grade" is shown from persisted steps (#149).
- **The last step answers.** `n == maxSteps` is sent with `toolChoice: "none"` and asks for the Run's summary, as Chat does.

### Bounding the loop

| Bound | Proposal | Why |
| --- | --- | --- |
| Steps | `maxSteps` per Run, a constant to tune from evaluations (start near 12; Chat uses 6). The last step is forced to answer. | Stops runaway loops. `WorkflowAgent` and `isLoopFinished()` have no default bound. |
| Money | `meter` on every step, as today. Its Budget reservation also enforces Paused/Ended and auto-pauses on exhaustion. No separate per-Run money cap: the worst case per Run is `maxSteps` × the step estimate. | Reuses the row-locked reservation that is correct under concurrency. A `stopWhen` on summed usage is not. |
| Actions | At most N Actions per Run (for example 10) and at most M per step. Further Action calls get the tool result "limit reached". | Bounds what an injected or confused instruction can do in one Run (#142), and the number of Approval cards. |
| Context | Cap each tool result's size inside `agentStep` and trim older read results from the transcript, as `prepareStep`/`pruneMessages` do. The step estimate grows with the transcript and is an upper bound. | Keeps later steps from growing without bound in cost. |
| Time | Work phase: each `agentStep` has `startToCloseTimeout` ≈ 3 min (the meter's 120 s call timeout plus persistence) and a heartbeat. Settle phase: at most the latest open Approval's `expiresAt`, which is ≤ 7 days after the work phase. | Keeps ADR-0004's "bounded Approval expiry gives a known window" for removing `patched()` branches. |

**Retries.** Make `agentStep` idempotent on `(runId, n)`: if step `n` is already persisted, return it without calling the model. Then a retried Activity cannot produce different tool calls under the same action keys, which the gate would reject as `KeyConflictError`. A call whose outcome is unknown keeps its reservation `held`, as today. Trade-off: allowing 2–3 attempts after an unknown failure can pay for a step twice, but each attempt is metered against the Budget. A single attempt, like extraction, fails the whole Run on one network blip. Recommend 3 attempts, with `DefiniteFailure` rate limits retried in the Activity as `retryRateLimited` does.

### Actions, the gate and Approvals

- **Authority comes only from the gate** (ADR-0001, ADR-0010). Don't use the AI SDK's `toolApproval` in a Run at all: ADR-0019 rejected it as an Approval, and a Run has no UI stream to answer it. An Action tool without `execute` is the hand-off to the workflow.
- **Keys are deterministic:** `${runId}:${step}:${callIndex}`. They stay stable across Activity retries because the step is persisted.
- **What the model hears back:**
  - `done` → the effect (for example the new block's handle);
  - `refused` → the reason (`locked`, `protected_time`, `restricted`, ...), so it can adapt;
  - `awaiting_approval` → "asked the student; this has not happened; do not build on it".
  The model therefore cannot plan on top of an unapproved Action. ADR-0019 has the same rule: "A proposal waits for the student, so the turn ends with it".
- **The settle phase reuses `responsibilityRun`'s wait.** `setHandler(approvalDecidedSignal)` counts wakes per action ID. Each open Action waits on `condition(() => woken(actionId), expiresAt - now)`, and all waits run in parallel (`Promise.all`). After a wake or a timeout the Run calls `performAction` again with the same key. On `approval_expired` it raises the existing Intervention, on `unconfirmed` the Intervention plus a stop, and on `paused`/`ended` a stop. The signal carries no authority; the decision is already recorded by `decide`, and `reconcile` re-delivers lost wakes.
- **Overlap.** Keep `ScheduleOverlapPolicy.SKIP` and one workflow ID per Agent, so two Runs never plan against the same Plan at once. The cost: a Run waiting for an Approval skips that Agent's next scheduled Runs for up to 7 days, and "Jetzt starten" collides with it. See open questions.

### Recording steps

- **Postgres, not Temporal.** Temporal history is ciphertext, kept 7 days (ADR-0004), and sized for IDs. Each `agentStep` writes one row per step under `(runId, n)` in the same Activity that ran it. The row holds:
  - what the student may see: reasoning summary or text, each tool call's display line, the tool result summary, linked `Action` IDs, and the step's `usage_reservation`;
  - the full transcript the next step needs.
  Both are sealed under the Sources the step read (`derived.seal`), so deleting a Source withdraws them, as with Chat answers.
- **Full tool results are transient.** Drop the transcript when the Run ends and keep only the display parts. ADR-0019 does the same for Chat: "Full results are never stored".
- **Actions already have their own history** (`action`, `approval`, `action_event` with `runId`), so the activity log joins steps to Actions rather than copying them.

### Paused or Ended mid-Run

- **The database state decides; Temporal only wakes.**
  - Model steps: `meter` refuses `paused`/`ended` in the reserving transaction, so the next step is refused.
  - Actions: the gate refuses them at dispatch.
  - In flight: a step already running finishes (≤ 120 s) and is settled, but its Action calls are then refused by the gate.
  So a Pause takes effect at the next step or Action at the latest, which matches the glossary's "takes no further Actions, including in a Run already under way".
- **A wake on Pause or End.** When the student pauses or ends the Agent, the API also signals the Run (for example `agentStateChanged`, without authority), and every settle wait wakes. The re-asked gate refuses `paused`, the Action is recorded `refused`, and the Run stops. Without the signal the Run would hold the Agent's workflow ID (and block "Jetzt starten") until expiry.
- **Don't use Temporal cancellation for this.** It is cooperative, needs heartbeats in every Activity, cannot undo an effect, and adds a second stop path that replay tests must cover. Resuming an Agent never resumes an old Run; the next trigger starts a new one.
- **Budget exhaustion** is a Pause from inside `meter`. The Run sees `budget_exhausted` and stops itself, with no signal needed.

### Determinism and versioning

- Workflow code imports no AI SDK and no provider. The step loop, counters, keys and waits are all it holds. `Date.now()` in the workflow sandbox is deterministic, as the current `condition` timeout already relies on.
- `agentRun` is a new workflow type, not a `patched()` branch of `responsibilityRun`. Old Runs finish on the old code within their 7-day window, then `responsibilityRun` can be deleted. Add a recorded history under `apps/worker/histories/` (one Approval wake, one Pause stop) to the replay tests.
- Snapshot the Agent's instructions, tools, Courses and Model at `startRun` (durable-ai.md, invariant 5). The gate and `meter` still read Grants, state and Budget fresh. Each `agentStep` checks that the Model is still offered (ADR-0018, including its tools requirement) and stops with `model_unavailable` if not.

## Considered options

- **`@temporalio/vercel-ai-sdk` (Temporal's plugin, AI SDK loop in the workflow):** least loop code, and it supports `ai` v7.
  - The full message array lives in workflow memory and is sent as every model Activity's input. The history then grows with steps × transcript size and carries student content against ADR-0004's opaque IDs.
  - nunio's `meter` can't wrap the plugin's model Activity with the Run's principal.
  - Its model-Activity retry and timeout policy is undocumented.
  - Rejected for now, but worth revisiting if it gains per-call hooks.
- **`ToolLoopAgent` inside one Activity for the whole work phase:** simplest code. But a crash repeats every paid step, the Activity must stay up through the whole loop, and the gate hand-off still needs the loop to stop at each Action. Per-step Activities cost a few more history events and nothing else.
- **`WorkflowAgent` (`@ai-sdk/workflow`):** durable, but on Vercel's Workflow runtime, which ADR-0004 rejected.
- **The model waits for each Approval and continues afterwards:** it could replan after a denial. But each Approval in a chain adds up to 7 days, the Run's lifetime has no bound, and a denial is picked up by the next Run anyway.
- **Run ends after the work phase; the API performs an approved Action** (as Chat does since ADR-0019's stage 4): no week-long workflows and no overlap problem. But it contradicts ADR-0006 ("Approval waits live inside the Run's workflow") and would need an ADR change. It is the fallback if `SKIP` blocking proves painful.

## Open questions for later tickets

- **#142 (prompt injection):**
  - The Agent's instructions are student text: instructions to the model, but never authority (ADR-0010). Read-tool results, especially Source text, must stay fenced data.
  - Decide whether reading a Source and then taking a granted Action in the same Run needs extra friction.
  - Decide whether an Agent may start Artifact Runs, which spend Allowance without an Action (Chat limits them to one per turn).
  - The Action caps per Run and per step above are a first bound; #142 should set them with an injection eval.
- **#149 (Activity):**
  - The step row proposed here, and its sealing under Sources, is what "Verlauf" would render.
  - `usage_reservation` has `responsibilityId` but **no `runId`**, so cost per Run needs that column.
  - Map list statuses to phases: "Läuft grade" is the work phase; "Freigabe benötigt" is the settle phase.
  - Decide what a Run stopped by Pause, Budget, `unconfirmed` or `model_unavailable` shows.
  - Decide whether a pending Approval raises an Intervention. Today only expiry does.
- **Spec (#151):**
  - Decide what "Jetzt starten" does while a Run waits for an Approval (refuse it, or start one after the settle phase).
  - The schema has no monthly reset for the Budget: `budgetMicroUsd`/`usedMicroUsd` have no period.
  - `maxSteps` and the Action caps need evaluation numbers.
- **#144 (approval modes):** the loop is indifferent to the mode, because the gate's `Decision` (Grant, `alwaysAsk` restriction, or Approval) decides it. A mode that changes mid-Run takes effect at the next Action.

## Confidence and gaps

- **High:** the AI SDK and Temporal API facts. They were checked against the installed packages' type definitions and bundled docs, and against Temporal's documentation pages.
- **Checked by reading code, not by running it:** the reuse of `meter`, the gate, `approvalDecidedSignal` and the Pause semantics. Nothing was prototyped.
- **Not verified:**
  - that `@openrouter/ai-sdk-provider` returns unexecuted tool calls with `finishReason: "tool-calls"` on every catalog Model (Chat relies on the same path, so it likely works);
  - the history size of a 12-step Run with parallel waits;
  - good values for the step and Action caps.
