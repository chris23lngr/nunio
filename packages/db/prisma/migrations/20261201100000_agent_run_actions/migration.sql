-- A step's Action calls, as the gate performs them under `runId:step:call`, and the handles its tools gave out, which
-- the Run's later steps name work and blocks by. Only ids and times; steps stored before keep null: they called none.
ALTER TABLE "run_step"
  ADD COLUMN "calls" JSONB,
  ADD COLUMN "handles" JSONB;
