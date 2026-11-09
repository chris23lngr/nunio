-- CreateTable
CREATE TABLE "plan_effect" (
    "idempotencyKey" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studyBlockId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_effect_pkey" PRIMARY KEY ("studentId","idempotencyKey")
);

-- AddForeignKey
ALTER TABLE "plan_effect" ADD CONSTRAINT "plan_effect_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned; an effect is recorded once and never changed.
GRANT SELECT, INSERT ON "plan_effect" TO nunio_runtime;
ALTER TABLE "plan_effect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_effect" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "plan_effect" USING ("studentId" = current_setting('app.owner_id', true));
