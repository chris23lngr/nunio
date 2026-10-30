-- The runtime role updates only the columns Better Auth and the invitation claim write, so it can
-- neither extend nor re-target an invitation nor change a user's id or email (email changes are deferred).
REVOKE UPDATE ON "invitation" FROM nunio_runtime;
GRANT UPDATE ("acceptedAt") ON "invitation" TO nunio_runtime;
REVOKE UPDATE ON "user" FROM nunio_runtime;
GRANT UPDATE ("name", "image", "emailVerified", "updatedAt") ON "user" TO nunio_runtime;

-- Better Auth prunes expired rate-limit windows.
GRANT DELETE ON "rate_limit" TO nunio_runtime;
