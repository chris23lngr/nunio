/**
 * Execution gate, usage metering, Responsibilities, and Runs. See docs/design/delegation-gate.md.
 */

export type { Refusal, Restrictions } from "./decision.js";
export {
  type ActionOutcome,
  type ActionRecord,
  type Approve,
  type Clock,
  type DecisionNotifier,
  DelegationUnavailable,
  type Deny,
  type Executor,
  type Executors,
  type HistoryQuery,
  KeyConflictError,
  type Resolve,
  StaleApprovalError,
  UnknownActionError,
} from "./gate.js";
export {
  type ActionIntent,
  type GrantScope,
  InvalidIntentError,
  type Kind,
} from "./kinds.js";
export {
  type AllowanceState,
  accessRefusal,
  createDelegation,
  DefiniteFailure,
  type Delegation,
  type HeldReservation,
  type Metered,
  type Usage,
} from "./meter.js";
export {
  type Principal,
  principal,
  type Transaction,
  withOwner,
} from "./principal.js";
export {
  createResponsibilities,
  type Preset,
  type Responsibilities,
  type Schedules,
} from "./responsibilities.js";
