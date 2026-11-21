-- An Agent's trigger (#179): Täglich or chosen Wochentage at a minute of the day, in the Plan's time zone. Every
-- existing Agent ran daily at 06:00, so that is the default.
ALTER TABLE "agent" ADD COLUMN "triggerRhythm" TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE "agent" ADD COLUMN "triggerWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "agent" ADD COLUMN "triggerMinute" INTEGER NOT NULL DEFAULT 360;

-- The worker brings the Schedule of every free-text Agent not Ended in line with its trigger on start, then handles
-- each under its owner.
CREATE FUNCTION "scheduled_agents"() RETURNS TABLE ("agentId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT "id", "studentId" FROM "agent" WHERE "preset" IS NULL AND "state" <> 'ended' ORDER BY "createdAt", "id" $$;
REVOKE ALL ON FUNCTION "scheduled_agents"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "scheduled_agents"() TO nunio_runtime;
