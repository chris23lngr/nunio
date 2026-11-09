-- CreateTable
CREATE TABLE "outreach_settings" (
    "studentId" TEXT NOT NULL,
    "briefingAtMinute" INTEGER DEFAULT 420,
    "lastBriefingOn" TEXT,

    CONSTRAINT "outreach_settings_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "briefing" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items" JSONB NOT NULL,

    CONSTRAINT "briefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "briefing_studentId_localDate_key" ON "briefing"("studentId", "localDate");

-- AddForeignKey
ALTER TABLE "outreach_settings" ADD CONSTRAINT "outreach_settings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. A Briefing is never edited once made.
GRANT SELECT, INSERT, UPDATE ON "outreach_settings" TO nunio_runtime;
ALTER TABLE "outreach_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "outreach_settings" USING ("studentId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT ON "briefing" TO nunio_runtime;
ALTER TABLE "briefing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "briefing" USING ("studentId" = current_setting('app.owner_id', true));
