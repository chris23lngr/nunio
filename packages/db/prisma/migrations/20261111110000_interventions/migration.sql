-- CreateTable
CREATE TABLE "intervention" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "actionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "intervention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intervention_studentId_createdAt_idx" ON "intervention"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "intervention_studentId_dedupeKey_key" ON "intervention"("studentId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "intervention" ADD CONSTRAINT "intervention_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Student-owned.
GRANT SELECT, INSERT, UPDATE ("acknowledgedAt", "dismissedAt") ON "intervention" TO nunio_runtime;
ALTER TABLE "intervention" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intervention" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "intervention" USING ("studentId" = current_setting('app.owner_id', true));
