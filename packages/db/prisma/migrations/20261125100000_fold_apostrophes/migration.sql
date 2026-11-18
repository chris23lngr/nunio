-- Match keys now fold typographic apostrophes into ' (normalize in @nunio/knowledge). Stored keys follow,
-- except where another row folds to the same key: those rows stay apart as they were.
UPDATE "course" SET "matchTitle" = translate("matchTitle", '’‘ʼ', $$'''$$)
WHERE "matchTitle" ~ '[’‘ʼ]';
UPDATE "course" SET "matchCode" = translate("matchCode", '’‘ʼ', $$'''$$)
WHERE "matchCode" ~ '[’‘ʼ]';

UPDATE "obligation" o SET "matchKey" = translate(o."matchKey", '’‘ʼ', $$'''$$)
WHERE o."matchKey" ~ '[’‘ʼ]'
  AND NOT EXISTS (
    SELECT 1 FROM "obligation" other
    WHERE other."id" <> o."id"
      AND other."courseId" = o."courseId"
      AND translate(other."matchKey", '’‘ʼ', $$'''$$) = translate(o."matchKey", '’‘ʼ', $$'''$$)
  );

UPDATE "fact" f SET "matchKey" = translate(f."matchKey", '’‘ʼ', $$'''$$)
WHERE f."matchKey" ~ '[’‘ʼ]'
  AND NOT EXISTS (
    SELECT 1 FROM "fact" other
    WHERE other."id" <> f."id"
      AND other."courseId" = f."courseId"
      AND other."type" = f."type"
      AND translate(other."matchKey", '’‘ʼ', $$'''$$) = translate(f."matchKey", '’‘ʼ', $$'''$$)
  );

UPDATE "topic_area" a SET "matchKey" = translate(a."matchKey", '’‘ʼ', $$'''$$)
WHERE a."matchKey" ~ '[’‘ʼ]'
  AND NOT EXISTS (
    SELECT 1 FROM "topic_area" other
    WHERE other."id" <> a."id"
      AND other."courseId" = a."courseId"
      AND translate(other."matchKey", '’‘ʼ', $$'''$$) = translate(a."matchKey", '’‘ʼ', $$'''$$)
  );
