/**
 * Execution gate, usage metering, Agents, and Runs. See docs/design/delegation-gate.md.
 */

export {
  type AgentForm,
  type AgentScope,
  type Agents,
  createAgents,
  type PausedBy,
  type Preset,
  type Schedules,
} from "./agents.js";
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
  type CatalogModel,
  createModelCatalog,
  type ModelCatalog,
} from "./model-catalog.js";
export {
  type Principal,
  principal,
  type Transaction,
  withOwner,
} from "./principal.js";
