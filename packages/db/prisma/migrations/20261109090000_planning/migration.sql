CREATE TYPE "plan_actor" AS ENUM ('nunio', 'student');

CREATE TABLE "task" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "obligationId" TEXT,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 500),
  "estimateMinutes" INTEGER CHECK ("estimateMinutes" > 0),
  "estimatedBy" "plan_actor",
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("estimateMinutes" IS NULL) = ("estimatedBy" IS NULL))
);
CREATE UNIQUE INDEX "task_id_studentId_key" ON "task"("id", "studentId");
CREATE INDEX "task_studentId_idx" ON "task"("studentId");

CREATE TABLE "obligation_estimate" (
  "obligationId" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL CHECK ("minutes" > 0),
  "estimatedBy" "plan_actor" NOT NULL,
  "rationale" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "obligation_estimate_obligationId_studentId_key" ON "obligation_estimate"("obligationId", "studentId");
CREATE INDEX "obligation_estimate_studentId_idx" ON "obligation_estimate"("studentId");

CREATE TABLE "study_block" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "obligationId" TEXT,
  "taskId" TEXT,
  "start" TIMESTAMP(3) NOT NULL,
  "end" TIMESTAMP(3) NOT NULL,
  "placedBy" "plan_actor" NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("taskId", "studentId") REFERENCES "task"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("obligationId" IS NULL) <> ("taskId" IS NULL)),
  CHECK ("end" > "start")
);
CREATE INDEX "study_block_studentId_start_idx" ON "study_block"("studentId", "start");

CREATE TABLE "protected_time" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "weekday" INTEGER NOT NULL CHECK ("weekday" BETWEEN 1 AND 7),
  "fromMinute" INTEGER NOT NULL CHECK ("fromMinute" BETWEEN 0 AND 1440),
  "toMinute" INTEGER NOT NULL CHECK ("toMinute" BETWEEN 0 AND 1440),
  CHECK ("toMinute" > "fromMinute")
);
CREATE INDEX "protected_time_studentId_idx" ON "protected_time"("studentId");

CREATE TABLE "plan_preference" (
  "studentId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "timeZone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
  "studyFromMinute" INTEGER NOT NULL DEFAULT 540 CHECK ("studyFromMinute" BETWEEN 0 AND 1440),
  "studyToMinute" INTEGER NOT NULL DEFAULT 1080 CHECK ("studyToMinute" BETWEEN 0 AND 1440),
  "maxMinutesPerDay" INTEGER NOT NULL DEFAULT 240 CHECK ("maxMinutesPerDay" BETWEEN 30 AND 1440),
  CHECK ("studyToMinute" > "studyFromMinute")
);

CREATE TABLE "course_priority" (
  "courseId" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL CHECK ("rank" > 0),
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "course_priority_courseId_studentId_key" ON "course_priority"("courseId", "studentId");
CREATE INDEX "course_priority_studentId_idx" ON "course_priority"("studentId");

CREATE TABLE "calendar_import" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 255),
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "calendar_import_id_studentId_key" ON "calendar_import"("id", "studentId");
CREATE INDEX "calendar_import_studentId_idx" ON "calendar_import"("studentId");

CREATE TABLE "fixed_event" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "importId" TEXT,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 500),
  "start" TIMESTAMP(3) NOT NULL,
  "end" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("importId", "studentId") REFERENCES "calendar_import"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK ("end" > "start")
);
CREATE INDEX "fixed_event_studentId_start_idx" ON "fixed_event"("studentId", "start");

GRANT SELECT, INSERT, UPDATE, DELETE ON "task", "obligation_estimate", "study_block", "protected_time", "plan_preference", "course_priority", "calendar_import", "fixed_event" TO nunio_runtime;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['task', 'obligation_estimate', 'study_block', 'protected_time', 'plan_preference', 'course_priority', 'calendar_import', 'fixed_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "owner" ON %I USING ("studentId" = current_setting(''app.owner_id'', true))', t);
  END LOOP;
END $$;
