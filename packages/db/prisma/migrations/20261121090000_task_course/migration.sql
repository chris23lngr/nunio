-- A Task toward no Obligation may belong to a Course (ADR-0022); one toward an Obligation is in its Obligation's Course.
-- Deleting the Course deletes its Tasks, as it does its Obligations' Tasks.
ALTER TABLE "task" ADD COLUMN "courseId" TEXT;
ALTER TABLE "task" ADD CONSTRAINT "task_courseId_studentId_fkey"
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_obligation_or_course" CHECK ("obligationId" IS NULL OR "courseId" IS NULL);
