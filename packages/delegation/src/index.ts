/**
 * Execution gate, usage metering, Responsibilities, and Runs. See docs/design/delegation-gate.md.
 */
export { principal, withOwner, type Principal } from "./principal.js";
export { createDelegation, DefiniteFailure, type AllowanceState, type Delegation, type HeldReservation, type Metered, type Usage } from "./meter.js";
