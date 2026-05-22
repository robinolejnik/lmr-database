# CLAUDE.md

Operating notes for Claude Code sessions in this repo. The general docs are
in [README.md](README.md) and per-package READMEs; this file captures the
parts that aren't obvious from reading the code — conventions, gotchas, and
the *why* behind decisions that have already been made.

> **Keep this file fresh.** Update CLAUDE.md (and the project memory) in the
> same turn whenever a decision is made, a convention is established, a
> gotcha is hit, or requirements change. Don't wait to be asked.

---

## What this repo is

A monorepo for a **radio frequency database** — signal observations,
receivers, transmitters, direction finding — plus a read-only window onto an
existing allocation registry (BNetzA data already imported into the `legacy`
schema). Three "apps":

| Area | Path | Purpose |
|---|---|---|
| Migration | [tools/migration/](tools/migration/) | One-time but **re-runnable** Python pipeline: xlsx → Postgres |
| Backend   | [apps/postgraphile/](apps/postgraphile/) | PostGraphile v5; auto-generated GraphQL from the DB |
| Frontend  | [apps/web/](apps/web/) | Vite + React 19 + TanStack + urql SPA |

Source data: [data/a.xlsx](data/a.xlsx), [data/b.xlsx](data/b.xlsx) (~660 MB, gitignored). 31 sheets, ~4 M rows total.
Generated DDL: [db/init/](db/init/).

---

## Architecture decisions (already made — don't re-litigate)

1. **One Postgres, two schemas.** `legacy` (populated) and `current` (planned,
   read/write). Picked over two-DB split because cross-schema joins + FK
   constraints from `current → legacy` matter. Reversible if requirements change.
2. **One PostGraphile instance** serves both schemas. Two-instance mode was
   considered and parked; see [apps/postgraphile/README.md](apps/postgraphile/README.md)
   for how to split later.
3. **PostGraphile, not custom backend.** Postgres functions for write logic when
   it gets complex. NestJS/Next.js only if PostGraphile genuinely fails us.
4. **Vite SPA, not Next.js.** Internal data tool — no SEO, no SSR need.
5. **pnpm workspaces, no Turborepo.** Add later only if needed.
6. **German names preserved in the legacy DB schema only.** Table and column
   names in the `legacy` schema stay German (with `bnetza_` stripped) because
   that's how the data was authored. **Everything else is English** — all
   frontend code, UI copy, route paths, comments, new schema (`current`),
   variable names, log messages. The only place German appears outside the
   schema is in *data values* that were imported as German content.
