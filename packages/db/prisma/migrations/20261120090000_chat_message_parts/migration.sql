-- An answer's ordered steps (reasoning, tool calls, text) as the student saw them, encrypted under its Source dependencies.
ALTER TABLE "chat_message" ADD COLUMN "partsContent" BYTEA,
ADD COLUMN "partsKey" BYTEA;
