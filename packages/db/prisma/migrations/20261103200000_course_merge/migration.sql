ALTER TYPE "course_status" ADD VALUE 'merged';
ALTER TABLE "course" ADD COLUMN "mergedIntoId" TEXT,
  ADD FOREIGN KEY ("mergedIntoId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;
