-- CreateTable
CREATE TABLE "deletion_request" (
    "studentId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_request_pkey" PRIMARY KEY ("studentId")
);

-- AddForeignKey
ALTER TABLE "deletion_request" ADD CONSTRAINT "deletion_request_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned: visible only under the owner context set by withOwner.
GRANT SELECT, INSERT ON "deletion_request" TO nunio_runtime;
ALTER TABLE "deletion_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deletion_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "deletion_request"
  USING ("studentId" = current_setting('app.owner_id', true));
