-- Own Work (#306): files the student uploads to hand in for an Obligation, each under its own SSE-C key (ADR-0007).
CREATE TYPE "own_work_status" AS ENUM ('uploading', 'promoting', 'ready', 'failed');

CREATE TABLE "own_work_file" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "status" "own_work_status" NOT NULL DEFAULT 'uploading',
    "keyVersion" TEXT NOT NULL,
    "keyCiphertext" TEXT NOT NULL,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "own_work_file_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "own_work_file_id_studentId_key" ON "own_work_file"("id", "studentId");
CREATE INDEX "own_work_file_obligationId_idx" ON "own_work_file"("obligationId");

ALTER TABLE "own_work_file" ADD CONSTRAINT "own_work_file_obligationId_studentId_fkey" FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. Only the status changes after upload; deleting the row deletes the file's key.
GRANT SELECT, INSERT, DELETE ON "own_work_file" TO nunio_runtime;
GRANT UPDATE ("status") ON "own_work_file" TO nunio_runtime;
ALTER TABLE "own_work_file" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "own_work_file" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "own_work_file" USING ("studentId" = current_setting('app.owner_id', true));
