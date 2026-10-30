-- CreateTable
CREATE TABLE "allowance" (
    "studentId" TEXT NOT NULL,
    "limitMicroUsd" BIGINT NOT NULL DEFAULT 5000000,
    "usedMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "heldMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowance_pkey" PRIMARY KEY ("studentId")
);

-- AddForeignKey
ALTER TABLE "allowance" ADD CONSTRAINT "allowance_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Students entitled before metering existed start with the default Allowance.
INSERT INTO "allowance" ("studentId") SELECT "studentId" FROM "pilot_entitlement";

-- Student-owned. The runtime role creates rows with the default limit and moves usage,
-- but cannot raise the limit; only the founder's operator connection can.
GRANT SELECT, INSERT ("studentId"), UPDATE ("usedMicroUsd", "heldMicroUsd", "updatedAt")
  ON "allowance" TO nunio_runtime;
ALTER TABLE "allowance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allowance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "allowance"
  USING ("studentId" = current_setting('app.owner_id', true));
