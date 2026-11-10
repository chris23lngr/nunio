-- CreateTable
CREATE TABLE "practice_attempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "topicIds" TEXT[],
    "text" TEXT NOT NULL,
    "verdict" TEXT,
    "feedback" BYTEA,
    "feedbackKey" BYTEA,
    "derivedFrom" TEXT[],
    "citations" JSONB NOT NULL DEFAULT '[]',
    "gradedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_assessment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_attempt_studentId_createdAt_idx" ON "practice_attempt"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "self_assessment_studentId_topicId_idx" ON "self_assessment"("studentId", "topicId");

-- AddForeignKey
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_artifactId_studentId_fkey" FOREIGN KEY ("artifactId", "studentId") REFERENCES "artifact"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_assessment" ADD CONSTRAINT "self_assessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_assessment" ADD CONSTRAINT "self_assessment_topicId_studentId_fkey" FOREIGN KEY ("topicId", "studentId") REFERENCES "fact"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. An Attempt is only ever graded; a Self-assessment is never changed.
GRANT SELECT, INSERT, UPDATE ("verdict", "feedback", "feedbackKey", "derivedFrom", "citations", "gradedAt") ON "practice_attempt" TO nunio_runtime;
GRANT SELECT, INSERT ON "self_assessment" TO nunio_runtime;
ALTER TABLE "practice_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practice_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "practice_attempt" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "self_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_assessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "self_assessment" USING ("studentId" = current_setting('app.owner_id', true));
