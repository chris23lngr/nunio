-- An Agent's Courses follow changes to them (#184, decision #145): a merged Course's entry moves to the Course it went
-- into, a Rejected Course's entry goes, and an active free-text Agent left with no Course to act for is Paused, with
-- reason course_archived when all its Courses are Archived and no_course when it has none, its open Approvals
-- withdrawn as Pausing does. The worker's start pauses its Schedule. Safe to repeat.
INSERT INTO "agent_course" ("agentId", "courseId", "studentId")
SELECT ac."agentId", c."mergedIntoId", ac."studentId"
FROM "agent_course" ac
JOIN "course" c ON c."id" = ac."courseId"
WHERE c."status" = 'merged' AND c."mergedIntoId" IS NOT NULL
ON CONFLICT DO NOTHING;

DELETE FROM "agent_course" ac
USING "course" c
WHERE c."id" = ac."courseId" AND c."status" IN ('merged', 'rejected');

WITH paused AS (
  UPDATE "agent" a
  SET "state" = 'paused',
      "pausedBy" = CASE
        WHEN EXISTS (
          SELECT 1 FROM "agent_course" ac JOIN "course" c ON c."id" = ac."courseId"
          WHERE ac."agentId" = a."id" AND c."status" = 'accepted'
        ) THEN 'course_archived'
        ELSE 'no_course'
      END
  WHERE a."preset" IS NULL
    AND a."state" = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM "agent_course" ac JOIN "course" c ON c."id" = ac."courseId"
      WHERE ac."agentId" = a."id" AND c."status" = 'accepted' AND c."archivedAt" IS NULL
    )
  RETURNING a."id"
),
withdrawn AS (
  UPDATE "action" x
  SET "status" = 'refused', "refusal" = 'approval_withdrawn'
  FROM "run" r, "approval" ap, paused
  WHERE r."id" = x."runId"
    AND r."agentId" = paused."id"
    AND r."status" IS NOT NULL
    AND ap."actionId" = x."id"
    AND ap."decision" IS NULL
    AND ap."expiresAt" > (now() AT TIME ZONE 'UTC')
    AND x."status" = 'awaiting_approval'
  RETURNING x."id", x."studentId"
)
INSERT INTO "action_event" ("id", "studentId", "actionId", "at", "type", "detail")
SELECT gen_random_uuid()::text, w."studentId", w."id", (now() AT TIME ZONE 'UTC'), 'refused',
  '{"reason":"approval_withdrawn"}'::jsonb
FROM withdrawn w;
