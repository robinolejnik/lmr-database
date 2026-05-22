-- Re-apply legacy-schema grants for the application roles. Run automatically
-- by load.py after 01_schema + 02_constraints so a `pnpm migrate:legacy:clean`
-- restores access without anyone having to remember `pnpm migrate:current`.
--
-- Policy: authenticated users only. Both schemas (legacy + current) require
-- a real JWT — anonymous requests can introspect the GraphQL schema but
-- get "permission denied" on every data field. We REVOKE from
-- app_anonymous defensively in case an older gm v1 or out-of-band grant
-- left something behind.
--
-- Idempotent (GRANT/REVOKE/ALTER DEFAULT PRIVILEGES/COMMENT all overwrite
-- cleanly). Role-existence guarded so a fresh DB doesn't error before
-- `pnpm migrate:current` has created the app_* roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_authenticated') THEN
    GRANT USAGE                              ON SCHEMA legacy TO app_authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA legacy                TO app_authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA legacy GRANT SELECT ON TABLES TO app_authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_anonymous') THEN
    REVOKE USAGE                              ON SCHEMA legacy FROM app_anonymous;
    REVOKE SELECT ON ALL TABLES IN SCHEMA legacy                FROM app_anonymous;
    ALTER DEFAULT PRIVILEGES IN SCHEMA legacy REVOKE SELECT ON TABLES FROM app_anonymous;
  END IF;

  COMMENT ON SCHEMA legacy IS
    'Read-only mirror of the imported allocation registry. Authenticated users only. GraphQL mutations are blocked by LegacyReadOnlyPlugin in apps/postgraphile/graphile.config.mjs.';
END
$$;
