-- The Connections a Chat may read (#291): none in a new Chat, set by the student in the composer. Disconnect removes
-- the Connection's rows with it.
CREATE TABLE "chat_connection" (
  "chatId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  PRIMARY KEY ("chatId", "connectionId"),
  FOREIGN KEY ("chatId", "studentId") REFERENCES "chat"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("connectionId", "studentId") REFERENCES "connection"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "chat_connection_connectionId_idx" ON "chat_connection"("connectionId");

GRANT SELECT, INSERT, DELETE ON "chat_connection" TO nunio_runtime;
ALTER TABLE "chat_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_connection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat_connection" USING ("studentId" = current_setting('app.owner_id', true));
