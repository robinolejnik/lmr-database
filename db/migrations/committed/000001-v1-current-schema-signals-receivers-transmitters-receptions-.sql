--! Previous: -
--! Hash: sha1:abd8ef4ead380ef0ece261c9e7e0ddb0189d12a8
--! Message: v1 - current schema (signals, receivers, transmitters, receptions, tags) + Keycloak audit

--
-- v1 of the `current` schema. Read by graphile-migrate.
--
-- Idempotent: every statement is guarded so the file can replay safely
-- during `gm watch`. Once stable, commit with `pnpm migrate:current:commit`.

------------------------------------------------------------------------------
-- 1. Extensions
------------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;     -- already enabled by the postgis image, but be explicit
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram search for ILIKE/name lookups

------------------------------------------------------------------------------
-- 2. Roles
------------------------------------------------------------------------------
-- app_anonymous: unauthenticated GraphQL requests. Read-only on legacy.
-- app_authenticated: any authenticated Keycloak user. Read+write on current,
--                    read on legacy.
-- The DB owner (:DATABASE_OWNER) gets membership in both so PostGraphile can
-- SET ROLE into either from pgSettings.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_anonymous') THEN
    CREATE ROLE app_anonymous NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated NOLOGIN;
  END IF;
END
$$;

GRANT app_anonymous, app_authenticated TO :DATABASE_OWNER;

------------------------------------------------------------------------------
-- 3. Schema + base grants
------------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS current AUTHORIZATION :DATABASE_OWNER;

-- legacy is read-only for everyone. Guarded so this migration runs on
-- environments where legacy hasn't been imported yet (notably the
-- graphile-migrate shadow DB used by `gm commit`).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'legacy') THEN
    GRANT USAGE                            ON SCHEMA legacy TO app_anonymous, app_authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA legacy             TO app_anonymous, app_authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA legacy GRANT SELECT ON TABLES TO app_anonymous, app_authenticated;
    COMMENT ON SCHEMA legacy IS
      'Read-only mirror of the imported allocation registry. GraphQL mutations are blocked by LegacyReadOnlyPlugin in apps/postgraphile/graphile.config.mjs.';
  END IF;
END
$$;

-- current is read+write for authenticated users only
GRANT USAGE ON SCHEMA current TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA current TO app_authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA current TO app_authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA current
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA current
  GRANT USAGE, SELECT ON SEQUENCES TO app_authenticated;

------------------------------------------------------------------------------
-- 4. app_user — Keycloak-identified users, created on first sign-in
------------------------------------------------------------------------------
-- Populated by the audit trigger via ON CONFLICT upsert. Mutations are
-- intentionally NOT exposed to PostGraphile (see @behavior smart comment).

