-- AlterEnum
ALTER TYPE "fact_type" ADD VALUE 'ai_use_rule';

-- AlterTable
ALTER TABLE "obligation" ADD COLUMN     "reportedSubmittedAt" TIMESTAMP(3);
