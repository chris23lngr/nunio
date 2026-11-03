CREATE TYPE "source_failure" AS ENUM ('too_many_pages', 'too_large', 'unreadable', 'no_text', 'allowance_exhausted');
ALTER TABLE "source" ADD COLUMN "failure" "source_failure";
