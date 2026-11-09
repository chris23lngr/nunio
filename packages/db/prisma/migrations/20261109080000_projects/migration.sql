CREATE TABLE "project" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 255),
  "obligationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Only the Obligation is cleared when it disappears; the student's Project stays.
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE SET NULL ("obligationId") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_id_studentId_key" ON "project"("id", "studentId");
CREATE INDEX "project_studentId_idx" ON "project"("studentId");

CREATE TABLE "project_course" (
  "projectId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("projectId", "courseId"),
  FOREIGN KEY ("projectId", "studentId") REFERENCES "project"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "project", "project_course" TO nunio_runtime;
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "project" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "project_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "project_course" USING ("studentId" = current_setting('app.owner_id', true));
