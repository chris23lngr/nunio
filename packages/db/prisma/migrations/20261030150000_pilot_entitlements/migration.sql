-- CreateTable
CREATE TABLE "pilot_entitlement" (
    "studentId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "pilot_entitlement_pkey" PRIMARY KEY ("studentId")
);

-- AddForeignKey
ALTER TABLE "pilot_entitlement" ADD CONSTRAINT "pilot_entitlement_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
