-- AlterTable
ALTER TABLE "outreach_settings" ADD COLUMN     "email" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "delivery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "interventionId" TEXT,
    "briefingId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "dropReason" TEXT,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_studentId_dueAt_idx" ON "delivery"("studentId", "dueAt");

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. A delivery is only ever settled: sent or dropped.
GRANT SELECT, INSERT, UPDATE ("sentAt", "droppedAt", "dropReason") ON "delivery" TO nunio_runtime;
ALTER TABLE "delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "delivery" USING ("studentId" = current_setting('app.owner_id', true));
