--! Previous: sha1:34cdbd398a6db5a73bc6103a56a8ce4737cfda20
--! Hash: sha1:94055f9e03ecb21d39cf5fea6b5982344c5e897b
--! Message: v3 - index legacy antenne lat lon for filter exposure

-- v3 — index legacy.antenne.lat/lon so PostGraphile exposes them in filters
--
-- Connection-filter only surfaces a column in <Type>Filter when there's a
-- backing btree/gin index on it (same gating as orderBy enums). The legacy
-- pipeline doesn't build these, so map-side bbox queries can't filter on
-- lat/lon. Adding plain btree indexes is enough.
--
-- Guarded: the shadow DB used by `gm commit` doesn't have the legacy schema,
-- so we only run when both schema and table exist. Idempotent via IF NOT
-- EXISTS so a `pnpm migrate:legacy:clean` re-creating the table doesn't
-- conflict — replay this migration and the indexes come back.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy')
     AND EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'legacy' AND table_name = 'antenne'
     )
  THEN
    CREATE INDEX IF NOT EXISTS antenne_lat_idx ON legacy.antenne (lat);
    CREATE INDEX IF NOT EXISTS antenne_lon_idx ON legacy.antenne (lon);
  END IF;
END
$$;
