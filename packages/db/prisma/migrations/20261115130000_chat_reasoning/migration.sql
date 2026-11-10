-- Keep reasoning separately encrypted under the answer's Source dependencies.
ALTER TABLE "chat_message" ADD COLUMN "reasoningContent" BYTEA,
ADD COLUMN "reasoningKey" BYTEA;
