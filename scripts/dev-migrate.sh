#!/bin/sh
# Dev stack step: apply migrations as the database owner, then create the login role the API and
# worker connect with. The owner bypasses row-level security; a nunio_runtime member, like the
# deployed API, does not. Safe to re-run.
set -eu

bun run --cwd packages/db migrate:deploy

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE nunio_app LOGIN PASSWORD ''nunio'' IN ROLE nunio_runtime'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nunio_app')
\gexec
SQL
