-- The Agents cutover's contract step (#192): drops what only the preset path read, now that no code reads it. A preset
-- the old API created after the conversion ran, before it was replaced, is Ended first, so none is left half-converted.
-- Briefing settings went with nunio's own Briefing (#189), and decision wakes with the preset Runs that waited on them.
UPDATE "agent"
SET "state" = 'ended', "pausedBy" = NULL, "endedAt" = COALESCE("endedAt", (now() AT TIME ZONE 'UTC'))
WHERE "preset" IS NOT NULL;
DELETE FROM "grant" g USING "agent" a WHERE g."agentId" = a."id" AND a."preset" IS NOT NULL;

ALTER TABLE "agent" DROP COLUMN "preset",
  DROP COLUMN "courseId",
  DROP COLUMN "obligationId",
  DROP COLUMN "restrictions";
ALTER TABLE "grant" DROP COLUMN "courseId",
  DROP COLUMN "obligationId";
ALTER TABLE "outreach_settings" DROP COLUMN "briefingAtMinute",
  DROP COLUMN "lastBriefingOn",
  DROP COLUMN "briefingEmail";

DROP FUNCTION "pending_approval_decisions"();
