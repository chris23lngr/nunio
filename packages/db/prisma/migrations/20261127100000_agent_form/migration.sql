-- Free-text Agents (expand step): the form's fields and a set of Courses sit beside the preset columns, which the
-- Agents cutover removes. Existing preset Agents keep their columns and get the defaults below.
ALTER TABLE "agent" ALTER COLUMN "preset" DROP NOT NULL;
ALTER TABLE "agent" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agent" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agent" ADD COLUMN "emoji" TEXT NOT NULL DEFAULT '🤖';
ALTER TABLE "agent" ADD COLUMN "instructions" TEXT NOT NULL DEFAULT '';

-- An Agent's Courses: its scope. Archived ones stay on the list; deleting a Course takes it off.
CREATE TABLE "agent_course" (
  "agentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("agentId", "courseId"),
  FOREIGN KEY ("agentId", "studentId") REFERENCES "agent"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_course_studentId_courseId_idx" ON "agent_course"("studentId", "courseId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_course" TO nunio_runtime;
ALTER TABLE "agent_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "agent_course" USING ("studentId" = current_setting('app.owner_id', true));
