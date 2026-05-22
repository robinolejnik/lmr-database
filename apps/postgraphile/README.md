# postgraphile

PostGraphile v5 service exposing the `legacy` (and later `current`) Postgres
schemas as a single GraphQL endpoint.

## Plugins

- `@graphile/simplify-inflection` — cleaner GraphQL names (drops the `By…`
  suffixes from relations).
- `postgraphile-plugin-connection-filter` — `filter:` argument on every
  connection.

PostGIS support in v5 isn't out yet — see the workaround documented in the
root README. Currently the geography column is hidden via `@omit` smart
comment; `lat`/`lon` numeric columns are exposed natively.

## Running

```bash
# from the repo root
docker compose up -d --build postgraphile
docker logs -f lmr-postgraphile
```

GraphiQL: <http://127.0.0.1:5050/graphiql>

## Switching to two-instance mode

To split the `current` schema onto its own service (e.g. for independent
auth/deploy), copy this directory to `apps/postgraphile-current/`, change the
`schemas: ["legacy"]` in `graphile.config.mjs`, and add a second service entry
in `docker-compose.yml`. The frontend will then need to talk to two GraphQL
endpoints (or you add a federation layer).
