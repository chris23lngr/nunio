-- Routines (ADR-0021): per Event Series, how long to prepare for and follow up on each Course Event. Their Tasks
-- name the Course Event they are for; one that goes keeps its Task, without the event, if nunio did not remove it.
CREATE TYPE "task_role" AS ENUM ('preparation', 'follow_up');

CREATE TABLE "routine" (
  "seriesId" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "preparationMinutes" INTEGER NOT NULL CHECK ("preparationMinutes" BETWEEN 0 AND 1440),
  "followUpMinutes" INTEGER NOT NULL CHECK ("followUpMinutes" BETWEEN 0 AND 1440),
  "skippedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("seriesId", "studentId") REFERENCES "event_series"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "routine_seriesId_studentId_key" ON "routine"("seriesId", "studentId");
CREATE INDEX "routine_studentId_idx" ON "routine"("studentId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "routine" TO nunio_runtime;
ALTER TABLE "routine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "routine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "routine" USING ("studentId" = current_setting('app.owner_id', true));

-- The daily Routine tick needs to know whose Routines to apply, across tenants, as Outreach does.
CREATE FUNCTION "routine_students"() RETURNS TABLE ("studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT DISTINCT r."studentId" FROM "routine" r
        JOIN "pilot_entitlement" e ON e."studentId" = r."studentId" AND e."revokedAt" IS NULL $$;
REVOKE ALL ON FUNCTION "routine_students"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "routine_students"() TO nunio_runtime;

ALTER TABLE "task" ADD COLUMN "fixedEventId" TEXT REFERENCES "fixed_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task" ADD COLUMN "role" "task_role";
CREATE UNIQUE INDEX "task_fixedEventId_role_key" ON "task"("fixedEventId", "role");
