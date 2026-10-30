-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('reserved', 'settled', 'released', 'held');

-- CreateTable
CREATE TABLE "usage_reservation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "estimateMicroUsd" BIGINT NOT NULL,
    "actualMicroUsd" BIGINT,
    "status" "reservation_status" NOT NULL DEFAULT 'reserved',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "settledBy" TEXT,

    CONSTRAINT "usage_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_reservation_studentId_status_idx" ON "usage_reservation"("studentId", "status");

-- AddForeignKey
ALTER TABLE "usage_reservation" ADD CONSTRAINT "usage_reservation_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "allowance"("studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. The runtime role records and settles its own calls; only an operator sets "settledBy".
GRANT SELECT, INSERT ("id", "studentId", "estimateMicroUsd"),
  UPDATE ("status", "actualMicroUsd", "settledAt") ON "usage_reservation" TO nunio_runtime;
ALTER TABLE "usage_reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_reservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "usage_reservation"
  USING ("studentId" = current_setting('app.owner_id', true));
