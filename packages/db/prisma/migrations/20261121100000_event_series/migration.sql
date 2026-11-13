-- A Fixed Event read from a calendar keeps its identity there and belongs to an Event Series (ADR-0022), so adding the
-- calendar again updates it. Events read before this stay without either; a new reading cannot match them.
CREATE TABLE "event_series" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "calendarId" TEXT NOT NULL,
  "title" TEXT NOT NULL CHECK (length("title") BETWEEN 1 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("calendarId", "studentId") REFERENCES "calendar_source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "event_series_id_studentId_key" ON "event_series"("id", "studentId");
CREATE UNIQUE INDEX "event_series_calendarId_title_key" ON "event_series"("calendarId", "title");
CREATE INDEX "event_series_studentId_idx" ON "event_series"("studentId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "event_series" TO nunio_runtime;
ALTER TABLE "event_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_series" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "event_series" USING ("studentId" = current_setting('app.owner_id', true));

ALTER TABLE "fixed_event" ADD COLUMN "uid" TEXT;
ALTER TABLE "fixed_event" ADD COLUMN "recurrenceId" TIMESTAMP(3);
ALTER TABLE "fixed_event" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "fixed_event" ADD CONSTRAINT "fixed_event_seriesId_studentId_fkey"
  FOREIGN KEY ("seriesId", "studentId") REFERENCES "event_series"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "fixed_event_calendarId_uid_idx" ON "fixed_event"("calendarId", "uid");
