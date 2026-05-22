--! Previous: sha1:94055f9e03ecb21d39cf5fea6b5982344c5e897b
--! Hash: sha1:e301bef810cc8508f99c9d507106ef8450071e2e
--! Message: v4 - index legacy zuteilung/frequenz for filter exposure + service-segments helper

-- v4 — index legacy columns the map needs to filter on, and a small
-- distinct-service-segments helper.
--
-- Same index-gating rule as before: PostGraphile's connection-filter only
-- surfaces a column in <Type>Filter when there's a backing index. To filter
-- the legacy-antenna overlay by service segment, state, and frequency, we
-- need btree indexes on those columns. legacy is normally Python-managed;
-- the index DDL is guarded so this also no-ops in the gm shadow DB (which
-- has no legacy schema).
--
-- Frequenz units vary (MHz / kHz / GHz). For the map filter we expect the
-- user to type MHz; we filter on the raw numeric values and let the unit
-- column come along in the result for display. If precision becomes an
-- issue later, add a `frequency_hz` generated column on legacy.frequenz.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy') THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='legacy' AND table_name='zuteilung') THEN
      CREATE INDEX IF NOT EXISTS zuteilung_dienstsegmentname_idx ON legacy.zuteilung (dienstsegmentname);
      CREATE INDEX IF NOT EXISTS zuteilung_statecodename_idx     ON legacy.zuteilung (statecodename);
      CREATE INDEX IF NOT EXISTS zuteilung_befristung_idx        ON legacy.zuteilung (befristung);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='legacy' AND table_name='frequenz') THEN
      CREATE INDEX IF NOT EXISTS frequenz_frequenz1_idx ON legacy.frequenz (frequenz1);
      CREATE INDEX IF NOT EXISTS frequenz_frequenz2_idx ON legacy.frequenz (frequenz2);
    END IF;
  END IF;
END
$$;

-- Distinct list of dienstsegmentname values, populated from legacy.zuteilung.
-- Exposed as the GraphQL field `legacyServiceSegments`. Returns a SETOF text.
-- Lives in `current` (graphile-migrate-managed) so the legacy import script
-- can re-create the legacy schema without affecting this function.
CREATE OR REPLACE FUNCTION current.legacy_service_segments() RETURNS SETOF text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy') THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT dienstsegmentname
    FROM legacy.zuteilung
    WHERE dienstsegmentname IS NOT NULL AND dienstsegmentname <> ''
    ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION current.legacy_service_segments() TO app_authenticated, app_anonymous;