7. **Frontend is desktop-primary but must work well on mobile**, and must ship
   a **dark theme**. Design for desktop first (that's where the user works),
   then verify the layout adapts cleanly to a narrow viewport. Don't design
   mobile-first.
8. **Auth via the existing Keycloak realm `CommSplice`** at
   `https://auth.commsplice.com/`. Public OIDC client (`lmr-database`) with
   PKCE; no client secret. Single realm shared with other CommSplice apps —
   *not* split into employees/customers realms. Any authenticated user has
   equal access (no role gating yet). Client config lives in
   [keycloak/lmr-database-client.json](keycloak/lmr-database-client.json);
   see [keycloak/README.md](keycloak/README.md) for the full story.
9. **Local dev URL is `http://localhost:5173`**, reached from the
   workstation via VSCode Remote port-forwarding. Dev servers bind to
   localhost on the linux box (no LAN exposure). PKCE requires a secure
   context, which `localhost` qualifies for; arbitrary LAN IPs do not.
10. **Map basemaps come from OpenFreeMap** (vector tiles, OSM-derived,
    free + no key) with a pluggable base-layer switcher. OpenStreetMap's
    own tile server is **not** an option — its tile-usage policy
    explicitly forbids use as an app basemap. `BASE_LAYERS` in
    [apps/web/src/lib/mapStyles.ts](apps/web/src/lib/mapStyles.ts) is
    the single source of truth; add MapTiler / Mapbox / Google by
    appending one entry. ESRI World Imagery is wired as the satellite
    option. Default is `openfreemap-liberty` regardless of theme
    (`DEFAULT_BASE_LAYER` in the same module).
11. **Geometry over GraphQL = jsonb wrappers, not raw geography.** v5
    has no PostGIS plugin yet; the same `@omit` rule that hides
    `receiver.location` also hides the internal `bearing_ray` /
    `bearing_wedge` functions. The GraphQL surface is the matching
    `_geojson` variants returning jsonb. The Bearing type ends up with
    `rayGeojson(lengthM)` / `wedgeGeojson(lengthM)` as computed columns;
    the Signal type gets `fix(lengthM)`. Use this same pattern for any
    future spatial computed field.

If the user proposes changing any of these, push back gently — the trade-offs
were discussed and chosen deliberately.

---

## Schema conventions

Read these before suggesting any DB change.

- **Source convention** (in the xlsx, before transform):
  - PK: `bnetza_zfd_<tablename>id` (uuid)
  - FK: `bnetza_<targettable>` (uuid) + denormalized `bnetza_<targettable>name` (text)
  - Junction-table FKs use `bnetza_zfd_<x>id` form
  - Audit cols: `createdby`, `modifiedby`, `ownerid`, `owningbusinessunit`, `owningteam` (uuids pointing to user/team tables **not in the export** — kept as plain uuid with NO FK constraint)
  - OptionSet enums: integer code (e.g. `602540002`) + paired `<col>name` text label (e.g. "MHz")
  - Booleans paired with `<col>name` containing "Ja"/"Nein"
  - Timestamps in pairs: local + `<col>utc`

- **After migration** (in Postgres `legacy` schema):
  - PK → `id` (uuid)
  - FK columns get `_id` suffix (e.g. `funkanlage_id`) so they don't collide with the auto-generated relation field of the same name in GraphQL
  - `bnetza_` prefix stripped everywhere
  - UTC twin kept (renamed to the base name), local twin dropped
  - Ja/Nein label twins dropped (bool says enough)
  - Always-empty CRM cols dropped (`createdonbehalfby*`, `overriddencreatedon*`, `importsequencenumber`, `*yominame`, `timezoneruleversionnumber`, `utcconversiontimezonecode`, `owneridyominame`, `owninguser`)
  - OptionSet code + label both kept
  - FK label columns (`<x>name`) both kept (user table missing → label is the only useful info)
  - `antenne` deg/min/sec → `lat numeric`, `lon numeric`, `location geography(Point,4326)` (location hidden from GraphQL via `@omit`)
  - 9-digit identifier columns stripped of spaces: `"100 001 123"` → `"100001123"` (see `STRIP_SPACES_IN_VALUES` in [tools/migration/config.py](tools/migration/config.py))

---

## Language rule

- **Legacy DB schema:** German identifiers, by design. GraphQL field names
  reflect this (e.g. `Antenne.nordgrad`, `funkanlage_id`, `Zuteilung.fachschluessel`).
  Don't translate them.
- **Everything else:** English. Includes:
  - All frontend code & UI copy (nav, buttons, page titles, table headers,
    error messages, empty-state text, etc.).
  - All Python/TS variable names, comments, log lines.
  - Route paths (e.g. `/antennas`, not `/antennen`).
  - The future `current` schema's table & column names.
- **Displaying legacy entities in the UI:** translate the *labels* to English
  ("Antenna", "Allocation", "Radio station", "Frequency", "Height", …) but
  keep the *data values* unchanged (they are German content from the source).
  If a translation is ambiguous for a domain term, ask before guessing — keep
  a glossary in this file as it grows.

### Glossary (extend as the UI grows)

| German (DB) | English (UI) |
|---|---|
| antenne | antenna |
| funkanlage | radio station |
| zuteilung | allocation |
| frequenz | frequency |
| zuteilungsnummer / fachschluessel | allocation number (the 9-digit string PK-equivalent, e.g. `027013362`) |
| zuteilungsinhaber(name) | (allocation) holder |
| verwendungszweck | purpose |
| dienstsegment(name) | service segment |
| funkversorgungsgebiet | coverage area |
| rufnamefunknetz | network call sign |
| ausstellung / wirksam / befristung / beendigung | issued / effective from / expires / terminated |
| hoehe / hoeheuebergrund | height (above ground) |
| hoeheuebermeeresspiegel | height (above sea level) |
| nordgrad / ostgrad | latitude / longitude (degree component) |
| azimut | azimuth |
| polarisation(name) | polarization |
| gewinn (+ einheitname) | antenna gain (+ unit) |
| senderausgangsleistung | transmitter output power |
| strahlungsleistung | radiated power (ERP) |
| ortsbeschreibung | site description |
| kanal / kanalbandbreite | channel / channel bandwidth |
| zuordnungfrequenzfunkanlage | junction: which frequencies the radio station actually uses (a subset of its allocation's frequencies) |
| frequenzpaarauswahl(name) | which side of a duplex pair this station is on — "Unterband" (lower, f1) / "Oberband" (upper, f2). German term has no precise English equivalent; kept verbatim in the UI |
| systemcode / systemcodes | system code (DMR color code, NXDN RAN, P25 NAC, TETRA code, etc., depending on mode). Stored both as a many-to-many via `legacy.frequenzsystemcode` AND as a comma-separated text snapshot on `legacy.frequenz.systemcodes` ("01, 02, 03"). The denorm snapshot is what the map modal renders — split on `[,\s]+` and chip per value |
| modulationsverfahren(name) | modulation |
| sendeart / sendearten | emission type(s) — e.g. `7K60F7W` |
| betriebsart / betriebsarten | operating mode(s) — e.g. `Semiduplex` |
| uebertragungsart | transmission type |
| kategorie(name) | category |
| art(name) | type |
| adresse | address (a funkanlage may have several `Adresse` rows; fields: `strasse` / `postleitzahl` / `ort` / `ortsbeschreibung`) |
| strasse / postleitzahl / ort | street / postal code / city |

## Auth & Keycloak

- **Realm:** `CommSplice` at `https://auth.commsplice.com/`. Issuer URL is
  case-sensitive — `…/realms/CommSplice`, not lowercase.
- **Client:** `lmr-database`. Public, PKCE-only, no secret. Definition lives
  in [keycloak/lmr-database-client.json](keycloak/lmr-database-client.json)
  and is the source of truth — edit the file, re-import in Keycloak.
- **Trusted origins** (both in the client JSON):
  - Production: `https://lmrdb.commsplice.com`
  - Local dev:  `http://localhost:5173` (reached from the workstation via
    VSCode Remote port-forwarding to the linux dev box)
- **Redirect URIs are derived at runtime** from `window.location.origin` in
  [apps/web/src/auth/oidcConfig.ts](apps/web/src/auth/oidcConfig.ts), so the
  same SPA works on any registered origin without a rebuild.
- **Secure-context restriction:** `crypto.subtle` (needed for PKCE) is only
  exposed on HTTPS or `localhost`/loopback. Use `http://localhost:…` for
  local dev; HTTP on a LAN IP will break login with "Crypto.subtle is
  available only in secure contexts".
- **Tokens:** access tokens carry `aud: lmr-database` (forced by an audience
  mapper, since Keycloak doesn't add it automatically for public clients).
  PostGraphile verifies against this audience.
- **Identity → DB:** PostGraphile pushes `jwt.claims.sub` (and other claims)
  into `pgSettings`; a trigger upserts `current.app_user` keyed by
  `keycloak_sub` and stamps `created_by_id`/`updated_by_id`. **Never** set
  those audit columns from the client.

When extending: see "Adding a new environment" in
[keycloak/README.md](keycloak/README.md). Don't fork the JSON per
environment — one client trusts all origins.

## Frontend requirements

- **Desktop-primary, mobile-works.** The user works on desktop; that's the
  design target. But the app also has to look and behave correctly on a
  phone-sized viewport — no horizontal scroll, no broken layouts, no
  tap-targets-too-small. Verify on a narrow viewport before calling a UI task
  done, but don't sacrifice desktop density to make mobile "first".
- **Dark theme.** The app must support a dark theme and (ideally) follow
  `prefers-color-scheme` by default with a manual toggle override. Persist
  the user's choice in localStorage.
- **Implementation isn't decided yet.** Likely path: CSS variables for theme
  tokens + a small Theme context. If a UI library gets added later
  (e.g. shadcn/ui, Mantine, Park UI), document that decision here.
- The current scaffolded routes (`/antennen`) use a raw `<table>` that won't
  adapt to narrow viewports — replace with a responsive list/card layout
  when the feature gets real attention.

## Where to edit what

| If you need to... | Edit... |
|---|---|
| Add/remove dropped columns | `GLOBAL_DROP` in [tools/migration/config.py](tools/migration/config.py) |
| Override a column's type | `TYPE_OVERRIDES` in [tools/migration/config.py](tools/migration/config.py) |
| Add an FK constraint | `FK_MAP` in [tools/migration/config.py](tools/migration/config.py) |
| Change PK detection | `PK_BY_TABLE` in [tools/migration/config.py](tools/migration/config.py) |
| Combine columns into a geo point | `GEO_COMBINE` in [tools/migration/config.py](tools/migration/config.py) |
| Normalize a (value, unit-label) pair into a `_hz` column | `HZ_NORMALIZE` + `UNIT_MULTIPLIERS` in [tools/migration/config.py](tools/migration/config.py) |
| Add a legacy index for PostGraphile filter exposure | `LEGACY_FILTER_INDEXES` in [tools/migration/config.py](tools/migration/config.py) (NOT in graphile-migrate) |
| Re-grant a legacy schema/role | [db/init/03_legacy_grants.sql](db/init/03_legacy_grants.sql) (idempotent, applied by load.py) |
| Strip spaces from a value column | `STRIP_SPACES_IN_VALUES` in [tools/migration/config.py](tools/migration/config.py) |
| Per-table source→PG rules | [tools/migration/transform.py](tools/migration/transform.py) |
| DDL generation | [tools/migration/build_schema.py](tools/migration/build_schema.py) |
| Extraction logic | [tools/migration/extract.py](tools/migration/extract.py) |
| Postgres load orchestration | [tools/migration/load.py](tools/migration/load.py) |
| GraphQL config | [apps/postgraphile/graphile.config.mjs](apps/postgraphile/graphile.config.mjs) |
| Routes (frontend) | [apps/web/src/routes/](apps/web/src/routes/) — TanStack file-based routing |
| Keycloak client (auth) | [keycloak/lmr-database-client.json](keycloak/lmr-database-client.json) — re-import into the `CommSplice` realm after edits |

**Always:** after editing `config.py`, re-run `build_schema.py` → `extract.py` → `load.py --clean`. Or just `pnpm migrate:clean` from the repo root.

---

## Running things

```bash
# Postgres + PostGraphile in docker
pnpm db:up           # just postgres
pnpm graphql:up      # rebuild + start postgraphile
pnpm stack:up        # both

# Migration (Python)
pnpm migrate         # preserves existing data
pnpm migrate:clean   # drops the legacy schema first

# Frontend
pnpm install
pnpm dev             # vite at localhost:5173, proxies /graphql to :5050
                     # VSCode Remote auto-forwards both ports to the workstation
pnpm --filter web codegen   # regenerate typed graphql client (needs postgraphile running)

# Direct DB access
pnpm db:psql         # opens psql in the lmr-postgres container
```

The Python `.venv` lives at [tools/migration/.venv](tools/migration/.venv). The migration scripts use it directly; there's no global venv.

---

## Gotchas discovered the hard way

- **PostGraphile v5 CLI is `dist/cli-run.js`, not `dist/cli.js`.** The latter exists but is a different entry point. `--help` is silent unless `GRAPHILE_ENV=development` is set.

- **FK column name = relation name → silent type collapse.** PostGraphile + simplify-inflection auto-generates a relation field with the same name as the FK column ⇒ "Expected an output type … was not successfully constructed". Fix: every FK column gets `_id` suffix in [transform.py](tools/migration/transform.py:plan_table).

- **PostGIS in v5 has no v5-compatible preset yet.** The existing `@graphile/postgis@0.2.0` is v4-only. Workaround: synthesize `lat`/`lon` numerics + hide raw `geography` column from GraphQL via `@omit` smart comment. PostGraphile auto-exposes the numerics natively.

- **Smallint via sampling is dangerous.** The analyzer used to default int columns to `smallint` when the sampled range fit; real data exceeded smallint range later in the workbook. Now defaults to `integer` always — see [analyze.py:guess_type](tools/migration/analyze.py).

- **Junction-table FK columns need both prefixes stripped AND `_id` appended.** Source `bnetza_zfd_frequenzid` → `frequenz_id`. The `_ZFD_ID_RE` regex in [config.py](tools/migration/config.py) handles it.

- **Many-to-many plugin causes naming collisions.** Dynamics denormalizes labels into text columns like `frequenz.uebertragungsarten`, which collides with the auto-generated m2m relation of the same name. Plugin is intentionally NOT installed; junction-table relations stay navigable from each side individually.

- **Audit FK columns point to missing tables.** `createdby`, `modifiedby`, `ownerid`, `owningbusinessunit`, `owningteam`, `modifiedonbehalfby`, `createdonbehalfby` reference user/team tables that aren't in the export. Don't add FK constraints for them — they stay as plain uuid. The `*name` companion columns are the only useful info.

- **`pnpm-workspace.yaml` allowBuilds.** Some pre-write hook appends a placeholder `allowBuilds: esbuild: set this to true or false` block. The valid form is:
  ```yaml
  allowBuilds:
    esbuild: true
  ```
  Don't fight the hook — write it correctly the first time.

- **The Excel files contain non-breaking spaces (U+00A0).** E.g. `ortsfeste Funkanlage 001 / 01`. They're preserved in the data — don't strip them as part of normalization.

- **9-digit identifiers (`027 013 362`)** must stay as `text` even though they look numeric — the leading zero is significant. The `INT_RE` in [analyze.py](tools/migration/analyze.py) explicitly rejects leading-zero strings.

- **`docker restart` doesn't rebuild the image** — and `apps/postgraphile/Dockerfile` `COPY`s `graphile.config.mjs` + `server.mjs` at build time. So changes to those files don't take effect on plain restart; you need `docker compose up -d --build postgraphile`. Solved permanently by bind-mounting both files in [docker-compose.yml](docker-compose.yml) (volumes block on the postgraphile service). After that, `docker restart` is enough for code changes; rebuild only needed for npm deps or Dockerfile edits.

- **graphile-migrate `reset --erase` drops the entire database.** Not just the `current` schema, not just the `graphile_migrate` metadata — the whole DB, including `legacy`. If you genuinely want a clean current schema reset, use `DROP SCHEMA current CASCADE` via psql instead and re-run `pnpm migrate:current` (which will fall through to `gm watch --once` semantics).

- **Unscoped behavior tokens are dangerous.** In `graphile.config.mjs`, never write `defaultBehavior: "-insert -update -delete"`. The bare `-insert` matches **both** `resource:insert` (kills the Create mutation) **and** `attribute:insert` (makes every Patch input type empty). Two distinct failure modes from one line. If you need to gate mutations, either omit `defaultBehavior` entirely (amber's per-plugin defaults already do the right thing for `current`) or use scoped tokens like `-resource:insert`. Locking down `legacy` is done via the `LegacyReadOnlyPlugin` in [apps/postgraphile/graphile.config.mjs](apps/postgraphile/graphile.config.mjs).

- **Audit FK columns must end in `_id`.** Same gotcha as legacy FKs above — `current.signal.created_by` (uuid FK) would collide with the auto-inflected relation field `createdBy`. Always `created_by_id` / `updated_by_id` in the `current` schema. The audit trigger sets them, the column-level GRANT REVOKE keeps them off the inflected mutation input types.

- **`postgraphile` runs with `network_mode: host`** because `auth.commsplice.com` is only routable via IPv6 on this network and docker's default bridge has no IPv6. Symptom if you ever undo this: `[jwt] rejected: ECONNREFUSED` in postgraphile logs whenever a real bearer token comes in. Side-effects of host networking: no `ports:` mapping (the container shares the host's network), `DATABASE_URL` uses `127.0.0.1:5432` (not the bridge alias `postgres:5432`), and `server.mjs` binds to `127.0.0.1` directly. `lmr-postgres` stays on the default bridge — that's fine, the host can reach it via the loopback mapping it publishes.

- **`orderBy` enums AND `<Type>Filter` inputs only include indexed columns.** PostGraphile v5's `PgIndexBehaviorsPlugin` gates both `attribute:orderBy` and (via the connection-filter plugin) `attribute:filterBy` on the presence of a backing btree/gin/unique index. So `currentReceiver`'s `NAME_ASC` works (trigram GIN on `name`) but legacy.antenne had no index on `lat`/`lon` → no `lat`/`lon` in `AntenneFilter` (silent — the field just isn't there). Symptom: bbox queries 400 with `Field "lat" is not defined by type "AntenneFilter"`. Add a plain btree index in the migration and the field appears after a PostGraphile restart. Migration 000003 adds the `legacy.antenne` lat/lon indexes for exactly this; keep that pattern for future maps over other legacy tables.

- **Keycloak 25+ moved the `sub` claim from `openid` to a separate `basic` scope.** If `basic` isn't in the client's default client scopes, access tokens come out with `email`, `preferred_username`, etc. but **no `sub`** — and our `pgSettings` fallback then keys `app_user` by email instead of the canonical subject. [keycloak/lmr-database-client.json](keycloak/lmr-database-client.json) lists `basic` in `defaultClientScopes`; if you re-import or hand-edit, keep it there. Symptom if missing: every authenticated request hits `app_anonymous` (and "permission denied for schema current") even though the JWT verified fine.

- **`postgraphile-plugin-connection-filter` forbids null literals inside `filter`.** Writing `filter: { observedAt: { greaterThanOrEqualTo: $from } }` and passing `$from = null` produces "Null literals are forbidden in filter argument input." at the top of every authenticated query and zero rows back. Build the filter object client-side and only include the fields that actually have values; pass the whole filter as a typed variable (e.g. `CurrentBearingFilter`) or omit the argument. See [apps/web/src/routes/map.tsx](apps/web/src/routes/map.tsx) `bearingFilter` / `receptionFilter`.

- **`ST_Project` is geodesic; `ST_Intersection` is planar.** `bearing_ray` projects the rays correctly along a great circle (geography), but `signal_fix` then casts to geometry and intersects in lat/lon space. Over a 50 km ray at mid-latitudes that introduces a small offset (a few hundred metres) between rays computed from planar test bearings and the great-circle endpoint. For real DF entries (where users type the compass azimuth they observed) the function is correct — it's only the *synthesis* of a test bearing from a known target that needs care. If we ever need sub-100 m fix precision across long baselines, project everything into a local CRS (e.g. UTM zone of the centroid) before intersecting.

- **`setStyle({ diff: false })` wipes custom MapLibre layers AND images.** The official mechanism to preserve custom state across a base-layer swap is the `transformStyle` option (documented on `StyleSwapOptions` in `maplibre-gl.d.ts:7158`: *"a convenience function that allows to modify a style after it is fetched but before it is committed"*). Pass `transformStyle: (prev, next) => mergedStyle` and splat your custom sources / layers from `prev` into `next` — MapLibre then commits the merged style atomically and your overlays are part of the new style from the start. Re-implementing the sources/layers after the fact via `styledata` listeners is unreliable (the event fires repeatedly during a swap and after every source-data change; there is **no** `style.load` event despite some examples implying there is — only `styledata`, `styledataloading`, `load`, and `idle`). For the things `transformStyle` *can't* preserve (images aren't in `StyleSpecification`), use `map.once("idle", …)` after `setStyle`: the `idle` event (`maplibre-gl.d.ts:9624`) fires once the map is fully settled (no in-flight tiles or transitions), at which point `addImage` reliably takes effect. Working example in [apps/web/src/components/MapCanvas.tsx](apps/web/src/components/MapCanvas.tsx) — the baseLayer useEffect calls `setStyle` with a `transformStyle` that copies custom sources + layers, and a `once("idle")` that runs `ensurePinImages` + `applyAndSyncAll`. The `styleimagemissing` handler is kept as a backup but isn't load-bearing. For per-feature icon variants (e.g. the 3-colour legacy-antenna pins), pre-declare a `LEGACY_PIN_IMAGE_IDS` map, encode the variant id on each GeoJSON feature as a `pinId` property, and use `"icon-image": ["coalesce", ["get", "pinId"], <default>]` in the layout.

- **The legacy schema is owned by the Python pipeline. Period.** Don't add columns, indexes, grants, or any DDL to `legacy.*` from graphile-migrate. They survive in the live DB but vanish on the next `pnpm migrate:legacy:clean`, because:
  1. graphile-migrate tracks committed migrations by hash in `graphile_migrate.migrations` and re-running `pnpm migrate:current` after a legacy wipe is a no-op (already applied).
  2. The Python pipeline drops + recreates legacy and only knows about the files under `db/init/`.
  Therefore everything legacy-touching belongs in the Python pipeline:
  - **New columns** → `config.py:HZ_NORMALIZE` (or a similar declarative config) + plan handling in `transform.py` + per-row write in `extract.py`. The `frequenz1_hz`/`frequenz2_hz` unit-normalized columns follow this pattern.
  - **Indexes for filter exposure** → `config.py:LEGACY_FILTER_INDEXES` (table → [columns]), emitted from `build_schema.py:build_filter_indexes` into `db/init/02_constraints.sql`.
  - **Roles/grants/schema comments** → `db/init/03_legacy_grants.sql` (hand-written, idempotent, role-existence-guarded), applied by `load.py` after constraints.
  Migrations `000003` and `000004` still exist (committed migrations are immutable) but their legacy-touching content is now duplicated by the Python pipeline and effectively dead — they were the source of the original sin. **If you find yourself writing `ALTER TABLE legacy.*` or `GRANT … ON SCHEMA legacy` in a graphile-migrate migration, stop. Wrong place.**

- **All `CREATE INDEX` in `02_constraints.sql` uses `IF NOT EXISTS`.** Lets `load.py` re-apply that file without `--clean` for the index-only sections. PKs/FKs are not idempotent (`ALTER TABLE … ADD CONSTRAINT`); for a partial refresh, apply just the indexes you need by hand. The `IF NOT EXISTS` form also makes the file safe to run from `pnpm db:psql` for ad-hoc fix-ups.

- **`pnpm migrate:legacy:clean` drops only the `legacy` schema** — gm's `graphile_migrate.migrations` (and the `current` schema, app roles, app_user data) are untouched. Conversely `pnpm migrate:current` doesn't touch `legacy`. To do a true "wipe and reproduce from scratch" test: `DROP SCHEMA legacy / current / graphile_migrate CASCADE; DROP OWNED BY app_*; DROP ROLE app_*; DROP DATABASE lmr_shadow;` then `pnpm migrate:current` followed by `pnpm migrate:legacy:clean`. Verified working as of v5 (this commit) — `legacy.frequenz.frequenz1_hz`, all filter indexes, all grants, all current.* functions come back.

- **Auto-update CLAUDE.md in the same turn — really.** The project's top-of-file rule and the agent's project memory both say so, and the failure mode is the same every time: ship the feature, skip the doc update, hit the same gotcha six prompts later from a clean session. Triggers that mean "stop and document": (a) the user pushes back on an approach; (b) a redo misses something subtle (grants vanishing on re-import is a textbook example); (c) "huh, that's not what I expected" while debugging; (d) discovering a layering rule about where some kind of change belongs. Add to "Gotchas" or "Architecture decisions" — don't bundle for later, don't wait to be asked.

- **Consult docs / installed typings before guessing API names.** For npm packages, `node_modules/<pkg>/dist/*.d.ts` (or the package's `types` entry) is the authoritative source for events, options, and signatures — it has the same JSDoc the project's website renders, right there on disk. Use WebFetch on official docs pages for examples, but cross-check any specific name (event, method, option) against the typings before trusting it; the WebFetch summarizer is a small model and will cheerfully hallucinate plausible-sounding names. When citing facts about an API in a fix, link to the typing file with line numbers (e.g. `maplibre-gl.d.ts:7158`) so the next session can verify without re-spelunking. Source-code grepping is a last resort, *after* the docs are exhausted — not a substitute for reading them.

- **`react-oidc-context`'s `onSigninCallback` only strips query params — it does not navigate.** After Keycloak redirects back to `/auth/callback?code=…&state=…`, AuthProvider fires `onSigninCallback` to clean the URL, but the user is still on the `/auth/callback` *route* and the route component just shows a spinner. Result: user sits staring at "Signed in." forever. Fix is in [apps/web/src/routes/auth.callback.tsx](apps/web/src/routes/auth.callback.tsx) — a `useEffect` that calls TanStack's `navigate({ to: "/", replace: true })` once `auth.isAuthenticated && !auth.isLoading`. Don't do the navigate inside `onSigninCallback` itself — that runs at the AuthProvider level, outside any router context.

- **Both schemas are authenticated-only as of v5.** `app_anonymous` has zero data access — no USAGE on `legacy` or `current`, no SELECT on any table. Unauthenticated GraphQL requests can introspect the schema but every data field returns "permission denied". Earlier versions of this repo (gm v1) granted SELECT on `legacy.*` to `app_anonymous` — that's been revoked. Two enforcement points:
  - graphile-migrate `000005-v5-lock-legacy-schema-down-to-authenticated-users-only.sql` does the revoke once (cleans up old DBs).
  - [db/init/03_legacy_grants.sql](db/init/03_legacy_grants.sql) only grants to `app_authenticated` and defensively REVOKEs from `app_anonymous`, so every `pnpm migrate:legacy:clean` keeps the door shut.
  If you ever need a public-readable surface, do not loosen the legacy grants — expose a specific PostGraphile resolver or a SECURITY DEFINER function instead.

- **`@mantine/dates` needs its own CSS.** It ships `@mantine/dates/styles.css` separately from `@mantine/core/styles.css`. Forgetting it loads the components unstyled. Imported at the top of [apps/web/src/routes/map.tsx](apps/web/src/routes/map.tsx); move to [main.tsx](apps/web/src/main.tsx) if it becomes used in multiple routes.

- **Escaping AppShell padding for a full-bleed route.** The map page wants to fill the entire content area; AppShell's `padding="md"` leaves a gutter. Use `margin: calc(-1 * var(--app-shell-padding))` + `height: calc(100dvh - var(--app-shell-header-height, 56px))` on the route's root. Both CSS variables are set by Mantine's AppShell at runtime.

---

## Don't do these things

- Don't enable mutations on the `legacy` schema. It's locked down by the
  `LegacyReadOnlyPlugin` in [apps/postgraphile/graphile.config.mjs](apps/postgraphile/graphile.config.mjs) — a tiny custom plugin that adds
  `-resource:insert/update/delete` to any `pgResource` whose codec lives in
  `legacy`. Don't be tempted to use a schema-level `@behavior` smart comment
  instead — unscoped tokens break Patch types (see Gotcha above).
- Don't add FK constraints to tables that aren't in the export
  (`systemuser`, `team`, `businessunit`). They'll error.
- Don't drop the `*name` denormalized label columns. They're snapshots of the
  related entity's display name at export time and are the only way to get
  human-readable info for user/team references.
- Don't try to convert OptionSet codes (e.g. `602540002`) to enums. The codes
  are opaque Dynamics internals; the label columns are what humans read.
- Don't rebuild the schema without also re-running extract — they have a
  contract via [tools/migration/plans.json](tools/migration/plans.json) and
  must agree on the column list & order.

---

## Verified state (last full run)

- 31 tables, **4 005 538 rows** loaded in ~20 s via COPY
- 34 FK constraints active, 0 orphans
- 78 689 antennas: 78 257 with realistic German coordinates, 429 at (0°,0°), 0 NULL
- Total schema size: **1.64 GB**
- GraphQL FK traversal verified end-to-end (`antenne → funkanlage → … → zuteilung`)

---

## When stuck

1. Re-read [tools/migration/config.py](tools/migration/config.py) — that's the single source of truth.
2. Re-run the summarizer to see fresh column stats: `cd tools/migration && .venv/bin/python summarize.py`.
3. Check `git log -- tools/migration/config.py` for prior decisions and the reasoning that lived in commit messages.
4. PostGraphile logs: `pnpm graphql:logs`. "Could not build PgCodec" warnings about `geography` are expected and harmless.
