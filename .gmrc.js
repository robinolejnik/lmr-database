// graphile-migrate config — runs the `current` schema migrations.
// Docs: https://github.com/graphile/migrate
//
// The `legacy` schema is managed by the Python pipeline (tools/migration/)
// and is NOT touched by graphile-migrate.

const PG_USER = process.env.PG_USER ?? "lmr";
const PG_PASSWORD = process.env.PG_PASSWORD ?? "lmr";
const PG_HOST = process.env.PG_HOST ?? "127.0.0.1";
const PG_PORT = process.env.PG_PORT ?? "5432";
const PG_DB = process.env.PG_DB ?? "lmr";

const baseUrl = `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}`;

module.exports = {
  connectionString: process.env.PG_DSN ?? `${baseUrl}/${PG_DB}`,
  rootConnectionString: process.env.PG_ROOT_DSN ?? `${baseUrl}/postgres`,
  shadowConnectionString:
    process.env.PG_SHADOW_DSN ?? `${baseUrl}/${PG_DB}_shadow`,
  migrationsFolder: "db/migrations",
  placeholders: {
    ":DATABASE_OWNER": PG_USER,
  },
  blankMigrationContent:
    "-- New migration. graphile-migrate applies this idempotently;\n" +
    "-- writing it with CREATE OR REPLACE / DROP IF EXISTS makes it safe to\n" +
    "-- replay during `gm watch`. Commit it with `pnpm migrate:current:commit`.\n",
  manageGraphileMigrateSchema: true,
  // Settings applied to every migration session.
  pgSettings: {
    search_path: "current,public",
  },
};
