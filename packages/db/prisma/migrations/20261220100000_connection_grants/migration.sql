-- Grants held by a Connection (#289, ADR-0001 "Grants on a Connection's tools"): "Immer erlaubt" for one write tool,
-- in every Chat and Agent. A Grant is an Agent's (Agent and kind) or a Connection's (Connection and tool), never both.
ALTER TABLE "grant" ALTER COLUMN "agentId" DROP NOT NULL,
ALTER COLUMN "kind" DROP NOT NULL,
ADD COLUMN "connectionId" TEXT,
ADD COLUMN "toolName" TEXT,
ADD CONSTRAINT "grant_holder_check" CHECK (
  ("agentId" IS NOT NULL AND "kind" IS NOT NULL AND "connectionId" IS NULL AND "toolName" IS NULL)
  OR ("agentId" IS NULL AND "kind" IS NULL AND "connectionId" IS NOT NULL AND "toolName" IS NOT NULL)
);

-- One Grant per Connection and tool.
CREATE UNIQUE INDEX "grant_connectionId_toolName_key" ON "grant"("connectionId", "toolName");

ALTER TABLE "grant" ADD CONSTRAINT "grant_connectionId_studentId_fkey" FOREIGN KEY ("connectionId", "studentId") REFERENCES "connection"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The student changes Email's readable folders on the Connection's page, without signing in again.
GRANT UPDATE ("folders") ON "connection" TO nunio_runtime;
