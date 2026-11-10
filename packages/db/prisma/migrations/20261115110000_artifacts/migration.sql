-- CreateTable
CREATE TABLE "artifact" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'making',
    "failure" TEXT,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_version" (
    "artifactId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "contentKey" BYTEA,
    "derivedFrom" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_version_pkey" PRIMARY KEY ("artifactId","version")
);

-- CreateIndex
CREATE UNIQUE INDEX "artifact_runId_key" ON "artifact"("runId");

-- CreateIndex
CREATE INDEX "artifact_studentId_createdAt_idx" ON "artifact"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_id_studentId_key" ON "artifact"("id", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_runId_studentId_key" ON "artifact"("runId", "studentId");

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifactId_studentId_fkey" FOREIGN KEY ("artifactId", "studentId") REFERENCES "artifact"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. An Artifact is only ever finished, failed or opened; a version is never changed.
GRANT SELECT, INSERT, UPDATE ("status", "failure", "openedAt") ON "artifact" TO nunio_runtime;
GRANT SELECT, INSERT ON "artifact_version" TO nunio_runtime;
ALTER TABLE "artifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "artifact" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "artifact_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifact_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "artifact_version" USING ("studentId" = current_setting('app.owner_id', true));
