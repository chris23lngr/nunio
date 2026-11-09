/**
 * Execution gate, usage metering, Responsibilities, and Runs. See docs/design/delegation-gate.md.
 */
export { principal, withOwner, type Principal, type Transaction } from "./principal.js";
export { accessRefusal, createDelegation, DefiniteFailure, type AllowanceState, type Delegation, type HeldReservation, type Metered, type Usage } from "./meter.js";
export { DelegationUnavailable, KeyConflictError, StaleApprovalError, type ActionOutcome, type ActionRecord, type Approve, type Clock, type Deny, type Executor, type Executors, type HistoryQuery, type Resolve } from "./gate.js";
export { InvalidIntentError, type ActionIntent, type GrantScope, type Kind } from "./kinds.js";
export type { Refusal, Restrictions } from "./decision.js";
