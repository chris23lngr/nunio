# Delegation execution gate

Status: accepted design, 2026-10-29. `meter` is implemented (Phase 4) as `createDelegation({ db, aiEnabled })` with `allowance` and `held` reads; a call signals certain non-usage by throwing `DefiniteFailure`, and the founder settles held reservations with `settle-held` until `reconcile` exists. The rest is not yet implemented. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related decisions: ADR-0001, ADR-0004, ADR-0006, ADR-0010; invariants from [durable-ai.md](../research/durable-ai.md).

## Purpose

The `delegation` package is the single module through which every Action passes and every unit of AI usage is reserved. Both the Hono API (Chat-initiated Actions) and the worker (Temporal activities in Runs) call it, and so do tests, through the same interface. No app re-implements authority, rechecks, reservation, or dispatch. The design merges four alternatives produced under different constraints: smallest interface, most flexible, simplest common case, and ports and adapters.

## Interface

```ts
export function createDelegation(deps: {
  db: PrismaClient;          // local-substitutable; internal seam
  executors: Executors;      // true external; one port per capability
  clock: Clock;              // in-process; injected
}): Delegation;

export interface Delegation {
  perform(p: Principal, req: { key: string; intent: ActionIntent }): Promise<ActionOutcome>;
  decide(student: Principal, d: Approve | Deny | Resolve): Promise<ActionRecord>;
  meter<T>(p: Principal, estimate: Usage,
           call: (signal: AbortSignal) => Promise<{ value: T; usage: Usage }>): Promise<Metered<T>>;
  reconcile(): Promise<number>;
  history(student: Principal, q: HistoryQuery): Promise<ActionRecord[]>;
}

// Authority is never passed in. A Principal can only be minted server-side.
export type Principal = Brand<{ kind: "student"; studentId: string } | { kind: "run"; runId: string }, "Principal">;
export const principal: { fromSession(s: AuthSession): Principal; fromRun(runId: string): Principal };

// What a model or UI may supply: no actor, Grant, or Responsibility fields. Closed union.
export type ActionIntent =
  | { kind: "studyBlock.create"; calendarConnectionId: string; start: Date; end: Date; title: string; taskId?: string }
  | { kind: "studyBlock.move"; calendarConnectionId: string; studyBlockId: string; start: Date; end: Date }
  | { kind: "submission"; destinationId: string; obligationId: string; artifact: { id: string; version: number } };

export type ActionOutcome =
  | { status: "done"; actionId: string; effect: unknown }
  | { status: "awaiting_approval"; actionId: string; fingerprint: string; expiresAt: Date }
  | { status: "refused"; actionId: string; reason: Refusal }
  | { status: "failed"; actionId: string; detail: string }    // definite: the effect did not happen
  | { status: "unconfirmed"; actionId: string };              // ambiguous: only the student resolves it

type Refusal = "not_owner" | "paused" | "ended" | "disconnected" | "no_authority" | "approval_denied"
  | "approval_expired" | "approval_mismatch" | "budget_exhausted" | "allowance_exhausted"
  | "locked" | "protected_time" | "handoff_only" | "restricted";

type Approve = { kind: "approve"; actionId: string; fingerprint: string }; // the fingerprint the student was shown
type Deny    = { kind: "deny"; actionId: string };
type Resolve = { kind: "resolve"; actionId: string; resolution: "happened" | "did_not_happen" }; // Unconfirmed only
```

### Invariants

- **Idempotent on `key`.** The caller supplies a deterministic key: `runId:step` from a workflow, or `chatId:messageId:n` from the API. Repeating `perform` with the same key returns the recorded outcome or resumes it, and never dispatches twice. The same key with a different intent throws `KeyConflictError`. A changed Action needs a new key, and therefore a new Approval.
- **Authority** comes from one of two sources:
  - a Grant on the Run's Responsibility, provided the Responsibility is not Paused or Ended;
  - an Approval whose fingerprint equals the hash of kind@version, Destination, canonical arguments, and Artifact version plus a content hash re-read at dispatch.

  Chat-origin Runs have no Grants, so they always need an Approval (ADR-0001). An Approval is created only via `decide(approve)` with the fingerprint shown to the student (ADR-0010).
