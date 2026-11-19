-- A free-text Agent's Run waits for no decision: the API applies its decided Approvals through the gate (ADR-0006), so
-- only a preset's Run, which records no status, has a wake to deliver.
CREATE OR REPLACE FUNCTION "pending_approval_decisions"() RETURNS TABLE ("actionId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a."actionId", a."studentId"
    FROM "approval" a
    JOIN "action" action ON action."id" = a."actionId"
    JOIN "run" r ON r."id" = action."runId"
    WHERE a."decision" IS NOT NULL AND r."workflowId" IS NOT NULL AND r."status" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "action_event" e
        WHERE e."actionId" = a."actionId" AND e."type" = 'decision_notified'
      )
    ORDER BY a."decidedAt", a."actionId"
  $$;
