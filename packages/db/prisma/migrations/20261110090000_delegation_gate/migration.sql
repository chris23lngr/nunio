-- CreateEnum
CREATE TYPE "responsibility_state" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "action_status" AS ENUM ('awaiting_approval', 'dispatching', 'done', 'failed', 'refused', 'unconfirmed');

-- CreateEnum
CREATE TYPE "attempt_status" AS ENUM ('in_flight', 'done', 'failed', 'unconfirmed');

-- AlterTable
ALTER TABLE "usage_reservation" ADD COLUMN     "responsibilityId" TEXT;

-- CreateTable
CREATE TABLE "responsibility" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "state" "responsibility_state" NOT NULL DEFAULT 'active',
    "pausedBy" TEXT,
    "budgetMicroUsd" BIGINT NOT NULL,
    "usedMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "heldMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "restrictions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grant" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "responsibilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "courseId" TEXT,
    "obligationId" TEXT,

    CONSTRAINT "grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "responsibilityId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "runId" TEXT,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" "action_status" NOT NULL,
    "refusal" TEXT,
    "failure" TEXT,
    "effect" JSONB,
    "grantId" TEXT,
    "approvalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "attempt_status" NOT NULL DEFAULT 'in_flight',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_event" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "action_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "responsibility_studentId_idx" ON "responsibility"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "responsibility_id_studentId_key" ON "responsibility"("id", "studentId");

-- CreateIndex
CREATE INDEX "grant_responsibilityId_idx" ON "grant"("responsibilityId");

-- CreateIndex
CREATE INDEX "run_studentId_idx" ON "run"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "run_id_studentId_key" ON "run"("id", "studentId");

-- CreateIndex
CREATE INDEX "action_runId_idx" ON "action"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "action_studentId_key_key" ON "action"("studentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "action_id_studentId_key" ON "action"("id", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_actionId_key" ON "approval"("actionId");

-- CreateIndex
CREATE INDEX "approval_studentId_idx" ON "approval"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_actionId_studentId_key" ON "approval"("actionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_idempotencyKey_key" ON "attempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "attempt_status_startedAt_idx" ON "attempt"("status", "startedAt");

-- CreateIndex
CREATE INDEX "action_event_actionId_at_idx" ON "action_event"("actionId", "at");

-- AddForeignKey
ALTER TABLE "responsibility" ADD CONSTRAINT "responsibility_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grant" ADD CONSTRAINT "grant_responsibilityId_studentId_fkey" FOREIGN KEY ("responsibilityId", "studentId") REFERENCES "responsibility"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_responsibilityId_studentId_fkey" FOREIGN KEY ("responsibilityId", "studentId") REFERENCES "responsibility"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_runId_studentId_fkey" FOREIGN KEY ("runId", "studentId") REFERENCES "run"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval" ADD CONSTRAINT "approval_actionId_studentId_fkey" FOREIGN KEY ("actionId", "studentId") REFERENCES "action"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_actionId_studentId_fkey" FOREIGN KEY ("actionId", "studentId") REFERENCES "action"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_event" ADD CONSTRAINT "action_event_actionId_studentId_fkey" FOREIGN KEY ("actionId", "studentId") REFERENCES "action"("id", "studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. History is append-only: the runtime role may add events but never change or remove them.
GRANT SELECT, INSERT, UPDATE ON "responsibility", "run", "action", "approval", "attempt" TO nunio_runtime;
GRANT SELECT, INSERT, DELETE ON "grant" TO nunio_runtime;
GRANT SELECT, INSERT ON "action_event" TO nunio_runtime;
GRANT INSERT ("responsibilityId") ON "usage_reservation" TO nunio_runtime;
ALTER TABLE "responsibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "responsibility" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "responsibility" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "grant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "grant" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "run" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "action" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "action" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "approval" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "attempt" USING ("studentId" = current_setting('app.owner_id', true));
ALTER TABLE "action_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "action_event" USING ("studentId" = current_setting('app.owner_id', true));

-- A Run Principal is minted only server-side, so resolving it to its student needs no owner context.
CREATE FUNCTION "run_owner"(run_id TEXT) RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT "studentId" FROM "run" WHERE "id" = run_id $$;
REVOKE ALL ON FUNCTION "run_owner"(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "run_owner"(TEXT) TO nunio_runtime;

-- reconcile finds in-flight Attempts across students, then handles each under its owner.
CREATE FUNCTION "stale_attempts"(started_before TIMESTAMP(3)) RETURNS TABLE ("actionId" TEXT, "studentId" TEXT)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT "actionId", "studentId" FROM "attempt" WHERE "status" = 'in_flight' AND "startedAt" < started_before $$;
REVOKE ALL ON FUNCTION "stale_attempts"(TIMESTAMP(3)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "stale_attempts"(TIMESTAMP(3)) TO nunio_runtime;
