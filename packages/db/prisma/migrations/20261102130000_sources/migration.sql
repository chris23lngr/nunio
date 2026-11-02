CREATE TABLE "source" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 20971520),
  "status" TEXT NOT NULL DEFAULT 'uploading',
  "keyVersion" TEXT,
  "keyCiphertext" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX "source_studentId_deletedAt_idx" ON "source"("studentId", "deletedAt");
GRANT SELECT, INSERT, UPDATE, DELETE ON "source" TO nunio_runtime;
ALTER TABLE "source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "source" USING ("studentId" = current_setting('app.owner_id', true));

CREATE EXTENSION IF NOT EXISTS vector;
CREATE UNIQUE INDEX "source_id_studentId_key" ON "source"("id", "studentId");
CREATE TABLE "source_chunk" (
  "id" TEXT PRIMARY KEY,
  "sourceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "page" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL CHECK ("dimensions" > 0),
  "embedding" vector NOT NULL CHECK (vector_dims("embedding") = "dimensions"),
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "source_chunk_sourceId_ordinal_key" ON "source_chunk"("sourceId", "ordinal");
CREATE INDEX "source_chunk_studentId_sourceId_idx" ON "source_chunk"("studentId", "sourceId");
GRANT SELECT, INSERT, DELETE ON "source_chunk" TO nunio_runtime;
ALTER TABLE "source_chunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_chunk" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "source_chunk" USING ("studentId" = current_setting('app.owner_id', true));
