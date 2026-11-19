-- A free-text Agent's Capabilities, each Action Capability with its approval mode. Its Grants follow the modes:
-- one, unscoped, for each Capability on always or automatic. Existing Agents have none; preset Agents keep their Grants.
CREATE TYPE "approval_mode" AS ENUM ('always', 'automatic', 'ask');

CREATE TABLE "agent_capability" (
  "agentId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "mode" "approval_mode",
  PRIMARY KEY ("agentId", "capability"),
  FOREIGN KEY ("agentId", "studentId") REFERENCES "agent"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_capability" TO nunio_runtime;
ALTER TABLE "agent_capability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_capability" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "agent_capability" USING ("studentId" = current_setting('app.owner_id', true));
