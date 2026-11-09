-- A committed decision without a delivery acknowledgement is a durable pending wake.
-- Discovery spans students, like stale_attempts; delivery and acknowledgement run under the owner.
CREATE FUNCTION "pending_approval_decisions"() RETURNS TABLE ("actionId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a."actionId", a."studentId"
    FROM "approval" a
    JOIN "action" action ON action."id" = a."actionId"
    JOIN "run" r ON r."id" = action."runId"
    WHERE a."decision" IS NOT NULL AND r."workflowId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "action_event" e
        WHERE e."actionId" = a."actionId" AND e."type" = 'decision_notified'
      )
    ORDER BY a."decidedAt", a."actionId"
  $$;
REVOKE ALL ON FUNCTION "pending_approval_decisions"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "pending_approval_decisions"() TO nunio_runtime;
