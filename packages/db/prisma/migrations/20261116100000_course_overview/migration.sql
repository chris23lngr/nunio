ALTER TABLE "course"
  ADD COLUMN "semester" TEXT,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "enteredAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Existing Courses take the Semester they were created in (Berlin time): October to March is a Wintersemester.
UPDATE "course" SET "semester" = CASE
  WHEN EXTRACT(MONTH FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin')) >= 10
    THEN EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin'))::int || '-ws'
  WHEN EXTRACT(MONTH FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin')) <= 3
    THEN (EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin'))::int - 1) || '-ws'
  ELSE EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Berlin'))::int || '-ss'
END;

-- A random color per Course, distinct within each student's Semester while the palette lasts: each Semester's
-- Courses take consecutive palette slots from a random starting point.
WITH "semester_start" AS (
  SELECT "studentId", "semester", floor(random() * 8)::int AS "offset"
  FROM "course" GROUP BY "studentId", "semester"
), "ranked" AS (
  SELECT "course"."id",
    row_number() OVER (PARTITION BY "course"."studentId", "course"."semester" ORDER BY random()) AS "rank",
    "semester_start"."offset"
  FROM "course"
  JOIN "semester_start" USING ("studentId", "semester")
)
UPDATE "course" SET "color" =
  (ARRAY['rose', 'orange', 'amber', 'emerald', 'teal', 'blue', 'violet', 'fuchsia'])[1 + (("ranked"."rank" - 1 + "ranked"."offset") % 8)]
FROM "ranked" WHERE "course"."id" = "ranked"."id";

-- An accepted Course no Source names was entered by the student.
UPDATE "course" SET "enteredAt" = "createdAt"
WHERE "status" = 'accepted'
  AND NOT EXISTS (SELECT 1 FROM "source_course" WHERE "source_course"."courseId" = "course"."id");

ALTER TABLE "course"
  ALTER COLUMN "semester" SET NOT NULL,
  ALTER COLUMN "color" SET NOT NULL;
