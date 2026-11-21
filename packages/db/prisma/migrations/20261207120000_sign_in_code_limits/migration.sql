-- Hourly limits on sign-in codes per address (ADR-0027). Better Auth prunes "rate_limit" rows after its own
-- windows of a minute or less, so these counters need their own table.
-- CreateTable
CREATE TABLE "sign_in_code_limit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" BIGINT NOT NULL,

    CONSTRAINT "sign_in_code_limit_pkey" PRIMARY KEY ("key")
);

-- The API counts codes before a student is known, like the other auth tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON "sign_in_code_limit" TO nunio_runtime;
