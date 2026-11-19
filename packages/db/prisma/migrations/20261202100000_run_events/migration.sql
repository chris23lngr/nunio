-- A Run's Verlauf (#149): what each step read and what became of each Action call, as structured events that live as
-- long as the Run, and so as long as its Agent. Append-only: the runtime may only read and add them. Runs recorded
-- before have none; their Verlauf shows only their start and end.
CREATE TABLE "run_event" (
  "id" BIGSERIAL NOT NULL,
  "runId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  CONSTRAINT "run_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "run_event_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "run_event_runId_key_key" ON "run_event"("runId", "key");

GRANT SELECT, INSERT ON "run_event" TO nunio_runtime;
GRANT USAGE ON SEQUENCE "run_event_id_seq" TO nunio_runtime;
ALTER TABLE "run_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run_event" USING ("studentId" = current_setting('app.owner_id', true));
