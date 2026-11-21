-- An Agent's Budget is monthly (#183): it starts over at 00:00 on the 1st of each month in the Plan's time zone, and
-- "budgetMonth" is the month its used amount counts. What existing Agents used so far counts for the current month.
ALTER TABLE "agent" ADD COLUMN "budgetMonth" TEXT;

UPDATE "agent" SET "budgetMonth" = to_char(
  now() AT TIME ZONE COALESCE(
    (SELECT "timeZone" FROM "plan_preference" WHERE "plan_preference"."studentId" = "agent"."studentId"),
    'Europe/Berlin'
  ),
  'YYYY-MM'
);
