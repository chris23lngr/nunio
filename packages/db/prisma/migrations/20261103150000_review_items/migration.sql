-- Slice 1 stored review state per Source row; items now span Sources. Only staging test data existed, so rebuild.
DROP TABLE "obligation";
DROP TABLE "fact";

CREATE TYPE "unsupported" AS ENUM ('source_deleted', 'not_found');

CREATE TABLE "obligation" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "kind" "obligation_kind" NOT NULL,
  "state" "review_state" NOT NULL DEFAULT 'unreviewed',
  "correctedAt" TIMESTAMP(3),
  "correctedTitle" TEXT,
  "correctedDueDate" DATE,
  "correctedDueTime" TEXT CHECK ("correctedDueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  "correctedTimeZone" TEXT,
  "correctedDestination" TEXT,
  "unsupported" "unsupported",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "obligation_id_studentId_key" ON "obligation"("id", "studentId");
CREATE UNIQUE INDEX "obligation_courseId_matchKey_key" ON "obligation"("courseId", "matchKey");
CREATE INDEX "obligation_studentId_courseId_idx" ON "obligation"("studentId", "courseId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "obligation" TO nunio_runtime;
ALTER TABLE "obligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obligation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "obligation" USING ("studentId" = current_setting('app.owner_id', true));

-- Structure is plain for planning and matching; wording is encrypted under the Source key (ciphertext).
CREATE TABLE "obligation_extraction" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "dueDate" DATE,
  "dueTime" TEXT CHECK ("dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  "timeZone" TEXT,
  "ciphertext" BYTEA NOT NULL,
  "overruledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("obligationId", "studentId") REFERENCES "obligation"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "obligation_extraction_obligationId_idx" ON "obligation_extraction"("obligationId");
CREATE INDEX "obligation_extraction_sourceId_idx" ON "obligation_extraction"("sourceId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "obligation_extraction" TO nunio_runtime;
ALTER TABLE "obligation_extraction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "obligation_extraction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "obligation_extraction" USING ("studentId" = current_setting('app.owner_id', true));

CREATE TABLE "fact" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "type" "fact_type" NOT NULL,
  "matchKey" TEXT NOT NULL,
  "state" "review_state" NOT NULL DEFAULT 'unreviewed',
  "correctedAt" TIMESTAMP(3),
  "correctedValue" TEXT,
  "unsupported" "unsupported",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fact_id_studentId_key" ON "fact"("id", "studentId");
CREATE UNIQUE INDEX "fact_courseId_type_matchKey_key" ON "fact"("courseId", "type", "matchKey");
CREATE INDEX "fact_studentId_courseId_idx" ON "fact"("studentId", "courseId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "fact" TO nunio_runtime;
ALTER TABLE "fact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "fact" USING ("studentId" = current_setting('app.owner_id', true));

CREATE TABLE "fact_extraction" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "overruledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("factId", "studentId") REFERENCES "fact"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "fact_extraction_factId_idx" ON "fact_extraction"("factId");
CREATE INDEX "fact_extraction_sourceId_idx" ON "fact_extraction"("sourceId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "fact_extraction" TO nunio_runtime;
ALTER TABLE "fact_extraction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact_extraction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "fact_extraction" USING ("studentId" = current_setting('app.owner_id', true));
