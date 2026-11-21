-- An Agent's Model (#180): its Runs run on it, and the student picks it from the Models Chat offers. Free-text Agents
-- saved before ran on the Chat default, so they keep it; preset Agents make no model calls and get none until the
-- Agents cutover converts them.
ALTER TABLE "agent" ADD COLUMN "modelKey" TEXT;
ALTER TABLE "agent" ADD CONSTRAINT "agent_modelKey_fkey" FOREIGN KEY ("modelKey") REFERENCES "catalog_model"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "agent" SET "modelKey" = (SELECT "key" FROM "catalog_model" WHERE "chatDefault")
WHERE "preset" IS NULL;
