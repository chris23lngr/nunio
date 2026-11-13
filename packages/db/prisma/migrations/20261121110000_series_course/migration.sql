-- An Event Series' Course (ADR-0021): proposed by nunio or chosen by the student, and only confirmed one makes its
-- events Course Events. Rejected means it belongs to no Course, so nunio proposes none again. Deleting the Course
-- leaves the series undecided.
ALTER TABLE "event_series" ADD COLUMN "courseId" TEXT REFERENCES "course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "event_series" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "event_series" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_rejected_without_course"
  CHECK ("rejectedAt" IS NULL OR ("courseId" IS NULL AND "confirmedAt" IS NULL));

-- One event the student took out of its series' Course, such as a lecture slot used for an excursion.
ALTER TABLE "fixed_event" ADD COLUMN "detachedAt" TIMESTAMP(3);
