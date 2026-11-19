-- Responsibility becomes Agent. Renames keep rows, grants and the owner policy as they are.
ALTER TYPE "responsibility_state" RENAME TO "agent_state";

ALTER TABLE "responsibility" RENAME TO "agent";
ALTER TABLE "agent" RENAME CONSTRAINT "responsibility_pkey" TO "agent_pkey";
ALTER TABLE "agent" RENAME CONSTRAINT "responsibility_studentId_fkey" TO "agent_studentId_fkey";
ALTER INDEX "responsibility_studentId_idx" RENAME TO "agent_studentId_idx";
ALTER INDEX "responsibility_id_studentId_key" RENAME TO "agent_id_studentId_key";

ALTER TABLE "grant" RENAME COLUMN "responsibilityId" TO "agentId";
ALTER TABLE "grant" RENAME CONSTRAINT "grant_responsibilityId_studentId_fkey" TO "grant_agentId_studentId_fkey";
ALTER INDEX "grant_responsibilityId_idx" RENAME TO "grant_agentId_idx";

ALTER TABLE "run" RENAME COLUMN "responsibilityId" TO "agentId";
ALTER TABLE "run" RENAME CONSTRAINT "run_responsibilityId_studentId_fkey" TO "run_agentId_studentId_fkey";

ALTER TABLE "usage_reservation" RENAME COLUMN "responsibilityId" TO "agentId";

-- A Briefing's items name what it bundled.
UPDATE "briefing"
SET "items" = ("items" - 'responsibilities') || jsonb_build_object('agents', "items" -> 'responsibilities')
WHERE "items" ? 'responsibilities';
