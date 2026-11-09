-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "expirationTime" TIMESTAMP(3),
    "vapidKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned. An endpoint is a capability URL: never logged, deleted once the push service says it is gone.
GRANT SELECT, INSERT, DELETE ON "push_subscription" TO nunio_runtime;
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "push_subscription" USING ("studentId" = current_setting('app.owner_id', true));
