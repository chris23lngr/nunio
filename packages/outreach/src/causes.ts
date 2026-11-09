import type { Shortfall } from "@nunio/planning";

/** What an Intervention is about. */
export type Subject =
  | { kind: "work"; id: string }
  | { kind: "obligation"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "action"; id: string };

export type Kind =
  | "shortfall"
  | "disagreement"
  | "approval_expired"
  | "unconfirmed";

/** One thing that holds now and deserves one Intervention while it lasts. */
export type Cause = { kind: Kind; key: string; actionId: string | null };

type Flagged = { id: string; disagreement: boolean };

/** The causes that hold now, read from the student's current state. */
export function causesOf({
  shortfalls,
  review,
  actions,
}: {
  shortfalls: readonly Shortfall[];
  review: {
    courses: readonly {
      obligations: readonly Flagged[];
      facts: readonly Flagged[];
    }[];
  };
  actions: readonly { id: string; status: string; refusal: string | null }[];
}): Cause[] {
  const disagreement = (on: "obligation" | "fact", { id }: Flagged): Cause => ({
    kind: "disagreement",
    key: `disagreement:${on}:${id}`,
    actionId: null,
  });
  return [
    ...shortfalls.map(
      (s): Cause => ({
        kind: "shortfall",
        key: `shortfall:${s.workId}`,
        actionId: null,
      }),
    ),
    ...review.courses.flatMap((c) => [
      ...c.obligations
        .filter((o) => o.disagreement)
        .map((o) => disagreement("obligation", o)),
      ...c.facts
        .filter((f) => f.disagreement)
        .map((f) => disagreement("fact", f)),
    ]),
    ...actions.flatMap((a): Cause[] => {
      if (a.status === "refused" && a.refusal === "approval_expired")
        return [
          {
            kind: "approval_expired",
            key: `approval_expired:${a.id}`,
            actionId: a.id,
          },
        ];
      if (a.status === "unconfirmed")
        return [
          { kind: "unconfirmed", key: `unconfirmed:${a.id}`, actionId: a.id },
        ];
      return [];
    }),
  ];
}

/**
 * Reads a cause key back into what it is about. Keys are `shortfall:<workId>`,
 * `disagreement:<fact|obligation>:<id>`, `approval_expired:<actionId>` and `unconfirmed:<actionId>`.
 */
export function subjectOf(key: string): Subject {
  const [kind, ...rest] = key.split(":");
  if (kind === "shortfall") return { kind: "work", id: rest[0]! };
  if (kind === "disagreement")
    return { kind: rest[0] as "fact" | "obligation", id: rest[1]! };
  return { kind: "action", id: rest[0]! };
}
