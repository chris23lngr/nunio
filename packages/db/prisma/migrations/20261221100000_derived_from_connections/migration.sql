-- Text derived from a Connection is sealed under its content key as well as under any Sources' keys (#290, #266).
-- The Connection ids sit beside the Source ids in `derivedFrom`, so existing rows need no backfill and code that
-- reads `derivedFrom` as Source ids keeps working.
ALTER TABLE "chat_message" ADD COLUMN "derivedFromConnections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "run_step" ADD COLUMN "derivedFromConnections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "run" ADD COLUMN "derivedFromConnections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "notice" ADD COLUMN "derivedFromConnections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "briefing" ADD COLUMN "derivedFromConnections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
