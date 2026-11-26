-- Connecting an OAuth Integration (#288): the flows students started, and the clients nunio registered through DCR.
CREATE TABLE "oauth_flow" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_flow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_client" (
    "integrationKey" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("integrationKey", "issuer")
);

CREATE INDEX "oauth_flow_studentId_idx" ON "oauth_flow"("studentId");

ALTER TABLE "oauth_flow" ADD CONSTRAINT "oauth_flow_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Signing out ends the session's unfinished flows.
ALTER TABLE "oauth_flow" ADD CONSTRAINT "oauth_flow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_flow" ADD CONSTRAINT "oauth_flow_integrationKey_fkey" FOREIGN KEY ("integrationKey") REFERENCES "integration"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_integrationKey_fkey" FOREIGN KEY ("integrationKey") REFERENCES "integration"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Student-owned: starting a flow inserts it, and the callback takes it once.
GRANT SELECT, INSERT, DELETE ON "oauth_flow" TO nunio_runtime;
ALTER TABLE "oauth_flow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_flow" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "oauth_flow" USING ("studentId" = current_setting('app.owner_id', true));
-- nunio's own, shared by every student connecting the Integration; a registration is never changed, only added.
GRANT SELECT, INSERT ON "oauth_client" TO nunio_runtime;
