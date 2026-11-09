-- AlterTable
ALTER TABLE "intervention" ADD COLUMN     "causeEndedAt" TIMESTAMP(3);

-- One open Intervention per cause; a cause that ended and returns raises a new one.
DROP INDEX "intervention_studentId_dedupeKey_key";
CREATE UNIQUE INDEX "intervention_studentId_dedupeKey_key" ON "intervention"("studentId", "dedupeKey") WHERE "causeEndedAt" IS NULL;

GRANT UPDATE ("causeEndedAt") ON "intervention" TO nunio_runtime;

-- Outreach works through every active student, then handles each under its owner.
CREATE FUNCTION "outreach_students"() RETURNS TABLE ("studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT "studentId" FROM "pilot_entitlement" WHERE "revokedAt" IS NULL $$;
REVOKE ALL ON FUNCTION "outreach_students"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "outreach_students"() TO nunio_runtime;
