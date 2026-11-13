-- Whether a Fact's quote was found in the page's text or only in a figure description. Structure, so plain; existing
-- rows default to text, since figure grounding was barely in use and backfilling would need decrypting.
CREATE TYPE "grounding" AS ENUM ('text', 'figure');
ALTER TABLE "fact_extraction" ADD COLUMN "grounding" "grounding" NOT NULL DEFAULT 'text';
