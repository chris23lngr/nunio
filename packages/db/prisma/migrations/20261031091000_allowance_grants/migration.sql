-- CreateTable
CREATE TABLE "allowance_grant" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountMicroUsd" BIGINT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowance_grant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "allowance_grant_studentId_idx" ON "allowance_grant"("studentId");

-- AddForeignKey
ALTER TABLE "allowance_grant" ADD CONSTRAINT "allowance_grant_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "allowance"("studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Written only by the founder's operator connection; the runtime role has no access.
ALTER TABLE "allowance_grant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allowance_grant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "allowance_grant"
  USING ("studentId" = current_setting('app.owner_id', true));
