-- Email Destinations (#305, #264): the student confirms an address for an Obligation, or a default for its Course.
CREATE TYPE "provenance_kind" AS ENUM ('source', 'correction', 'entry');

ALTER TABLE "obligation" ADD COLUMN "emailDestination" TEXT,
ADD COLUMN "emailDestinationConfirmedAt" TIMESTAMP(3),
ADD COLUMN "emailDestinationProvenance" "provenance_kind",
ADD COLUMN "emailDestinationExtractionId" TEXT;

ALTER TABLE "course" ADD COLUMN "emailDestination" TEXT,
ADD COLUMN "emailDestinationConfirmedAt" TIMESTAMP(3);
