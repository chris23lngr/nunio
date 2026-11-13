-- Task Actions (ADR-0021): a Chat may add or reopen a Task with the student's Approval, so the Plan executor records
-- either the block or the Task an Action took effect on.
ALTER TABLE "plan_effect" ALTER COLUMN "studyBlockId" DROP NOT NULL;
ALTER TABLE "plan_effect" ADD COLUMN "taskId" TEXT;
ALTER TABLE "plan_effect" ADD CONSTRAINT "plan_effect_block_or_task"
  CHECK (("studyBlockId" IS NULL) <> ("taskId" IS NULL));