CREATE TABLE IF NOT EXISTS current.app_user (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_sub       text NOT NULL UNIQUE,
  email              text,
  preferred_username text,
  display_name       text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE current.app_user IS
  E'@behavior -insert -update -delete\nKeycloak-identified users. Rows are created automatically by the audit trigger; do not mutate directly.';

------------------------------------------------------------------------------
-- 5. Audit trigger function
------------------------------------------------------------------------------
-- Stamps created_by / updated_by from the JWT subject pushed in by PostGraphile.
-- Runs SECURITY DEFINER so it can upsert app_user regardless of the caller's
-- role (e.g. app_authenticated has no INSERT on app_user).

CREATE OR REPLACE FUNCTION current.tg_set_audit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = current, pg_catalog
AS $$
DECLARE
  v_sub      text := current_setting('jwt.claims.sub', true);
  v_email    text := current_setting('jwt.claims.email', true);
  v_username text := current_setting('jwt.claims.preferred_username', true);
  v_name     text := current_setting('jwt.claims.name', true);
  v_user_id  uuid;
BEGIN
  IF v_sub IS NULL OR v_sub = '' THEN
    -- No JWT context (e.g. shadow DB, direct psql). Stamp timestamps only.
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := COALESCE(NEW.created_at, now());
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  INSERT INTO current.app_user (keycloak_sub, email, preferred_username, display_name)
  VALUES (v_sub, v_email, v_username, v_name)
  ON CONFLICT (keycloak_sub) DO UPDATE
    SET email              = COALESCE(EXCLUDED.email,              current.app_user.email),
        preferred_username = COALESCE(EXCLUDED.preferred_username, current.app_user.preferred_username),
        display_name       = COALESCE(EXCLUDED.display_name,       current.app_user.display_name),
        last_seen_at       = now()
  RETURNING id INTO v_user_id;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by_id := COALESCE(NEW.created_by_id, v_user_id);
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_id := v_user_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION current.tg_set_audit() OWNER TO :DATABASE_OWNER;

------------------------------------------------------------------------------
-- 6. mode lookup
------------------------------------------------------------------------------
-- Managed via migrations. Mutations disabled.

CREATE TABLE IF NOT EXISTS current.mode (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  display_order integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE current.mode IS
  E'@behavior -insert -update -delete\nModulation / signal-mode catalog. Managed via migrations.';

INSERT INTO current.mode (code, name, description, display_order) VALUES
  ('NFM',     'Narrow FM',       'Standard narrow-band FM voice',                10),
  ('WFM',     'Wide FM',         'Broadcast FM',                                  20),
  ('AM',      'AM',              'Amplitude modulation',                          30),
  ('USB',     'Upper Sideband',  'SSB voice (upper sideband)',                    40),
  ('LSB',     'Lower Sideband',  'SSB voice (lower sideband)',                    50),
  ('CW',      'CW',              'Continuous wave / Morse',                       60),
  ('TETRA',   'TETRA',           'Terrestrial Trunked Radio',                    100),
  ('DMR',     'DMR',             'Digital Mobile Radio',                         110),
  ('P25',     'P25',             'Project 25 (APCO-25)',                         120),
  ('NXDN',    'NXDN',            'NXDN digital voice',                           130),
  ('dPMR',    'dPMR',            'digital Private Mobile Radio',                 140),
  ('POCSAG',  'POCSAG',          'Pager protocol',                               200),
  ('FLEX',    'FLEX',            'Motorola FLEX pager protocol',                 210),
  ('ADS-B',   'ADS-B',           'Aircraft surveillance broadcast',              300),
  ('ACARS',   'ACARS',           'Aircraft messaging',                           310),
  ('AIS',     'AIS',             'Marine vessel tracking',                       320),
  ('FT8',     'FT8',             'Weak-signal digital mode',                     400),
  ('RTTY',    'RTTY',            'Radioteletype',                                410),
  ('UNKNOWN', 'Unknown',         'Mode not yet identified',                      999)
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      display_order = EXCLUDED.display_order;

------------------------------------------------------------------------------
-- 7. receiver
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.receiver (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text,                              -- 'SDR', 'scanner', 'handheld', etc. (free text)
  lat         numeric,
  lon         numeric,
  location    geography(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN lat IS NULL OR lon IS NULL THEN NULL
      ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
    END
  ) STORED,
  antenna     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid REFERENCES current.app_user(id),
  updated_by_id uuid REFERENCES current.app_user(id)
);

COMMENT ON COLUMN current.receiver.location IS
  E'@omit\nAuto-computed from lat/lon. Hidden from GraphQL; use lat/lon there.';

------------------------------------------------------------------------------
-- 8. transmitter
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.transmitter (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            text NOT NULL,
  lat                             numeric,
  lon                             numeric,
  location                        geography(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN lat IS NULL OR lon IS NULL THEN NULL
      ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
    END
  ) STORED,
  tower_description               text,
  antenna_description             text,
  legacy_funkanlage_id            uuid,            -- soft link, no FK (legacy schema can be rebuilt)
  legacy_funkanlage_name_snapshot text,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by_id                   uuid REFERENCES current.app_user(id),
  updated_by_id                   uuid REFERENCES current.app_user(id)
);

COMMENT ON COLUMN current.transmitter.location IS
  E'@omit\nAuto-computed from lat/lon. Hidden from GraphQL; use lat/lon there.';

COMMENT ON COLUMN current.transmitter.legacy_funkanlage_id IS
  E'Optional uuid of a row in legacy.funkanlage. Intentionally NOT a FK — legacy may be rebuilt by the Python migration. The name snapshot is kept alongside so links survive a rebuild.';

------------------------------------------------------------------------------
-- 9. signal
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.signal (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            text NOT NULL,
  mode_id                         uuid NOT NULL REFERENCES current.mode(id),
  frequency_hz                    bigint NOT NULL,
  bandwidth_hz                    bigint,
  paired_signal_id                uuid REFERENCES current.signal(id) ON DELETE SET NULL,  -- uplink/downlink pair
  transmitter_id                  uuid REFERENCES current.transmitter(id) ON DELETE SET NULL,
  legacy_funkanlage_id            uuid,
  legacy_funkanlage_name_snapshot text,
  notes                           text,
  details                         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- mode-specific: ctcss, color code, NAC, talkgroup, mnc/mcc, …
  first_heard_at                  timestamptz,
  last_heard_at                   timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by_id                   uuid REFERENCES current.app_user(id),
  updated_by_id                   uuid REFERENCES current.app_user(id),
  search_tsv                      tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(legacy_funkanlage_name_snapshot, '')), 'C')
  ) STORED
);

