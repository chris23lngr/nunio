-- The reconcile ends the Runs under way whose workflow is gone (#227), so Agents' lists stop reading "Läuft gerade": it
-- finds the Agents with a Run under way since before `started_before` across students, oldest first and at most
-- `max_agents`, then handles each under its owner.
CREATE FUNCTION "agents_with_stale_runs"(started_before TIMESTAMP(3), max_agents INTEGER)
  RETURNS TABLE ("agentId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT "agentId", "studentId" FROM "run"
    WHERE "status" = 'running' AND "agentId" IS NOT NULL AND "workflowId" IS NOT NULL AND "startedAt" < started_before
    GROUP BY "agentId", "studentId"
    ORDER BY min("startedAt"), "agentId"
    LIMIT max_agents
  $$;
REVOKE ALL ON FUNCTION "agents_with_stale_runs"(TIMESTAMP(3), INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "agents_with_stale_runs"(TIMESTAMP(3), INTEGER) TO nunio_runtime;
