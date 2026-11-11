-- The Course a Source was bound to at upload or by "Kurs ändern"; null reads it automatically. Deleting the Course
-- unbinds the Source, which stays (ADR-0015).
ALTER TABLE "source" ADD COLUMN "courseId" TEXT,
  ADD FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE SET NULL ("courseId") ON UPDATE CASCADE;
CREATE INDEX "source_courseId_idx" ON "source"("courseId");

-- Two Courses the student said are different, so Review never suggests merging them again; stored once, in id order.
CREATE TABLE "distinct_course_pair" (
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "otherId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("courseId", "otherId"),
  CHECK ("courseId" < "otherId"),
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("otherId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "distinct_course_pair_studentId_idx" ON "distinct_course_pair"("studentId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "distinct_course_pair" TO nunio_runtime;
ALTER TABLE "distinct_course_pair" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distinct_course_pair" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "distinct_course_pair" USING ("studentId" = current_setting('app.owner_id', true));
