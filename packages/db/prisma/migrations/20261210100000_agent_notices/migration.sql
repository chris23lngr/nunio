-- Notices (#155, #187): a message an Agent's Run writes the student, at most one per Run, kept in the Inbox and gone
-- with its Run, and so with its Agent. Its text is sealed under the Sources the Run had read, as the Run's summary is.
-- The runtime reads and adds them and may only mark one read. No existing rows change.
CREATE TABLE "notice" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "textContent" BYTEA NOT NULL,
  "textKey" BYTEA,
  "derivedFrom" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "notice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notice_agentId_studentId_fkey" FOREIGN KEY ("agentId", "studentId") REFERENCES "agent"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notice_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notice_runId_studentId_key" ON "notice"("runId", "studentId");
CREATE INDEX "notice_studentId_createdAt_idx" ON "notice"("studentId", "createdAt");

GRANT SELECT, INSERT, UPDATE ("readAt") ON "notice" TO nunio_runtime;
ALTER TABLE "notice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notice" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "notice" USING ("studentId" = current_setting('app.owner_id', true));

-- A Notice is announced like an Intervention: one Delivery per channel, held through Quiet Hours and within the daily
-- limit. Existing Deliveries announce no Notice.
ALTER TABLE "delivery" ADD COLUMN "noticeId" TEXT;
