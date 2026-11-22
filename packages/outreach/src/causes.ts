import type { Shortfall } from "@nunio/planning";

export const interventionKinds = [
  "shortfall",
  "disagreement",
  "approval_expired",
  "unconfirmed",
  "run_approvals",
] as const;
export type Kind = (typeof interventionKinds)[number];

/** One thing that holds now and deserves one Intervention while it lasts, with what it is about. */
export type Cause =
  | { kind: "shortfall"; subject: { kind: "work"; id: string } }
  | {
      kind: "disagreement";
      subject: { kind: "obligation" | "fact"; id: string };
    }
  | {
      kind: "approval_expired" | "unconfirmed";
      subject: { kind: "action"; id: string };
    }
  /** An Agent's Run that ended with Approvals still open (ADR-0006); one for all of them. */
  | { kind: "run_approvals"; subject: { kind: "run"; id: string } };

/** What an Intervention is about. */
export type Subject = Cause["subject"];

/**
 * The cause's key, stored as the Intervention's `dedupeKey`: `shortfall:<workId>`,
 * `disagreement:<fact|obligation>:<id>`, `approval_expired:<actionId>`, `unconfirmed:<actionId>` or
 * `run_approvals:<runId>`.
 * Phase 9 Runs wrote `approval_expired` and `unconfirmed` keys already, and Agent Runs write `run_approvals` keys, so
 * the format must not change.
 */
export function keyOf(cause: Cause): string {
  return cause.kind === "disagreement"
    ? `disagreement:${cause.subject.kind}:${cause.subject.id}`
    : `${cause.kind}:${cause.subject.id}`;
}

/** Reads a stored key back into its cause; the inverse of `keyOf`. */
export function causeOf(key: string): Cause {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  if (id)
    switch (kind) {
      case "shortfall":
        return { kind, subject: { kind: "work", id } };
      case "approval_expired":
      case "unconfirmed":
        return { kind, subject: { kind: "action", id } };
      case "run_approvals":
        return { kind, subject: { kind: "run", id } };
      case "disagreement": {
        const [on, ...of] = rest;
        const subjectId = of.join(":");
        if ((on === "obligation" || on === "fact") && subjectId)
          return { kind, subject: { kind: on, id: subjectId } };
      }
    }
  throw new Error(`Not a cause key: ${key}`);
}

type Flagged = { id: string; disagreement: boolean };

/**
 * The causes that hold now, read from the student's current state. Nothing about an Archived Course raises one. An
 * Agent Run that no longer waits for its Approvals raises one cause for all those it left open, never one per expired
 * Approval; a Chat's or a waiting Run's expired Approval still raises its own.
 */
export function causesOf({
  shortfalls,
  review,
  actions,
  pausedForCourses,
  runsAwaitingApproval = [],
}: {
  shortfalls: readonly Shortfall[];
  review: {
    courses: readonly {
      archived: boolean;
      obligations: readonly Flagged[];
      facts: readonly Flagged[];
    }[];
  };
  actions: readonly {
    id: string;
    status: string;
    refusal: string | null;
    agentId?: string | null;
    runId?: string | null;
  }[];
  /** Agents Paused with no Course to act for, all Archived or none left; their Actions raise nothing. */
  pausedForCourses: readonly string[];
  /** Agent Runs that ended with Approvals still open. */
  runsAwaitingApproval?: readonly string[];
}): Cause[] {
  const disagreement = (on: "obligation" | "fact", { id }: Flagged): Cause => ({
    kind: "disagreement",
    subject: { kind: on, id },
  });
  return [
    ...shortfalls.map(
      (s): Cause => ({
        kind: "shortfall",
        subject: { kind: "work", id: s.workId },
      }),
    ),
    ...review.courses
      .filter((c) => !c.archived)
      .flatMap((c) => [
        ...c.obligations
          .filter((o) => o.disagreement)
          .map((o) => disagreement("obligation", o)),
        ...c.facts
          .filter((f) => f.disagreement)
          .map((f) => disagreement("fact", f)),
      ]),
    ...actions
      .filter((a) => !a.agentId || !pausedForCourses.includes(a.agentId))
      .flatMap((a): Cause[] => {
        if (
          a.status === "refused" &&
          a.refusal === "approval_expired" &&
          !a.runId
        )
          return [
            { kind: "approval_expired", subject: { kind: "action", id: a.id } },
          ];
        if (a.status === "unconfirmed")
          return [
            { kind: "unconfirmed", subject: { kind: "action", id: a.id } },
          ];
        return [];
      }),
    ...runsAwaitingApproval.map(
      (id): Cause => ({ kind: "run_approvals", subject: { kind: "run", id } }),
    ),
  ];
}
