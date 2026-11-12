-- CreateTable
CREATE TABLE "catalog_model" (
    "key" TEXT NOT NULL,
    "providerModelId" TEXT NOT NULL,
    "reasoningEffort" TEXT NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "chatDefault" BOOLEAN NOT NULL DEFAULT false,
    "retiredAt" TIMESTAMP(3),
    "prices" JSONB,
    "upstream" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "zeroRetentionAvailable" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_model_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "catalog_model_key_check" CHECK ("key" ~ '^[a-z0-9][a-z0-9.-]*$'),
    CONSTRAINT "catalog_model_reasoningEffort_check" CHECK ("reasoningEffort" IN ('low', 'medium', 'high')),
    CONSTRAINT "catalog_model_maxOutputTokens_check" CHECK ("maxOutputTokens" > 0),
    -- The Chat default is always offered in Chat, and a retired Model is offered nowhere.
    CONSTRAINT "catalog_model_default_check" CHECK (NOT "chatDefault" OR "chatEnabled"),
    CONSTRAINT "catalog_model_retired_check" CHECK ("retiredAt" IS NULL OR NOT "chatEnabled")
);

-- At most one Chat default.
CREATE UNIQUE INDEX "catalog_model_one_chat_default" ON "catalog_model" ("chatDefault") WHERE "chatDefault";

-- CreateTable
CREATE TABLE "model_catalog_change" (
    "id" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_catalog_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_catalog_change_modelKey_idx" ON "model_catalog_change"("modelKey");

-- CreateTable
CREATE TABLE "chat_preference" (
    "studentId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_preference_pkey" PRIMARY KEY ("studentId")
);

-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN "modelKey" TEXT;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_modelKey_fkey" FOREIGN KEY ("modelKey") REFERENCES "catalog_model"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "model_catalog_change" ADD CONSTRAINT "model_catalog_change_modelKey_fkey" FOREIGN KEY ("modelKey") REFERENCES "catalog_model"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_preference" ADD CONSTRAINT "chat_preference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_preference" ADD CONSTRAINT "chat_preference_modelKey_fkey" FOREIGN KEY ("modelKey") REFERENCES "catalog_model"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The runtime reads the catalog and, as the worker's price sync, writes only the synced columns.
-- The founder's switches and the audit trail belong to the operator connection (docs/operations/environments.md).
GRANT SELECT ON "catalog_model" TO nunio_runtime;
GRANT UPDATE ("prices", "upstream", "zeroRetentionAvailable", "syncedAt") ON "catalog_model" TO nunio_runtime;

-- Student-owned.
GRANT SELECT, INSERT, UPDATE ON "chat_preference" TO nunio_runtime;
ALTER TABLE "chat_preference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_preference" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "chat_preference" USING ("studentId" = current_setting('app.owner_id', true));

-- The Models that answered before the catalog, at OpenRouter's highest zero-retention prices on 2026-11-19
-- (micro-USD per million tokens). Reasoning effort is pinned to high, OpenRouter's default (spike, 2026-11-19).
-- The worker's daily sync replaces the prices; until it first runs they count as synced now.
INSERT INTO "catalog_model" ("key", "providerModelId", "reasoningEffort", "maxOutputTokens", "name", "provider", "description", "position", "chatEnabled", "chatDefault", "prices", "upstream", "zeroRetentionAvailable", "syncedAt") VALUES
  ('haiku-5.5-reasoning-high', 'anthropic/claude-haiku-5.5', 'high', 8000, 'Haiku 5.5', 'Anthropic', 'Schnell und sparsam für kurze, klare Aufgaben.', 1, true, false,
   '[{"minPromptTokens":0,"inputMicroUsdPerMTok":110000,"outputMicroUsdPerMTok":550000},{"minPromptTokens":100000,"inputMicroUsdPerMTok":550000,"outputMicroUsdPerMTok":2750000}]',
   ARRAY['Amazon Bedrock', 'Google'], true, CURRENT_TIMESTAMP),
  ('sonnet-5.5-reasoning-high', 'anthropic/claude-sonnet-5.5', 'high', 8000, 'Sonnet 5.5', 'Anthropic', 'Ausgewogen für Erklärungen und alltägliches Lernen.', 2, true, true,
   '[{"minPromptTokens":0,"inputMicroUsdPerMTok":2200000,"outputMicroUsdPerMTok":11000000}]',
   ARRAY['Amazon Bedrock', 'Google'], true, CURRENT_TIMESTAMP),
  ('opus-5.5-reasoning-high', 'anthropic/claude-opus-5.5', 'high', 8000, 'Opus 5.5', 'Anthropic', 'Am gründlichsten für anspruchsvolle, lange Aufgaben.', 3, true, false,
   '[{"minPromptTokens":0,"inputMicroUsdPerMTok":4400000,"outputMicroUsdPerMTok":22000000}]',
   ARRAY['Amazon Bedrock', 'Google'], true, CURRENT_TIMESTAMP);
