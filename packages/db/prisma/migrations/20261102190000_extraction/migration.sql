CREATE TYPE "extraction_status" AS ENUM ('pending', 'running', 'done', 'failed');
ALTER TABLE "source" ADD COLUMN "extraction" "extraction_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN "extractedAt" TIMESTAMP(3);

CREATE TYPE "course_status" AS ENUM ('proposed', 'accepted', 'rejected');
CREATE TABLE "course" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code" TEXT,
  "title" TEXT NOT NULL,
  "matchCode" TEXT,
  "matchTitle" TEXT NOT NULL,
  "status" "course_status" NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "course_id_studentId_key" ON "course"("id", "studentId");
CREATE INDEX "course_studentId_idx" ON "course"("studentId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "course" TO nunio_runtime;
ALTER TABLE "course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "course" USING ("studentId" = current_setting('app.owner_id', true));

CREATE TABLE "source_course" (
  "sourceId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("sourceId", "courseId"),
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "source_course_studentId_courseId_idx" ON "source_course"("studentId", "courseId");
GRANT SELECT, INSERT, DELETE ON "source_course" TO nunio_runtime;
ALTER TABLE "source_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "source_course" USING ("studentId" = current_setting('app.owner_id', true));

CREATE TYPE "review_state" AS ENUM ('unreviewed', 'confirmed', 'rejected');
CREATE TYPE "obligation_kind" AS ENUM ('exam', 'assignment', 'presentation', 'thesis', 'registration', 'other');
-- Structure is plain for planning and matching; wording is encrypted under the Source key (ciphertext).
CREATE TABLE "obligation" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "kind" "obligation_kind" NOT NULL,
  "dueDate" DATE,
  "dueTime" TEXT CHECK ("dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  "timeZone" TEXT,
  "page" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "state" "review_state" NOT NULL DEFAULT 'unreviewed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "obligation_studentId_courseId_idx" ON "obligation"("studentId", "courseId");
CREATE INDEX "obligation_sourceId_idx" ON "obligation"("sourceId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "obligation" TO nunio_runtime;
ALTER TABLE "obligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obligation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "obligation" USING ("studentId" = current_setting('app.owner_id', true));

CREATE TYPE "fact_type" AS ENUM ('topic', 'course_rule', 'exam_logistics');
CREATE TABLE "fact" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "type" "fact_type" NOT NULL,
  "matchKey" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "state" "review_state" NOT NULL DEFAULT 'unreviewed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "fact_studentId_courseId_idx" ON "fact"("studentId", "courseId");
CREATE INDEX "fact_sourceId_idx" ON "fact"("sourceId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "fact" TO nunio_runtime;
ALTER TABLE "fact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "fact" USING ("studentId" = current_setting('app.owner_id', true));
