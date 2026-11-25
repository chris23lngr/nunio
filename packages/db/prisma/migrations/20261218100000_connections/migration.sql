-- Connections (#261, #287): a student's Connection to an Integration, and its credentials in a separate row.
CREATE TABLE "connection" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'connected',
    "stateCause" TEXT,
    "stateSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountLabel" TEXT NOT NULL,
    "folders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "servers" JSONB,
    "keyVersion" TEXT NOT NULL,
    "keyCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "connection_pkey" PRIMARY KEY ("id"),
    -- A Connection that needs reconnection says why; a connected one has no cause.
    CONSTRAINT "connection_state_check" CHECK (
      ("state" = 'connected' AND "stateCause" IS NULL)
      OR ("state" = 'needs_reconnection' AND "stateCause" IS NOT NULL)
    )
);

CREATE TABLE "connection_credential" (
    "connectionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_credential_pkey" PRIMARY KEY ("connectionId")
);

-- One Connection per student and Integration: "my Email" always means one mailbox.
CREATE UNIQUE INDEX "connection_studentId_integrationKey_key" ON "connection"("studentId", "integrationKey");
CREATE UNIQUE INDEX "connection_id_studentId_key" ON "connection"("id", "studentId");
CREATE UNIQUE INDEX "connection_credential_connectionId_studentId_key" ON "connection_credential"("connectionId", "studentId");

ALTER TABLE "connection" ADD CONSTRAINT "connection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connection" ADD CONSTRAINT "connection_integrationKey_fkey" FOREIGN KEY ("integrationKey") REFERENCES "integration"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connection_credential" ADD CONSTRAINT "connection_credential_connectionId_studentId_fkey" FOREIGN KEY ("connectionId", "studentId") REFERENCES "connection"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. Connecting only inserts; reconnecting, setting folders and disconnecting come with later slices.
GRANT SELECT, INSERT ON "connection", "connection_credential" TO nunio_runtime;
ALTER TABLE "connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "connection" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "connection_credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connection_credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "connection_credential" USING ("studentId" = current_setting('app.owner_id', true));
