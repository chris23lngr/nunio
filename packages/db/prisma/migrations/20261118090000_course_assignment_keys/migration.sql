-- Deleting a Course cascades to its distinct pairs from either side; the other side needs its own index.
CREATE INDEX "distinct_course_pair_otherId_idx" ON "distinct_course_pair"("otherId");
