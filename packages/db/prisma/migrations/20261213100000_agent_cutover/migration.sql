-- The Agents cutover (#192, decision #160): each pilot preset becomes an Agent in the same row, keeping its Runs,
-- Actions and Approvals. It takes the Instructions, emoji and Beschreibung of the matching Template word for word (no
-- Template is recorded), with its Course or exam added to the name; its Course, or its exam's, as its one Course; only
-- the authority it already had, Lernblöcke erstellen and Eigene Lernblöcke verschieben on Automatisch with its
-- `restrictions` applied; 5 USD per month starting fresh; daily at 06:00; and the Chat default Model. It arrives Paused
-- (conversion) so only the student resumes it; an Ended one stays Ended, and one with no Course left converts as Ended.
-- Its Runs still under way stop and their pending Approvals expire; each old Run gets its status and a Verlauf of its
-- Actions, so its Activity reads like any other Run's. The worker's start retires the presets' Schedules and workflows.
-- The preset columns stay, emptied, until the contract migration drops them. Safe to repeat.

CREATE TEMP TABLE "agent_cutover" AS
SELECT
  a."id",
  a."studentId",
  a."preset",
  a."state",
  a."restrictions",
  -- Its Course, or its exam's, followed into the Course it was merged into; none once Rejected or gone.
  (
    SELECT CASE WHEN c."status" = 'merged' THEN m."id" ELSE c."id" END
    FROM "course" c
    LEFT JOIN "course" m ON m."id" = c."mergedIntoId" AND m."status" <> 'rejected'
    WHERE c."id" = a."courseId" AND c."status" <> 'rejected'
  ) AS "courseId",
  -- What the name adds: the exam, by the title the student gave it, else its Course; or the Course.
  COALESCE(
    (SELECT o."correctedTitle" FROM "obligation" o WHERE o."id" = a."obligationId"),
    (SELECT c."title" FROM "course" c WHERE c."id" = a."courseId")
  ) AS "scopeTitle"
FROM "agent" a
WHERE a."preset" IS NOT NULL;

UPDATE "agent" a
SET
  "name" = left(
    CASE WHEN x."preset" = 'prepare_for_exam' THEN 'Klausur vorbereiten' ELSE 'Kurs organisieren' END
      || COALESCE(' · ' || x."scopeTitle", ''),
    80
  ),
  "description" = CASE WHEN x."preset" = 'prepare_for_exam'
    THEN 'Plant deine Vorbereitung bis zum Prüfungstag.'
    ELSE 'Behält Termine, Themen und deinen Lernplan im Blick.' END,
  "emoji" = CASE WHEN x."preset" = 'prepare_for_exam' THEN '🎯' ELSE '📚' END,
  "instructions" = CASE WHEN x."preset" = 'prepare_for_exam'
    THEN E'Bereite mich auf die nächste Klausur in meinen Kursen vor.\n\nVerteile die Themen bis zum Prüfungstag auf realistische Lernblöcke. Priorisiere Themen, bei denen ich noch unsicher bin, und plane Wiederholungen ein.\n\nPrüfe bei jedem Start meinen Fortschritt und passe den Plan an. Lass meine selbst geplanten Lernblöcke unverändert.'
    ELSE E'Halte meine Kurse organisiert.\n\nAchte auf neue Termine, Abgaben und Themen. Lege Aufgaben für Abgaben und Termine an, die Vorbereitung brauchen, und plane genug Lernzeit vor ihren Fristen ein.\n\nWenn etwas nicht mehr in meine Woche passt, sag mir Bescheid.' END,
  "templateId" = NULL,
  "state" = CASE WHEN x."state" = 'ended' OR x."courseId" IS NULL THEN 'ended'::"agent_state" ELSE 'paused'::"agent_state" END,
  "pausedBy" = CASE WHEN x."state" = 'ended' OR x."courseId" IS NULL THEN NULL ELSE 'conversion' END,
  "endedAt" = CASE
    WHEN x."state" = 'ended' THEN a."endedAt"
    WHEN x."courseId" IS NULL THEN (now() AT TIME ZONE 'UTC')
    ELSE NULL END,
  "budgetMicroUsd" = 5000000,
  "usedMicroUsd" = 0,
  "budgetMonth" = to_char(
    now() AT TIME ZONE COALESCE(
      (SELECT p."timeZone" FROM "plan_preference" p WHERE p."studentId" = a."studentId"),
      'Europe/Berlin'
    ),
    'YYYY-MM'
  ),
  "triggerRhythm" = 'daily',
  "triggerWeekdays" = ARRAY[]::INTEGER[],
  "triggerMinute" = 360,
  "modelKey" = (SELECT "key" FROM "catalog_model" WHERE "chatDefault" LIMIT 1),
  "preset" = NULL,
  "courseId" = NULL,
  "obligationId" = NULL,
  "restrictions" = '{}'
FROM "agent_cutover" x
WHERE a."id" = x."id";

INSERT INTO "agent_course" ("agentId", "courseId", "studentId")
SELECT x."id", x."courseId", x."studentId"
FROM "agent_cutover" x
WHERE x."courseId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Only the authority it had: a kind missing from `allowedKinds` is off, and one in `alwaysAsk` asks (Nachfragen).
INSERT INTO "agent_capability" ("agentId", "capability", "studentId", "mode")
SELECT x."id", k."capability", x."studentId",
  CASE WHEN COALESCE(x."restrictions"->'alwaysAsk', '[]'::jsonb) @> to_jsonb(k."kind")
    THEN 'ask'::"approval_mode" ELSE 'automatic'::"approval_mode" END
FROM "agent_cutover" x
CROSS JOIN (VALUES ('studyBlock.create', 'createStudyBlocks'), ('studyBlock.move', 'moveOwnStudyBlocks'))
  AS k("kind", "capability")
WHERE NOT (x."restrictions" ? 'allowedKinds')
   OR (x."restrictions"->'allowedKinds') @> to_jsonb(k."kind")
ON CONFLICT DO NOTHING;

-- Its scoped Grants give way to one unscoped Grant per Capability on Automatisch; an Ended Agent holds none.
DELETE FROM "grant" g USING "agent_cutover" x WHERE g."agentId" = x."id";
INSERT INTO "grant" ("id", "studentId", "agentId", "kind")
SELECT gen_random_uuid()::text, a."studentId", a."id",
  CASE c."capability" WHEN 'createStudyBlocks' THEN 'studyBlock.create' ELSE 'studyBlock.move' END
FROM "agent_cutover" x
JOIN "agent" a ON a."id" = x."id" AND a."state" <> 'ended'
JOIN "agent_capability" c ON c."agentId" = a."id" AND c."mode" = 'automatic';

-- Its old Runs, which recorded no status. One with an Action still awaiting Approval was under way.
CREATE TEMP TABLE "agent_cutover_run" AS
SELECT r."id", r."studentId",
  EXISTS (SELECT 1 FROM "action" x WHERE x."runId" = r."id" AND x."status" = 'awaiting_approval') AS "underWay"
FROM "run" r
JOIN "agent_cutover" a ON a."id" = r."agentId"
WHERE r."status" IS NULL;

-- Each Action as its Verlauf entry, written before the pending ones expire: asked (its Approval then shows what became
-- of it), or what the gate made of it.
INSERT INTO "run_event" ("runId", "studentId", "key", "at", "type", "detail")
SELECT x."runId", x."studentId", 'action:1:' || split_part(x."key", ':', 2), x."createdAt", 'action',
  jsonb_build_object(
    'step', 1,
    'call', split_part(x."key", ':', 2)::int,
    'capability', CASE x."kind" WHEN 'studyBlock.create' THEN 'createStudyBlocks' ELSE 'moveOwnStudyBlocks' END,
    'actionId', x."id",
    'kind', x."kind",
    'workId', COALESCE(x."args"->>'workId', b."taskId", b."obligationId"),
    'start', x."args"->>'start',
    'end', x."args"->>'end',
    'outcome', CASE
      WHEN ap."id" IS NOT NULL THEN 'awaiting_approval'
      WHEN x."status" = 'dispatching' THEN 'unconfirmed'
      ELSE x."status"::text END,
    'refusal', CASE WHEN ap."id" IS NULL AND x."status" = 'refused' THEN x."refusal" END,
    'brokenPreferences', '[]'::jsonb
  )
FROM "action" x
JOIN "agent_cutover_run" r ON r."id" = x."runId"
LEFT JOIN "approval" ap ON ap."actionId" = x."id"
LEFT JOIN "study_block" b ON b."id" = x."args"->>'studyBlockId'
WHERE x."key" ~ ':[0-9]+$'
ORDER BY x."runId", split_part(x."key", ':', 2)::int
ON CONFLICT ("runId", "key") DO NOTHING;

UPDATE "run" r
SET
  "trigger" = 'schedule',
  "status" = CASE
    WHEN c."underWay" OR EXISTS (
      SELECT 1 FROM "action" x WHERE x."runId" = r."id"
        AND (x."status" = 'unconfirmed' OR (x."status" = 'refused' AND x."refusal" IN ('paused', 'ended')))
    ) THEN 'stopped'::"run_status"
    ELSE 'done'::"run_status" END,
  "stopReason" = CASE
    WHEN c."underWay" THEN 'conversion'
    WHEN EXISTS (SELECT 1 FROM "action" x WHERE x."runId" = r."id" AND x."status" = 'unconfirmed') THEN 'unconfirmed'
    ELSE (
      SELECT x."refusal" FROM "action" x
      WHERE x."runId" = r."id" AND x."status" = 'refused' AND x."refusal" IN ('paused', 'ended')
      LIMIT 1
    ) END,
  "endedAt" = CASE
    WHEN c."underWay" THEN (now() AT TIME ZONE 'UTC')
    ELSE GREATEST(r."startedAt", COALESCE(
      (SELECT max(e."at") FROM "action_event" e JOIN "action" x ON x."id" = e."actionId" WHERE x."runId" = r."id"),
      r."startedAt"
    )) END
FROM "agent_cutover_run" c
WHERE r."id" = c."id";

-- Pending Approvals expire, not denied: the student never decided.
UPDATE "approval" ap
SET "expiresAt" = LEAST(ap."expiresAt", (now() AT TIME ZONE 'UTC'))
FROM "action" x, "agent_cutover_run" r
WHERE ap."actionId" = x."id" AND x."runId" = r."id" AND x."status" = 'awaiting_approval' AND ap."decision" IS NULL;

WITH expired AS (
  UPDATE "action" x
  SET "status" = 'refused', "refusal" = 'approval_expired'
  FROM "agent_cutover_run" r
  WHERE x."runId" = r."id" AND x."status" = 'awaiting_approval'
  RETURNING x."id", x."studentId"
)
INSERT INTO "action_event" ("id", "studentId", "actionId", "at", "type", "detail")
SELECT gen_random_uuid()::text, e."studentId", e."id", (now() AT TIME ZONE 'UTC'), 'refused',
  '{"reason":"approval_expired"}'::jsonb
FROM expired e;

DROP TABLE "agent_cutover_run";
DROP TABLE "agent_cutover";

-- Every Agent is now free-text, and the contract migration drops "preset".
CREATE OR REPLACE FUNCTION "scheduled_agents"() RETURNS TABLE ("agentId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT "id", "studentId" FROM "agent" WHERE "state" <> 'ended' ORDER BY "createdAt", "id" $$;
