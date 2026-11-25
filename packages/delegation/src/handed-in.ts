/**
 * Whether an Obligation is handed in, so it is no work any more: the Plan stops planning it, the gate treats it as
 * closed, and a Course, the study page and a Chat's agenda count it as done. Today only Reported as Submitted.
 */
export const isHandedIn = (obligation: { reportedSubmittedAt: Date | null }) =>
  Boolean(obligation.reportedSubmittedAt);
