import type { paths } from "@nunio/api-client";

type Proposal =
  paths["/api/me/plan"]["get"]["responses"][200]["content"]["application/json"]["proposal"];
type Tradeoff = Proposal["shortfalls"][number]["tradeoffs"][number];

/** Plan wording shared by Home and the Plan, so both say the same thing. */
export const hours = (minutes: number) =>
  `${Math.round((minutes / 60) * 10) / 10} h`;
export const unplannedReasons: Record<
  Proposal["unplanned"][number]["reason"],
  string
> = {
  no_estimate: "needs an Estimate before it can be planned",
  no_deadline: "has no deadline, so it is not planned",
  past_due: "is past its deadline",
};
export const overlapReasons: Record<
  Proposal["overlaps"][number]["reason"],
  string
> = {
  locked: "is Locked, so nunio leaves it where it is",
  no_room: "has no free time left before its deadline to move to",
};
/** One tradeoff the student may choose; nunio never picks one silently. */
export function tradeoffText(tradeoff: Tradeoff) {
  if (tradeoff.kind === "exceed_daily_limit")
    return `Study beyond your daily limit (gains ${hours(tradeoff.gainedMinutes)}, needs your Approval)`;
  if (tradeoff.kind === "free_time_from")
    return `Use time planned for lower-priority work (${hours(tradeoff.gainedMinutes)})`;
  if (tradeoff.kind === "skip_routine")
    return `Skip preparing for and following up on a course's events until then (${hours(tradeoff.gainedMinutes)})`;
  return `Plan ${hours(tradeoff.byMinutes)} less for it`;
}
