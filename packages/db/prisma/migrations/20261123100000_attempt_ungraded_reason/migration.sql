-- Why an Attempt is ungraded, kept so the student still learns it when they return to the practice set.
ALTER TABLE "practice_attempt" ADD COLUMN "ungradedReason" TEXT;
GRANT UPDATE ("ungradedReason") ON "practice_attempt" TO nunio_runtime;
