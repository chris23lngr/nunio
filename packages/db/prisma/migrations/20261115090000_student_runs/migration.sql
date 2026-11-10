-- AlterTable
ALTER TABLE "run" ADD COLUMN     "chatId" TEXT;

-- CreateTable
CREATE TABLE "run_pin" (
    "runId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_pin_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "run_pin_course" (
    "runId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "run_pin_course_pkey" PRIMARY KEY ("runId","courseId")
);

-- CreateTable
CREATE TABLE "run_pin_source" (
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "run_pin_source_pkey" PRIMARY KEY ("runId","sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_pin_runId_studentId_key" ON "run_pin"("runId", "studentId");

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_chatId_studentId_fkey" FOREIGN KEY ("chatId", "studentId") REFERENCES "chat"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pin" ADD CONSTRAINT "run_pin_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pin_course" ADD CONSTRAINT "run_pin_course_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run_pin"("runId", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pin_course" ADD CONSTRAINT "run_pin_course_courseId_studentId_fkey" FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pin_source" ADD CONSTRAINT "run_pin_source_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run_pin"("runId", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pin_source" ADD CONSTRAINT "run_pin_source_sourceId_studentId_fkey" FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Student-owned. A pin is written once, when the student starts the Run, and never changed.
GRANT SELECT, INSERT ON "run_pin", "run_pin_course", "run_pin_source" TO nunio_runtime;
ALTER TABLE "run_pin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_pin" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run_pin" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "run_pin_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_pin_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run_pin_course" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "run_pin_source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_pin_source" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run_pin_source" USING ("studentId" = current_setting('app.owner_id', true));
