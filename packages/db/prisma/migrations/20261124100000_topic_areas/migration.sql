-- Topic Areas (ADR-0023): named groups of a Course's Topics, inferred by a grouping pass and never reviewed.
CREATE TABLE "topic_area" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "inferred" BOOLEAN NOT NULL,
  "renamedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "topic_area_id_studentId_key" ON "topic_area"("id", "studentId");
CREATE UNIQUE INDEX "topic_area_courseId_matchKey_key" ON "topic_area"("courseId", "matchKey");
CREATE INDEX "topic_area_studentId_courseId_idx" ON "topic_area"("studentId", "courseId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "topic_area" TO nunio_runtime;
ALTER TABLE "topic_area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "topic_area" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "topic_area" USING ("studentId" = current_setting('app.owner_id', true));

-- A Topic's Area and position in it; movedAt keeps the student's placement over later passes.
ALTER TABLE "fact" ADD COLUMN "topicAreaId" TEXT REFERENCES "topic_area"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fact" ADD COLUMN "topicAreaOrder" INTEGER;
ALTER TABLE "fact" ADD COLUMN "movedAt" TIMESTAMP(3);
CREATE INDEX "fact_topicAreaId_idx" ON "fact"("topicAreaId");
