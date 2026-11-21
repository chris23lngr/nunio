-- Templates (#147, #190): record which curated Template a free-text Agent was copied from, so "Von N Anderen genutzt"
-- can count distinct other students with an Agent saved from it (Ended included, deleted gone). Existing rows stay null.
ALTER TABLE "agent" ADD COLUMN "templateId" TEXT;
CREATE INDEX "agent_templateId_idx" ON "agent"("templateId");

-- Cross-tenant aggregate for "Von N Anderen genutzt": returns only distinct other-student counts per Template, never
-- student IDs or Agent rows. Reads app.owner_id from the transaction (set by withOwner) and fails closed if unset.
CREATE FUNCTION "template_other_users"() RETURNS TABLE ("templateId" TEXT, "othersCount" INTEGER)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT "templateId", COUNT(DISTINCT "studentId")::INTEGER AS "othersCount"
    FROM "agent"
    WHERE "templateId" IS NOT NULL
      AND "studentId" <> NULLIF(current_setting('app.owner_id', true), '')
    GROUP BY "templateId"
  $$;
REVOKE ALL ON FUNCTION "template_other_users"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "template_other_users"() TO nunio_runtime;
