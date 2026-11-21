-- An Agent's Run may start one Artifact Run (Karteikarten or Übungsaufgaben erstellen, #186), whose cost is charged to
-- it. The Artifact Run keeps its own row, without an Agent, so it never reads as a preset's Run; deleting the Agent and
-- its Runs leaves the Artifact Run and its Artifact, the student's study material, in place. Existing Runs keep null.
ALTER TABLE "run" ADD COLUMN "startedByRunId" TEXT;
CREATE INDEX "run_startedByRunId_idx" ON "run"("startedByRunId");
ALTER TABLE "run" ADD CONSTRAINT "run_startedByRunId_fkey" FOREIGN KEY ("startedByRunId") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The Citation tags a step's tools gave out, carried into later steps like its handles, so a Topic read in one step can
-- be named in the next. Only references, never content; steps stored before keep null.
ALTER TABLE "run_step" ADD COLUMN "citations" JSONB;
