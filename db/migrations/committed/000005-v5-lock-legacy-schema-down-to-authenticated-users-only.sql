--! Previous: sha1:e301bef810cc8508f99c9d507106ef8450071e2e
--! Hash: sha1:f56af1144c61b05968f77fc33aafb8c6d9619d54
--! Message: v5 - lock legacy schema down to authenticated users only

-- v5 — restrict app_anonymous to nothing.
--
-- Earlier gm v1 granted SELECT on legacy.* to BOTH app_anonymous and
-- app_authenticated. Policy is "authenticated users only" for both
-- schemas — drop the anonymous access. The Python pipeline's
-- db/init/03_legacy_grants.sql also no longer grants to anonymous AND
-- defensively revokes, so a clean re-import stays locked down.
--
-- Idempotent: REVOKE on a non-existent grant is a no-op.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_anonymous')
  THEN
    REVOKE USAGE                              ON SCHEMA legacy FROM app_anonymous;
    REVOKE SELECT ON ALL TABLES IN SCHEMA legacy                FROM app_anonymous;
    ALTER DEFAULT PRIVILEGES IN SCHEMA legacy REVOKE SELECT ON TABLES FROM app_anonymous;
  END IF;
END
$$;
