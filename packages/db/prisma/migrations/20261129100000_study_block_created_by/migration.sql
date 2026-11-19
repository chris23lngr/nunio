-- A Study Block records the Agent that created it, the marker of an Agent's own blocks (ADR-0001); the student moving
-- it clears the claim. Blocks Agents created before keep theirs unless the student has moved them since.
ALTER TABLE "study_block" ADD COLUMN "createdByAgentId" TEXT;

UPDATE "study_block" b
SET "createdByAgentId" = r."agentId"
FROM "plan_effect" e
JOIN "attempt" t ON t."idempotencyKey" = e."idempotencyKey"
JOIN "action" a ON a."id" = t."actionId"
JOIN "run" r ON r."id" = a."runId"
WHERE e."studyBlockId" = b."id"
  AND a."kind" = 'studyBlock.create'
  AND r."agentId" IS NOT NULL
  AND b."placedBy" = 'nunio';
