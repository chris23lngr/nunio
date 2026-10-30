-- Auth tables are reached before a student is known, so grants rather than RLS control them.
-- The runtime role claims invitations but never issues them; account deletion stays manual.
GRANT SELECT, INSERT, UPDATE ON "user" TO nunio_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO nunio_runtime;
GRANT SELECT, INSERT, UPDATE ON "account" TO nunio_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "verification" TO nunio_runtime;
GRANT SELECT, INSERT, UPDATE ON "rate_limit" TO nunio_runtime;
GRANT SELECT, UPDATE ON "invitation" TO nunio_runtime;
