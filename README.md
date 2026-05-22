# lmr-database

Monorepo for a radio frequency database: track signals, receivers, transmitters,
and direction-finding observations. Includes a read-only window onto an existing
allocation registry for cross-reference, fronted by a React UI.

```
lmr-database/
├── apps/
│   ├── postgraphile/         # GraphQL service (PostGraphile v5, both schemas)
│   └── web/                  # React frontend (Vite + TanStack + urql)
├── tools/
│   └── migration/            # Python one-time importer (xlsx → Postgres)
├── db/
│   └── init/                 # Generated DDL applied to Postgres on boot
├── data/                     # Source xlsx files (gitignored)
├── docker-compose.yml        # postgres (PostGIS) + postgraphile
├── pnpm-workspace.yaml
└── package.json
```

## Architecture in one paragraph

One **Postgres** instance with two schemas: `legacy` (read-only, already
populated by the migration) and `current` (planned, read/write for new data).
A single **PostGraphile** v5 instance exposes both schemas as one GraphQL API
at `:5050/graphql`. Legacy mutations are disabled via smart comments; the
frontend connects as a Postgres role that has `SELECT` on `legacy` and full DML
on `current`. The React frontend is a Vite SPA — no Node runtime in
production, just static files served from nginx alongside Postgres.

Two databases or two PostGraphile instances were considered and rejected:
without cross-schema joins and FK constraints from `current → legacy`, the
linkage between new and old data becomes a soft reference in application code.
Splitting is reversible if requirements change.

## Quick start

```bash
# 1. Bring up postgres + postgraphile
docker compose up -d postgres
docker compose up -d --build postgraphile

# 2. Set up the migration Python env (one-off)
cd tools/migration
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ../..

# 3. Run the migration (analyze → schema → extract → COPY → constraints)
pnpm migrate:clean

# 4. Install JS deps and run the web app
pnpm install
pnpm dev
```

Both services bind to `localhost` on the linux dev box. If you're working via
VSCode Remote, VSCode auto-forwards the ports — open
<http://localhost:5173/> for the web UI and
<http://localhost:5050/graphiql> for GraphiQL.

## Scripts (root)

| Command | What it does |
|---|---|
| `pnpm dev`               | Start the Vite dev server (proxies `/graphql`) |
| `pnpm build`             | Build all workspace apps |
| `pnpm db:up` / `db:down` | Start/stop the postgres container |
| `pnpm db:psql`           | Open a psql shell against the running container |
| `pnpm graphql:up`        | (Re)build & start PostGraphile |
| `pnpm graphql:logs`      | Tail PostGraphile logs |
| `pnpm stack:up`          | Bring up the whole docker stack |
| `pnpm migrate`           | Run the migration (preserves data) |
| `pnpm migrate:clean`     | Drop the legacy schema & re-import from xlsx |

## Per-package READMEs

- [apps/postgraphile/README](apps/postgraphile/README.md) — GraphQL service.
- [apps/web/README](apps/web/README.md) — React frontend stack & dev workflow.
- [tools/migration/README](tools/migration/README.md) — Migration script details, config knobs.

## Verified end-to-end

Latest migration run:

- 31 tables loaded, **4 005 538 rows** in ~20s (COPY)
- 34 FK constraints applied; 0 orphans across spot-checks
- 78 689 antenne rows: 78 257 with realistic German coordinates, 429 at (0°,0°)
- Total schema size: **1.64 GB** on disk
- GraphQL FK traversal verified (`antenne → funkanlage`, `frequenz → zuteilung`, …)

## Schema notes

The Dynamics export brought a lot of CRM noise. The migration applies the
following consolidations (full rationale in
[`tools/migration/config.py`](tools/migration/config.py)):

- **Strip `bnetza_` prefix** from every column. PK columns become `id`.
- **Drop local-time twins** (`createdon`, `modifiedon`, …) — keep the UTC
  variants as `timestamptz`, renamed back to the base name.
- **Drop Ja/Nein label twins** of boolean columns.
- **Drop always-empty CRM fields** (`createdonbehalfby*`,
  `overriddencreatedon*`, `importsequencenumber`, `*yominame`, …).
- **Combine antenna coordinates** into `lat`/`lon` numerics +
  `location geography(Point, 4326)` with a GiST index.
- **Strip spaces** from 9-digit identifier columns
  (`fachschluessel`, all `zuteilungname`, `frequenzzuteilungsid`) →
  `100 001 123` becomes `100001123`.
- **Add `_id` suffix** to FK columns so they don't clash with the
  auto-generated relation field of the same name.

## Known limitations

- **PostGIS in GraphQL** — v5 doesn't yet have a v5-compatible PostGIS preset.
  Workaround: `lat`/`lon` numeric columns are exposed natively; the raw
  geography column is hidden via `@omit` smart comment but available for SQL
  spatial queries.
- **Attribute-level filtering** — the connection-filter plugin currently
  exposes filters on FK columns but not every column. Use PostGraphile's
  built-in `condition` argument for ad-hoc filtering, or extend the plugin
  config when needed.
