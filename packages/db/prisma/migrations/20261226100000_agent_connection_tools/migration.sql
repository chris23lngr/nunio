-- The tools of a Connection an Agent may use (#300): a row means "on", and every tool starts off. Ending the Agent
-- deletes its rows; Disconnect removes the Connection's rows with it.
CREATE TABLE "agent_connection_tool" (
  "agentId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("agentId", "connectionId", "toolName"),
  FOREIGN KEY ("agentId", "studentId") REFERENCES "agent"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("connectionId", "studentId") REFERENCES "connection"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "agent_connection_tool_connectionId_idx" ON "agent_connection_tool"("connectionId");

GRANT SELECT, INSERT, DELETE ON "agent_connection_tool" TO nunio_runtime;
ALTER TABLE "agent_connection_tool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_connection_tool" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "agent_connection_tool" USING ("studentId" = current_setting('app.owner_id', true));

-- A Run snapshots its Agent's Connection tools as it starts, beside its Instructions and Capabilities.
ALTER TABLE "run" ADD COLUMN "connectionTools" JSONB;
