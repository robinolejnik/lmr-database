# Vision — LMR Database

## What this is

A personal/internal tool for **tracking radio signals, where they come from,
and where they were heard.** Sits on top of a Postgres database with a
GraphQL API, fronted by a React SPA, gated behind Keycloak SSO.

It exists for two reasons:

1. **Workbench.** Capture signals as you hear them on remote SDRs, document
   what you've figured out about each one (mode, frequency, paired uplinks,
   CTCSS tones, talkgroups, encryption flags), correlate observations across
   multiple receivers, and turn direction-finding bearings into transmitter
   locations.
2. **Reference.** Cross-check live observations against the public BNetzA
   allocation registry (already imported as the read-only `legacy` schema),
   so when a new signal shows up on 159.475 MHz you can immediately see
   what's officially allocated there.

## Users

Single Keycloak realm (`CommSplice` at `auth.commsplice.com`). Every
authenticated user has equal access today — no role gating. If/when
partners need limited access alongside customer products, they get an
account in the same realm with constrained client-level role mappings
(see [CLAUDE.md](CLAUDE.md) → "Auth & Keycloak").

## Domain model

Built around the distinction between a **signal** (persistent, the thing on
a frequency) and a **reception** (one instance of hearing it).

```
mode ─────────┐
              │
receiver ─┐   │            ┌── tag ── signal_tag
          ▼   ▼            │
       reception → signal ─┴── transmitter ─── (optional soft link)
                                                    │
                                                    └── legacy.funkanlage
```

Audit columns (`created_by_id` / `updated_by_id`) on every entity flow
from Keycloak `sub` → `jwt.claims.sub` → trigger → `current.app_user`. No
client code ever sets them.

The future `bearing` table (Phase 2) ties direction-finding rays back to
`(receiver, signal, azimuth, uncertainty)`; intersections are computed,
not stored, so updates to bearings always reflect the latest fix.

## What's built (Phase 1 + 2 — done)

- One Postgres, two schemas: `legacy` (BNetzA, read-only, ~4 M rows from a
  Python migration pipeline) and `current` (read/write, signals etc.).
- graphile-migrate-managed `current` schema. v1 + v2 (bearings) are
  committed; future changes ship via `pnpm migrate:current[:commit]`.
- PostGraphile v5 exposing both schemas. Mutations only on `current` (a
  small `LegacyReadOnlyPlugin` keeps `legacy` SELECT-only).
- Programmatic Express + Grafserv server (`apps/postgraphile/server.mjs`)
  with `jose`-backed JWT verification against Keycloak's JWKS.
  `pgSettings` pushes claims into the Postgres session.
- Vite + React 19 + TanStack Router + urql SPA, Mantine v9 UI shell,
  Keycloak login via `react-oidc-context`, urql auth exchange attaches
  the bearer token per request.
- CRUD pages for `signals` / `receivers` / `transmitters`; legacy
  `antennas` list ported to Mantine.

End-to-end verified: log in → create a receiver → `app_user` row
materializes from JWT claims → `created_by_id` stamped on the new
receiver row.

## What's next

### Phase 2 — Direction finding + map (done)

- `current.bearing` table: `(signal_id, receiver_id, observed_at,
  azimuth_deg, uncertainty_deg, notes)` + audit columns. CASCADE from
  signal, RESTRICT from receiver. Same JWT-stamped audit pattern as the
  rest of `current`.
