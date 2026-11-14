-- Chat history: a Chat's Last Activity orders the student's Chats and is null until its first question is saved.
ALTER TABLE "chat" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
UPDATE "chat" SET "lastActivityAt" = (
  SELECT max("createdAt") FROM "chat_message"
  WHERE "chat_message"."chatId" = "chat"."id" AND "chat_message"."role" = 'student'
);
CREATE INDEX "chat_studentId_lastActivityAt_id_idx" ON "chat"("studentId", "lastActivityAt" DESC, "id" DESC);
