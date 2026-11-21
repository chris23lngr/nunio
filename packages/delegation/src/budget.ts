import type { Transaction } from "./principal.js";

/** The calendar month an instant falls in, in a time zone, as "YYYY-MM": the period an Agent's Budget counts usage for. */
function monthOf(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
}

/** The month it is at `at` in the Plan's time zone. */
export async function budgetMonth(tx: Transaction, at: Date) {
  const timeZone =
    (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";
  return monthOf(at, timeZone);
}

/** What an Agent has used of its Budget in `month`: nothing once a newer month began than the one it counted. */
export const usedIn = (
  r: { usedMicroUsd: bigint; budgetMonth: string | null },
  month: string,
) => (r.budgetMonth !== null && r.budgetMonth >= month ? r.usedMicroUsd : 0n);

/**
 * Starts the Agent's Budget over once a new month began at 00:00 on the 1st in the Plan's time zone: what it used is
 * cleared, and reservations it holds stay counted. Its state is left alone, so a Budget-Paused Agent stays Paused.
 * Call it before anything that counts against the Budget.
 */
export async function renewBudget(tx: Transaction, agentId: string, at: Date) {
  const month = await budgetMonth(tx, at);
  await tx.$executeRaw`
    UPDATE "agent" SET "usedMicroUsd" = 0, "budgetMonth" = ${month}
    WHERE "id" = ${agentId} AND ("budgetMonth" IS NULL OR "budgetMonth" < ${month})`;
}
