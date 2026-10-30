-- The runtime role (Phase 3). Each environment provisions its own login role as a member; the
-- migration role keeps table ownership. Never grant this role BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nunio_runtime') THEN
    CREATE ROLE nunio_runtime NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nunio_runtime;

-- Student-owned rows are visible only under the transaction-local owner set by withOwner.
GRANT SELECT, INSERT ON "pilot_entitlement" TO nunio_runtime;
ALTER TABLE "pilot_entitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pilot_entitlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner" ON "pilot_entitlement"
  USING ("studentId" = current_setting('app.owner_id', true));
