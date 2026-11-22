-- The operator command refuses to retire a Model an Agent that isn't Ended runs on, since its Runs would stop with
-- model_unavailable (#232). The operator login reads no Agents, so this returns only how many use the Model.
CREATE FUNCTION "model_agents"("modelKey" TEXT) RETURNS INTEGER
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT COUNT(*)::INTEGER FROM "agent" WHERE "modelKey" = $1 AND "state" <> 'ended' $$;
REVOKE ALL ON FUNCTION "model_agents"(TEXT) FROM PUBLIC;
