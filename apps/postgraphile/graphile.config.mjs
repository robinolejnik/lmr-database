// PostGraphile v5 config.
//
// Mutation defaults: amber's per-plugin defaults already enable CRUD on every
// table. Do NOT set `schema.defaultBehavior: "-insert -update -delete"` — the
// unscoped `-insert` token matches both `resource:insert` (kills mutations)
// AND `attribute:insert` (makes Patch types empty). It was the cause of the
// "no mutation type" / "Patch type has no fields" failure mode.
//
// Legacy is locked down via a small plugin (LegacyReadOnlyPlugin) that adds
// `-resource:insert/update/delete` only to resources in the `legacy` schema.
//
// PostGIS workaround:
//   v5 has no PostGIS preset yet. The `location` geography column on
//   receivers/transmitters is auto-computed in SQL as a GENERATED column;
//   the raw geography is hidden from GraphQL via an `@omit` smart comment.

import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { makePgService } from "postgraphile/adaptors/pg";
import { PgSimplifyInflectionPreset } from "@graphile/simplify-inflection";
import { PostGraphileConnectionFilterPreset } from "postgraphile-plugin-connection-filter";

/** Lock down the `legacy` schema to SELECT-only at the behavior layer. */
const LegacyReadOnlyPlugin = {
  name: "LegacyReadOnlyPlugin",
  description: "Disables mutations on every table in the `legacy` schema.",
  version: "0.1.0",
  schema: {
    entityBehavior: {
      pgResource: {
        inferred: {
          after: ["default"],
          callback(behavior, resource) {
            if (resource.codec?.extensions?.pg?.schemaName === "legacy") {
              return [
                behavior,
                "-resource:insert",
                "-resource:update",
                "-resource:delete",
              ];
            }
            return behavior;
          },
        },
      },
    },
  },
};

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [
    PostGraphileAmberPreset,
    PgSimplifyInflectionPreset,
    PostGraphileConnectionFilterPreset,
  ],
  plugins: [LegacyReadOnlyPlugin],
  pgServices: [
    makePgService({
      connectionString: process.env.DATABASE_URL,
      schemas: ["legacy", "current"],
      // Push Keycloak claims (verified upstream in server.mjs) into the
      // Postgres session. The audit trigger reads jwt.claims.sub to stamp
      // created_by_id / updated_by_id on every mutated row.
      pgSettings(requestContext) {
        const req = requestContext.expressv4?.req;
        const auth = req?.auth;
        if (auth?.sub) {
          return {
            role: "app_authenticated",
            "jwt.claims.sub": auth.sub,
            ...(auth.email && { "jwt.claims.email": auth.email }),
            ...(auth.preferred_username && {
              "jwt.claims.preferred_username": auth.preferred_username,
            }),
            ...(auth.name && { "jwt.claims.name": auth.name }),
          };
        }
        return { role: "app_anonymous" };
      },
    }),
  ],
  grafserv: {
    port: Number(process.env.PORT ?? 5050),
    graphqlPath: "/graphql",
    graphiql: true,
    graphiqlPath: "/graphiql",
    graphiqlOnGraphQLGET: true,
    websockets: true,
  },
};

export default preset;
