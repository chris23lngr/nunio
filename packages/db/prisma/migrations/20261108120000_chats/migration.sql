CREATE TABLE "chat" (
  "id" TEXT PRIMARY KEY,
  "studentId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "chat_id_studentId_key" ON "chat"("id", "studentId");
CREATE INDEX "chat_studentId_idx" ON "chat"("studentId");

CREATE TABLE "chat_course" (
  "chatId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("chatId", "courseId"),
  FOREIGN KEY ("chatId", "studentId") REFERENCES "chat"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("courseId", "studentId") REFERENCES "course"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "chat_source" (
  "chatId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("chatId", "sourceId"),
  FOREIGN KEY ("chatId", "studentId") REFERENCES "chat"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId", "studentId") REFERENCES "source"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TYPE "chat_role" AS ENUM ('student', 'assistant');
CREATE TABLE "chat_message" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "role" "chat_role" NOT NULL,
  "text" TEXT NOT NULL,
  "citations" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("chatId", "studentId") REFERENCES "chat"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_message_chatId_createdAt_idx" ON "chat_message"("chatId", "createdAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON "chat", "chat_course", "chat_source" TO nunio_runtime;
GRANT SELECT, INSERT, DELETE ON "chat_message" TO nunio_runtime;
ALTER TABLE "chat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "chat_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat_course" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "chat_source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_source" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat_source" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_message" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat_message" USING ("studentId" = current_setting('app.owner_id', true));
