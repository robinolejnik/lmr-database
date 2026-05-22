--! Previous: sha1:abd8ef4ead380ef0ece261c9e7e0ddb0189d12a8
--! Hash: sha1:34cdbd398a6db5a73bc6103a56a8ce4737cfda20
--! Message: v2 - bearings + DF geometry helpers (rays, wedges, signal fix)

-- v2 — bearings + direction-finding geometry helpers (Phase 2)
--
-- A `bearing` is one observation of a signal's direction from a receiver
-- at a moment in time. Multiple bearings on the same signal from different
-- receivers cross to localize the transmitter.
--
-- Geometry is computed on demand:
--   * `bearing_ray(b, length_m)`    — geography LineString from receiver
--                                     out along the azimuth, ST_Project'd
--   * `bearing_wedge(b, length_m)`  — geography Polygon (sector) covering
--                                     azimuth ± uncertainty
--   * `signal_fix(s, length_m)`     — JSON fix: pairwise ray intersections,
--                                     centroid, spread (m), bearing count
--
-- The internal geography functions are @omit'd; the matching `*_geojson`
-- variants are what GraphQL exposes (as computed columns on bearing/signal).
-- Idempotent, safe to replay during `gm watch`.

------------------------------------------------------------------------------
-- 1. bearing table
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS current.bearing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       uuid NOT NULL REFERENCES current.signal(id)   ON DELETE CASCADE,
  receiver_id     uuid NOT NULL REFERENCES current.receiver(id) ON DELETE RESTRICT,
  observed_at     timestamptz NOT NULL,
  azimuth_deg     numeric NOT NULL CHECK (azimuth_deg >= 0 AND azimuth_deg < 360),
  uncertainty_deg numeric          CHECK (uncertainty_deg IS NULL OR (uncertainty_deg >= 0 AND uncertainty_deg <= 180)),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid REFERENCES current.app_user(id),
  updated_by_id   uuid REFERENCES current.app_user(id)
);

COMMENT ON TABLE current.bearing IS
  E'Direction-finding observation: an azimuth (deg, 0=N, clockwise) from a receiver toward a signal at a moment in time. Use bearingRayGeojson / bearingWedgeGeojson on this type, and signalFix on the parent signal, to render rays/intersections.';

DROP TRIGGER IF EXISTS tg_audit ON current.bearing;
CREATE TRIGGER tg_audit BEFORE INSERT OR UPDATE ON current.bearing
  FOR EACH ROW EXECUTE FUNCTION current.tg_set_audit();

-- Keep audit columns off the inflected GraphQL Create/Patch input types.
DO $$
BEGIN
  REVOKE INSERT (created_at, updated_at, created_by_id, updated_by_id)
    ON current.bearing FROM app_authenticated;
  REVOKE UPDATE (created_at, updated_at, created_by_id, updated_by_id)
    ON current.bearing FROM app_authenticated;
END
$$;

CREATE INDEX IF NOT EXISTS bearing_signal_id_idx   ON current.bearing (signal_id);
CREATE INDEX IF NOT EXISTS bearing_receiver_id_idx ON current.bearing (receiver_id);
CREATE INDEX IF NOT EXISTS bearing_observed_at_idx ON current.bearing (observed_at DESC);

------------------------------------------------------------------------------
-- 2. bearing_ray — geography LineString from receiver in azimuth direction
------------------------------------------------------------------------------
-- ST_Project takes geography + distance(m) + azimuth(radians, 0=N clockwise).
-- That matches compass bearings exactly, so radians(b.azimuth_deg) is all we
-- need. Default length 50 km — reasonable for VHF/UHF DF on land.

CREATE OR REPLACE FUNCTION current.bearing_ray(b current.bearing, length_m numeric DEFAULT 50000)
RETURNS geography
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN r.location IS NULL THEN NULL
      ELSE ST_MakeLine(
        r.location::geometry,
        ST_Project(r.location, length_m, radians(b.azimuth_deg))::geometry
      )::geography
    END
  FROM current.receiver r
  WHERE r.id = b.receiver_id;
$$;

COMMENT ON FUNCTION current.bearing_ray(current.bearing, numeric) IS
  E'@omit\nInternal helper. Use bearingRayGeojson in GraphQL.';

------------------------------------------------------------------------------
-- 3. bearing_wedge — geography Polygon (sector) for uncertainty wedge
------------------------------------------------------------------------------
-- If uncertainty is null/0, returns the center ray as a degenerate "wedge"
-- (a LineString promoted to geography) so a single layer can render both.

CREATE OR REPLACE FUNCTION current.bearing_wedge(
  b current.bearing,
  length_m numeric DEFAULT 50000,
  arc_steps integer DEFAULT 24
)
RETURNS geography
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r_loc    geography;
  half_unc numeric;
  step     numeric;
  n_steps  integer;
  i        integer;
  pts      geometry[];
BEGIN
  SELECT location INTO r_loc FROM current.receiver WHERE id = b.receiver_id;
  IF r_loc IS NULL THEN
    RETURN NULL;
  END IF;

  half_unc := COALESCE(b.uncertainty_deg, 0);
  IF half_unc <= 0 THEN
    RETURN ST_MakeLine(
      r_loc::geometry,
      ST_Project(r_loc, length_m, radians(b.azimuth_deg))::geometry
    )::geography;
  END IF;

  n_steps := GREATEST(arc_steps, 4);
  step    := (2 * half_unc) / n_steps;
  pts     := ARRAY[r_loc::geometry];
  FOR i IN 0..n_steps LOOP
    pts := array_append(
      pts,
      ST_Project(r_loc, length_m, radians(b.azimuth_deg - half_unc + i * step))::geometry
    );
  END LOOP;
  pts := array_append(pts, r_loc::geometry);

  RETURN ST_MakePolygon(ST_MakeLine(pts))::geography;