- SQL helpers on the schema, all `STABLE`:
  - `current.bearing_ray(b, length_m default 50000)` — geography
    LineString from receiver in azimuth direction (`ST_Project`).
  - `current.bearing_wedge(b, length_m, arc_steps)` — geography Polygon
    sector covering azimuth ± uncertainty; degenerates to the ray when
    uncertainty is null/0.
  - `current.bearing_ray_geojson` / `bearing_wedge_geojson` — jsonb
    wrappers exposed by PostGraphile as computed columns on the Bearing
    type.
  - `current.signal_fix(s, length_m)` — pairwise intersection of a
    signal's bearings, returns `{ bearingCount, usedBearings, points,
    centroid, spreadMeters }` (jsonb) on demand. Exposed as `Signal.fix`.
- `/map` route using **MapLibre GL**. Base-layer switcher with
  OpenFreeMap (Liberty / Positron / Dark) and Esri satellite raster;
  defaults to Liberty (theme-independent). Layers: receivers +
  transmitters as markers with popups, bearings as rays +
  semi-transparent uncertainty wedges, receptions as a toggleable
  heatmap, legacy BNetzA antennae as Google-Earth-style teardrop
  placemarks with 3-colour state encoding (green = active, orange =
  expired-by-date, gray = inactive); minzoom drops from 9 to 0 when the
  filtered result count ≤ 10 000.
- Sidebar filters: signal + mode + date range for our own data
  (DateTimePicker); for legacy: state (Active/Inactive checkboxes),
  service segment (MultiSelect from `current.legacy_service_segments`),
  frequency from/to in MHz (unit-normalized against
  `legacy.frequenz.frequenzN_hz` on the server so MHz and GHz compare
  on the same scale). Clicking a bearing on the map navigates to
  `/signals` with the parent signal id in the search params.
- Bearing entry from a modal: pick signal + receiver, observed_at,
  azimuth (0–359.9°), uncertainty (± deg), notes.
- Click a BNetzA pin → modal with antenna detail (height, gain,
  ERP, polarization, address from `legacy.adresse`), the radio
  station, the allocation (number, holder, status pill, dates,
  termination reason inline), and two frequency tables: the
  per-site frequency from `funkanlage.zuordnungfrequenzfunkanlage`
  (with Unterband/Oberband label), plus the full allocation-wide
  frequency list (rows in use at this site highlighted). Every
  frequency row includes system codes (DMR colour code / NXDN RAN /
  P25 NAC / TETRA code) as chips.

### Phase 3 — Media (MinIO)

- MinIO container in `docker-compose.yml`.
- `attachment` table polymorphically linked to `signal` / `transmitter` /
  `receiver` / `bearing` (`target_type` + `target_id`, validated by a
  partial-FK trigger).
- Upload flow: small Express route on the postgraphile server issues
  presigned PUT URLs; browser uploads direct to MinIO; on success, a
  GraphQL mutation records the `attachment` row. Download URLs are also
  presigned and surfaced as a `presignedDownloadUrl` computed field on
  the type.
- UI: drop-zone in transmitter / signal detail pages; gallery view of
  tower / antenna photos.

### Phase 4 — Unified search

- Generated `tsvector` columns + `pg_trgm` GIN indexes across
  `current.signal`, `current.transmitter`, `legacy.funkanlage`,
  `legacy.zuteilung`.
- A single `search(query text, freq_min bigint, freq_max bigint)` SQL
  function returning a union of hits across both schemas with a
  discriminator. Exposed via PostGraphile as a custom query.
- `/search` page + a Cmd-K Spotlight palette (Mantine has this
  first-party as `@mantine/spotlight`).
- Frequency-range search treated as a first-class input
  (e.g. `144.000–146.000 MHz`).

## Beyond Phase 4 (loose ends, no commitment)

- **Sharing / collaboration.** Tag groups, "watch this signal", maybe
  per-signal visibility if the partner-access case materialises.
- **Auto-decoded metadata.** Pipe a TETRA decoder's output (NWK ID,
  encryption flag, talkgroup) into reception notes automatically.
- **Bearing intake API.** Accept bearings via REST/MQTT from SDR-side
  scripts (KrakenSDR-style) instead of typing them in.
- **Time-series of observations.** Per-signal activity calendar, "heard
  X times in the last 30 days, last seen at …".
- **Background SDR control.** Tune a remote SDR and capture a clip
  directly from the signal detail page. (Probably never; the SDR
  control surface is its own product.)

## Non-goals

- **Not a public service.** Internal tool, behind SSO, no anonymous
  access.
- **Not a transmitter database for the world.** We import BNetzA as
  static reference; we don't try to keep it live-synced.
- **Not a decoding stack.** Receivers + decoders run elsewhere; this
  tool only stores observations.
- **Not multi-tenant.** Single org, single realm, single deployment.
- **Not optimised for mobile-first.** Desktop-primary; mobile is "must
  not break".

## Stack at a glance

| Layer | Choice |
|---|---|
| DB | Postgres 17 + PostGIS 3.5 |
| Migrations | `graphile-migrate` (current schema); Python xlsx → COPY pipeline (legacy) |
| GraphQL | PostGraphile v5 (programmatic Express + Grafserv) |
| Auth | Keycloak `CommSplice` realm, OIDC + PKCE, `lmr-database` client |
| Frontend | Vite + React 19 + TypeScript + TanStack Router + urql + Mantine v9 |
| Media (Phase 3) | MinIO + presigned URLs |
| Map (Phase 2) | MapLibre GL JS |
| Hosting | Docker Compose on a single Linux host today; dev access via VSCode Remote port-forwarding |

## Where things live

- **Why-decisions + gotchas:** [CLAUDE.md](CLAUDE.md)
- **`current` schema:** [db/migrations/](db/migrations/) (committed migrations are immutable)
- **Legacy import:** [tools/migration/](tools/migration/)
- **GraphQL server:** [apps/postgraphile/](apps/postgraphile/)
- **Frontend:** [apps/web/](apps/web/)
- **Keycloak client config:** [keycloak/](keycloak/)
