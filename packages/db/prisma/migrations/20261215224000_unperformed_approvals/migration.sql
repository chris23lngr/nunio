-- reconcile finds approved Actions nobody went on to perform, as when the API died between decide and perform (#224),
-- across students like stale_attempts, then hands each to the gate under its owner, which performs or refuses it.
CREATE FUNCTION "unperformed_approvals"(decided_before TIMESTAMP(3)) RETURNS TABLE ("actionId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT a."actionId", a."studentId"
    FROM "approval" a
    JOIN "action" action ON action."id" = a."actionId"
    WHERE a."decision" = 'approved' AND a."decidedAt" < decided_before AND action."status" = 'awaiting_approval'
    ORDER BY a."decidedAt", a."actionId"
  $$;
REVOKE ALL ON FUNCTION "unperformed_approvals"(TIMESTAMP(3)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "unperformed_approvals"(TIMESTAMP(3)) TO nunio_runtime;
