-- AlterTable
ALTER TABLE "outreach_settings" ADD COLUMN     "quietFromMinute" INTEGER,
ADD COLUMN     "quietToMinute" INTEGER,
ADD COLUMN     "dailyLimit" INTEGER NOT NULL DEFAULT 3;