END;
$$;

COMMENT ON FUNCTION current.bearing_wedge(current.bearing, numeric, integer) IS
  E'@omit\nInternal helper. Use bearingWedgeGeojson in GraphQL.';

------------------------------------------------------------------------------
-- 4. GeoJSON computed columns (auto-exposed on the Bearing GraphQL type)
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current.bearing_ray_geojson(b current.bearing, length_m numeric DEFAULT 50000)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT ST_AsGeoJSON(current.bearing_ray(b, length_m)::geometry)::jsonb;
$$;

CREATE OR REPLACE FUNCTION current.bearing_wedge_geojson(b current.bearing, length_m numeric DEFAULT 50000)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT ST_AsGeoJSON(current.bearing_wedge(b, length_m)::geometry)::jsonb;
$$;

------------------------------------------------------------------------------
-- 5. signal_fix — pairwise ray intersections + centroid + spread
------------------------------------------------------------------------------
-- Returns JSON of shape:
--   { bearingCount, usedBearings, points, centroid, spreadMeters }
-- - points:       GeoJSON MultiPoint of all pairwise intersection points
-- - centroid:     GeoJSON Point (mean position)
-- - spreadMeters: max geodesic distance from centroid to any intersection
-- - usedBearings: bearings with a usable ray (receiver had a location)
--
-- Quality is "good" when usedBearings >= 3 and spreadMeters is small relative
-- to the operational scale (e.g. < 500 m). The frontend interprets.

CREATE OR REPLACE FUNCTION current.signal_fix(s current.signal, length_m numeric DEFAULT 50000)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pair_pts     geometry;
  centroid     geometry;
  spread_m     numeric;
  n_bearings   integer;
  n_usable     integer;
BEGIN
  SELECT count(*) INTO n_bearings FROM current.bearing WHERE signal_id = s.id;
  IF n_bearings < 2 THEN
    RETURN jsonb_build_object(
      'bearingCount', n_bearings,
      'usedBearings', 0,
      'points',       NULL,
      'centroid',     NULL,
      'spreadMeters', NULL
    );
  END IF;

  WITH rays AS (
    SELECT b.id, current.bearing_ray(b, length_m)::geometry AS ray
    FROM current.bearing b
    WHERE b.signal_id = s.id
  ),
  usable AS (
    SELECT id, ray FROM rays WHERE ray IS NOT NULL
  ),
  pair_geom AS (
    SELECT ST_Intersection(r1.ray, r2.ray) AS geom
    FROM usable r1
    JOIN usable r2 ON r1.id < r2.id
    WHERE ST_Intersects(r1.ray, r2.ray)
  ),
  dumped AS (
    SELECT (ST_Dump(geom)).geom AS pt FROM pair_geom
  )
  SELECT ST_Collect(pt) INTO pair_pts
  FROM dumped
  WHERE ST_GeometryType(pt) = 'ST_Point';

  SELECT count(*) INTO n_usable FROM current.bearing b
    WHERE b.signal_id = s.id AND current.bearing_ray(b, length_m) IS NOT NULL;

  IF pair_pts IS NULL OR ST_NumGeometries(pair_pts) = 0 THEN
    RETURN jsonb_build_object(
      'bearingCount', n_bearings,
      'usedBearings', n_usable,
      'points',       NULL,
      'centroid',     NULL,
      'spreadMeters', NULL
    );
  END IF;

  centroid := ST_Centroid(pair_pts);
  SELECT COALESCE(max(ST_Distance(centroid::geography, geom::geography)), 0)
  INTO spread_m
  FROM (SELECT (ST_Dump(pair_pts)).geom) AS p(geom);

  RETURN jsonb_build_object(
    'bearingCount', n_bearings,
    'usedBearings', n_usable,
    'points',       ST_AsGeoJSON(pair_pts)::jsonb,
    'centroid',     ST_AsGeoJSON(centroid)::jsonb,
    'spreadMeters', round(spread_m, 1)
  );
END;
$$;

COMMENT ON FUNCTION current.signal_fix(current.signal, numeric) IS
  E'Pairwise intersection fix for this signal''s bearings. Returns JSON: { bearingCount, usedBearings, points, centroid, spreadMeters }. Computed on demand — always reflects the current bearing set.';

------------------------------------------------------------------------------
-- 6. Grants
------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION current.bearing_ray(current.bearing, numeric)            TO app_authenticated;
GRANT EXECUTE ON FUNCTION current.bearing_wedge(current.bearing, numeric, integer) TO app_authenticated;
GRANT EXECUTE ON FUNCTION current.bearing_ray_geojson(current.bearing, numeric)    TO app_authenticated;
GRANT EXECUTE ON FUNCTION current.bearing_wedge_geojson(current.bearing, numeric)  TO app_authenticated;
GRANT EXECUTE ON FUNCTION current.signal_fix(current.signal, numeric)              TO app_authenticated;
