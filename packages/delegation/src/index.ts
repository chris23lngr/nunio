/**
 * Execution gate, usage metering, Agents, and Runs. See docs/design/delegation-gate.md.
 */

export {
  type AgentForm,
  type Agents,
  type AgentTrigger,
  checkTrigger,
  createAgents,
  type PausedBy,
  type Schedules,
} from "./agents.js";
export {
  type AgentCapability,
  type ApprovalMode,
  approvalModes,
  type CapabilityId,
  capabilities,
  capabilityIds,
  capabilitySections,
  kindOf,
} from "./capabilities.js";
export {
  type BrokenPreference,
  maxOpenApprovals,
  type PlanRefusal,
  type PlanVerdict,
  type Refusal,
  type RunUse,
  runCaps,
} from "./decision.js";
export {
  type ActionArgs,
  type ActionOutcome,
  type ActionRecord,
  type Approve,
  type BlockIntent,
  type Clock,
  DelegationUnavailable,
  type Deny,
  type Executor,
  type ExecutorResult,
  type Executors,
  type HistoryQuery,
  KeyConflictError,
  openApprovalAt,
  type PlanRules,
  type Resolve,
  StaleApprovalError,
  UnknownActionError,
} from "./gate.js";
export { isHandedIn } from "./handed-in.js";
export {
  type ActionIntent,
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
export {
  type AgentTemplateDefinition,
  agentTemplates,
  type CoursePreselection,
  isTemplateId,
  type TemplateId,
  templateIds,
} from "./templates.js";
