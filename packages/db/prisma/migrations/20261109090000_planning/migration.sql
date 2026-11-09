CREATE TYPE "plan_actor" AS ENUM ('nunio', 'student');

CREATE TABLE "task" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "obligationId" TEXT,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 500),
  "estimateMinutes" INTEGER CHECK ("estimateMinutes" > 0),
  "estimatedBy" "plan_actor",
  "estimateRationale" TEXT,
  "maxMinutesPerDay" INTEGER CHECK ("maxMinutesPerDay" BETWEEN 30 AND 1440),
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
  "weekday" INTEGER CHECK ("weekday" BETWEEN 1 AND 7),
  "fromMinute" INTEGER CHECK ("fromMinute" BETWEEN 0 AND 1440),
  "toMinute" INTEGER CHECK ("toMinute" BETWEEN 0 AND 1440),
  "start" TIMESTAMP(3),
  "end" TIMESTAMP(3),
  -- Exactly one shape: a weekly span, or a one-off span.
  CHECK (("weekday" IS NOT NULL AND "fromMinute" IS NOT NULL AND "toMinute" IS NOT NULL AND "toMinute" > "fromMinute"
      AND "start" IS NULL AND "end" IS NULL)
    OR ("weekday" IS NULL AND "fromMinute" IS NULL AND "toMinute" IS NULL AND "start" IS NOT NULL AND "end" > "start"))
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

CREATE TABLE "course_preference" (
  "courseId" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "maxMinutesPerDay" INTEGER NOT NULL CHECK ("maxMinutesPerDay" BETWEEN 30 AND 1440),
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "course_preference_courseId_studentId_key" ON "course_preference"("courseId", "studentId");
CREATE INDEX "course_preference_studentId_idx" ON "course_preference"("studentId");

CREATE TABLE "priority" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "courseId" TEXT,
  "projectId" TEXT,
  "obligationId" TEXT,
  "rank" INTEGER NOT NULL CHECK ("rank" > 0),
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("projectId", "studentId") REFERENCES "project"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (num_nonnulls("courseId", "projectId", "obligationId") = 1)
);
CREATE INDEX "priority_studentId_idx" ON "priority"("studentId");

CREATE TABLE "calendar_source" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (length("name") BETWEEN 1 AND 255),
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "calendar_source_id_studentId_key" ON "calendar_source"("id", "studentId");
CREATE INDEX "calendar_source_studentId_idx" ON "calendar_source"("studentId");

CREATE TABLE "fixed_event" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "calendarId" TEXT,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 500),
  "start" TIMESTAMP(3) NOT NULL,
  "end" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("calendarId", "studentId") REFERENCES "calendar_source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK ("end" > "start")
);
CREATE INDEX "fixed_event_studentId_start_idx" ON "fixed_event"("studentId", "start");

GRANT SELECT, INSERT, UPDATE, DELETE ON "task", "obligation_estimate", "study_block", "protected_time", "plan_preference",
  "course_preference", "priority", "calendar_source", "fixed_event" TO nunio_runtime;
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "task" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "obligation_estimate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obligation_estimate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "obligation_estimate" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "study_block" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "study_block" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "study_block" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "protected_time" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "protected_time" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "protected_time" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "plan_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_preference" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "plan_preference" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "course_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_preference" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "course_preference" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "priority" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "priority" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "priority" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "calendar_source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_source" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "calendar_source" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "fixed_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixed_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "fixed_event" USING ("studentId" = current_setting('app.owner_id', true));
