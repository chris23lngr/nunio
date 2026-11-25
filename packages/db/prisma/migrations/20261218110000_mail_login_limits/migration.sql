-- Mailbox logins per student in a fixed window (#287): testing and connecting Email log in to a mail server the
-- student names, so a limit keeps nunio from being used to guess passwords.
CREATE TABLE "mail_login_limit" (
    "studentId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" BIGINT NOT NULL,

    CONSTRAINT "mail_login_limit_pkey" PRIMARY KEY ("studentId")
);

ALTER TABLE "mail_login_limit" ADD CONSTRAINT "mail_login_limit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Student-owned: the API counts under the student's owner context.
GRANT SELECT, INSERT, UPDATE ON "mail_login_limit" TO nunio_runtime;
ALTER TABLE "mail_login_limit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_login_limit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "mail_login_limit" USING ("studentId" = current_setting('app.owner_id', true));
