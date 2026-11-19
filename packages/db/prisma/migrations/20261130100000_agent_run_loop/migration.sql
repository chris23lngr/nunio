-- A free-text Agent's Run records its status, trigger, end, stop reason and summary, and the configuration it started
-- with. Runs recorded before (presets', Chats' and Artifacts') keep null: they record none of it.
CREATE TYPE "run_status" AS ENUM ('running', 'done', 'stopped', 'failed');
CREATE TYPE "run_trigger" AS ENUM ('schedule', 'manual');

ALTER TABLE "run"
  ADD COLUMN "status" "run_status",
  ADD COLUMN "trigger" "run_trigger",
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "stopReason" TEXT,
  ADD COLUMN "instructions" TEXT,
  ADD COLUMN "capabilities" JSONB,
  ADD COLUMN "modelKey" TEXT,
  ADD COLUMN "summaryContent" BYTEA,
  ADD COLUMN "summaryKey" BYTEA,
  ADD COLUMN "derivedFrom" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- At most one of an Agent's Runs is running at a time; the check reads this.
CREATE INDEX "run_agentId_status_idx" ON "run"("agentId", "status");

-- Cost per Run: settled usage plus any in-flight reservation of the Run's metered calls.
ALTER TABLE "usage_reservation" ADD COLUMN "runId" TEXT;
CREATE INDEX "usage_reservation_runId_idx" ON "usage_reservation"("runId");
GRANT INSERT ("runId") ON "usage_reservation" TO nunio_runtime;

-- One model step of a Run, claimed before its model call so a retried attempt never calls the model again. Its display
-- parts and the transcript later steps are given are sealed under the Sources it read so far; the transcript is
-- dropped when the Run ends. A claim without parts is a step that never finished.
CREATE TABLE "run_step" (
  "runId" TEXT NOT NULL,
  "n" INTEGER NOT NULL,
  "studentId" TEXT NOT NULL,
  "answered" BOOLEAN NOT NULL DEFAULT false,
  "partsContent" BYTEA,
  "partsKey" BYTEA,
  "transcriptContent" BYTEA,
  "transcriptKey" BYTEA,
  "derivedFrom" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("runId", "n"),
  FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- DELETE releases a claim whose model call certainly did not complete.
GRANT SELECT, INSERT, UPDATE, DELETE ON "run_step" TO nunio_runtime;
ALTER TABLE "run_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_step" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run_step" USING ("studentId" = current_setting('app.owner_id', true));