COMMENT ON COLUMN current.signal.details IS
  E'Mode-specific structured fields kept out of the core schema. Examples:\n- TETRA: mnc, mcc, color_code, encryption\n- DMR:   color_code, slot, talkgroup_id\n- P25:   nac, talkgroup_id, encryption\n- analog: subaudible_tone (CTCSS Hz / DCS code), squelch_type\n- pager:  baud, sync_word\nKeep keys snake_case. Promote a field into a column once a pattern stabilizes.';

COMMENT ON COLUMN current.signal.search_tsv IS E'@omit';

------------------------------------------------------------------------------
-- 10. reception — observed instance of a signal at a receiver
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.reception (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id   uuid NOT NULL REFERENCES current.signal(id)   ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES current.receiver(id) ON DELETE RESTRICT,
  heard_at    timestamptz NOT NULL,
  snr_db      numeric,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid REFERENCES current.app_user(id),
  updated_by_id uuid REFERENCES current.app_user(id)
);

------------------------------------------------------------------------------
-- 11. tag + signal_tag (free-form labels for filtering)
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.tag (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  color      text,                              -- optional hex like '#aabbcc'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_id uuid REFERENCES current.app_user(id),
  updated_by_id uuid REFERENCES current.app_user(id)
);

CREATE TABLE IF NOT EXISTS current.signal_tag (
  signal_id uuid NOT NULL REFERENCES current.signal(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES current.tag(id)    ON DELETE CASCADE,
  PRIMARY KEY (signal_id, tag_id)
);

------------------------------------------------------------------------------
-- 12. Audit triggers — attach to every entity table (not app_user, not mode)
------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tg_audit ON current.receiver;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.receiver
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

DROP TRIGGER IF EXISTS tg_audit ON current.transmitter;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.transmitter
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

DROP TRIGGER IF EXISTS tg_audit ON current.signal;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.signal
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

DROP TRIGGER IF EXISTS tg_audit ON current.reception;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.reception
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

DROP TRIGGER IF EXISTS tg_audit ON current.tag;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.tag
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

------------------------------------------------------------------------------
-- 13. Column-level grants — keep audit cols off the inflected mutation inputs
------------------------------------------------------------------------------
-- PostGraphile respects column-level INSERT/UPDATE privileges. Revoking these
-- on the audit columns means they won't appear in `create*` / `update*` input
-- types. The audit trigger still sets them because trigger functions don't
-- check the caller's column-level privs on NEW.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receiver','transmitter','signal','reception','tag']
  LOOP
    EXECUTE format(
      'REVOKE INSERT (created_at, updated_at, created_by_id, updated_by_id) ON current.%I FROM app_authenticated',
      t
    );
    EXECUTE format(
      'REVOKE UPDATE (created_at, updated_at, created_by_id, updated_by_id) ON current.%I FROM app_authenticated',
      t
    );
  END LOOP;
END
$$;

-- (legacy schema comment is set in section 3 when the schema exists)

------------------------------------------------------------------------------
-- 15. Indexes
------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS receiver_location_gist     ON current.receiver    USING gist  (location);
CREATE INDEX IF NOT EXISTS transmitter_location_gist  ON current.transmitter USING gist  (location);
CREATE INDEX IF NOT EXISTS signal_frequency_idx       ON current.signal             (frequency_hz);
CREATE INDEX IF NOT EXISTS signal_mode_id_idx         ON current.signal             (mode_id);
CREATE INDEX IF NOT EXISTS signal_transmitter_id_idx  ON current.signal             (transmitter_id);
CREATE INDEX IF NOT EXISTS signal_search_tsv_gin      ON current.signal      USING gin   (search_tsv);
CREATE INDEX IF NOT EXISTS signal_name_trgm           ON current.signal      USING gin   (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS reception_signal_id_idx    ON current.reception          (signal_id);
CREATE INDEX IF NOT EXISTS reception_receiver_id_idx  ON current.reception          (receiver_id);
CREATE INDEX IF NOT EXISTS reception_heard_at_idx     ON current.reception          (heard_at DESC);
CREATE INDEX IF NOT EXISTS signal_tag_tag_id_idx      ON current.signal_tag         (tag_id);
CREATE INDEX IF NOT EXISTS transmitter_name_trgm      ON current.transmitter USING gin   (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS receiver_name_trgm         ON current.receiver    USING gin   (name gin_trgm_ops);