- **Approval expiry** is min(created + 7 days, the related Obligation's deadline), evaluated against `clock` on every call.
- **Rechecks happen at dispatch time** in the same transaction that reserves usage. The checks are ownership, Paused/Ended, a Disconnected Connection, Approval validity, Lock, Protected Time, a verified Destination (otherwise `handoff_only`), Restrictions, Budget, and Allowance. Nothing is trusted from an earlier call.
- **Restrictions can only tighten.** Advanced Agent configuration (allowed kinds, always-ask kinds, per-Action caps) is data on the Responsibility, compiled into Restrictions. A Restriction can turn "allowed by Grant" into "awaiting Approval" or "refused", and never the reverse.
- **Budget exhaustion** sets the Responsibility to Paused in the reserving transaction. The gate never draws further on the Allowance.
- **An Unconfirmed Action** is never dispatched again. Its reservation stays held until `decide(resolve)`.
- **`meter`** wraps every model call. It reserves the estimate against Budget and Allowance in one transaction, runs the call with an abort signal, then settles the actual usage. If the call's fate is unknown, the reservation stays held. Callers cannot reserve without settling.

### Ordering

`perform` → `awaiting_approval` → the student calls `decide(approve)`. The caller then calls `perform` again with the **same key**:

- **Run origin:** the API signals the workflow, which waits on the signal or on the `expiresAt` timer (ADR-0006).
- **Chat origin:** the API calls `perform` directly after `decide`.

`decide` never dispatches by itself.

After `refused` with `paused`, `ended`, or `disconnected`, the Run takes no further Action. After `unconfirmed`, the caller raises an Intervention and does not retry. Interventions are not Actions and are raised outside the gate.

### Error modes

Domain results are values, never exceptions, so Temporal does not retry them. A thrown error means one of two things:

- **An infrastructure fault** (`DelegationUnavailable`). It is safe to retry because of the key.
- **A programmer error** (`InvalidIntentError`, `KeyConflictError`, `StaleApprovalError` from `decide`). Do not retry.

## What the implementation hides

- Resolving a Principal to its owning student, Run, Responsibility, Grants, and Agent configuration.
- Per-kind definitions. These are an internal seam, each with an argument schema, `grantCovers`, a conservative usage estimate, the capability route, and the Obligation that caps Approval expiry.
- Canonical fingerprinting.
- A pure decision core, `decide(snapshot, now) → Decision | Refusal`, tested exhaustively without I/O.
- The dispatch protocol:
  1. An intent transaction locks the Responsibility, Allowance, and Action rows, decides, reserves, and writes an Attempt row (in flight, idempotency key derived from `actionId:attemptN`). That row is the outbox.
  2. The executor is called outside the transaction.
  3. A result transaction records done, failed, or Unconfirmed, and settles or holds the reservation.
- Recovery. `reconcile`, run on a Temporal Schedule, and any repeated `perform` find stale in-flight Attempts and ask the executor's `lookup(key)`. `found` means done. `absent`, when the provider honours keys, means a retry with the same key. Anything else means Unconfirmed. Nothing is retried blindly.
- An append-only history: proposals, authority used (the Grant or Approval ID), refusals, attempts, reserved and settled usage. It is written in the same transaction as each state change.

## Seams and adapters

| Dependency | Category | Seam | Adapters |
|---|---|---|---|
| Destination executors (calendar, Moodle submission) | True external | **Real**, one port per capability. `execute(req, { idempotencyKey, signal }) → done / rejected / ambiguous` and `lookup(key) → found / absent / unknown`. "Sent but no answer" must be classified as `ambiguous`. | Production provider adapters; a scriptable fake (ok, reject, ambiguous, succeed-then-crash) |
| Clock | In-process | Real, small | System clock; manual clock |
| Postgres via Prisma 7 | Local-substitutable | **Internal only**; no in-memory store | Real Postgres; Testcontainers in tests |
| Temporal | True external | **None.** Temporal drives the gate from worker activities; `delegation` never imports it | — |

Rejected as hypothetical seams: a `RunEngine` port, a policy-engine port, an ID generator, an event bus for history, and a notifier.

## Testing

All tests cross the interface:

- **Gate suite:** `createDelegation` with Testcontainers Postgres, fake executors, and a manual clock. Scenarios:
  - Pause between two `perform` calls gives `paused`.
  - A stale Artifact version gives `approval_mismatch`.
  - Advancing the clock 7 days gives `approval_expired`.
  - A Disconnect while awaiting Approval gives `disconnected`.
  - Concurrent `perform` and `meter` calls against one Allowance never overspend.
  - A crash after a remote success gives `unconfirmed`, exactly one dispatch, and a held reservation.
  - A Restriction never widens authority.
- **Per-kind contract suite**, run for every kind:
  - Junk arguments are rejected.
  - `grantCovers` is pure.
  - Every argument change alters the fingerprint.
  - The estimate is at least the measured usage.
- **Pure decision core:** table-driven, covering every combination of state.
- **Workflow tests** live in `apps/worker`, using Temporal's test environment with a real gate and fake executors, plus the replay tests from ADR-0004.

## Accepted limits

- An Action whose intent transaction committed just before a Pause still completes. The guarantee is "no next Action".
- At-most-once delivery is only as strong as each executor's idempotency and `lookup` support. Destinations without them, likely Moodle, will produce more Unconfirmed outcomes for the student to resolve.
- Deterministic keys are part of the interface, but the gate cannot enforce them. Workflow code review and replay tests must.
- Adding an Action kind changes this module, which is deliberate: only vetted functions can act.
