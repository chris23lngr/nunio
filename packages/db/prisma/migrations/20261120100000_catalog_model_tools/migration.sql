-- Whether one of a Model's zero-retention endpoints takes tools, which Chat needs (ADR-0018 amendment).
-- Existing Models stay offered until the next price sync records the real value.
ALTER TABLE "catalog_model" ADD COLUMN "toolsAvailable" BOOLEAN NOT NULL DEFAULT true;

GRANT UPDATE ("toolsAvailable") ON "catalog_model" TO nunio_runtime;
