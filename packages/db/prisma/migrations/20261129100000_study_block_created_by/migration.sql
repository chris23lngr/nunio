-- A Study Block records the Agent that created it, the marker of an Agent's own blocks (ADR-0001), and the student
-- moving it clears the claim. A block an Agent created before keeps the claim only while it still sits exactly where
-- that Action placed it: applying a Rebalance or a move approved in a Chat leaves "placedBy" as nunio, so only the
-- time shows the student did not move it.
ALTER TABLE "study_block" ADD COLUMN "createdByAgentId" TEXT;

-- The Action's arguments hold its times as ISO strings in UTC; the block's are timestamps without a zone, in UTC.
UPDATE "study_block" b
SET "createdByAgentId" = r."agentId"
FROM "plan_effect" e
JOIN "attempt" t ON t."idempotencyKey" = e."idempotencyKey"
JOIN "action" a ON a."id" = t."actionId"
JOIN "run" r ON r."id" = a."runId"
WHERE e."studyBlockId" = b."id"
  AND a."kind" = 'studyBlock.create'
  AND r."agentId" IS NOT NULL
  AND b."placedBy" = 'nunio'
  AND b."start" = ((a."args"->>'start')::timestamptz AT TIME ZONE 'UTC')
  AND b."end" = ((a."args"->>'end')::timestamptz AT TIME ZONE 'UTC');
