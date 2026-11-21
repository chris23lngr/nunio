-- Briefings from Agents (#146, #188): Agents with Briefing erstellen write at most one Briefing per Run, with plain
-- text sealed under the Sources the Run read and the ids of the Inbox items it bundles. Today's unique-per-day
-- constraint goes so multiple Briefings on a day are possible, while past nunio Briefings stay readable (agentId,
-- runId and textContent stay NULL). Existing rows are kept untouched.
DROP INDEX "briefing_studentId_localDate_key";

ALTER TABLE "briefing"
  ALTER COLUMN "localDate" DROP NOT NULL,
  ADD COLUMN "agentId" TEXT,
  ADD COLUMN "runId" TEXT,
  ADD COLUMN "textContent" BYTEA,
  ADD COLUMN "textKey" BYTEA,
  ADD COLUMN "derivedFrom" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "briefing"
  ADD CONSTRAINT "briefing_agentId_studentId_fkey"
    FOREIGN KEY ("agentId", "studentId") REFERENCES "agent"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "briefing_runId_studentId_fkey"
    FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "briefing_runId_studentId_key" ON "briefing"("runId", "studentId");
CREATE INDEX "briefing_studentId_createdAt_idx" ON "briefing"("studentId", "createdAt");
