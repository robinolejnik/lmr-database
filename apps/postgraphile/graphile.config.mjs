// PostGraphile v5 config — see https://postgraphile.org/postgraphile/next/config
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { makePgService } from "postgraphile/adaptors/pg";
import { PgSimplifyInflectionPreset } from "@graphile/simplify-inflection";
import { PostGraphileConnectionFilterPreset } from "postgraphile-plugin-connection-filter";
// PostGIS support in v5 is not yet released as a preset. The `location`
// column is exposed via separate `lat` / `lon` numeric columns added in the
// migration; the geography column itself is hidden from GraphQL via smart
// comment (see db/init/03_smart_comments.sql).
// Many-to-many traversal is omitted because Dynamics denormalizes the joined
// labels as text columns (`uebertragungsarten`, `betriebsarten`, ...) which
// collide with the auto-generated relation names. The junction-table relations
// are still navigable from each side individually.
// import { PgManyToManyPreset } from "@graphile-contrib/pg-many-to-many";

/** @type {GraphileConfig.Preset} */
const preset = {
  extends: [
    PostGraphileAmberPreset,
    PgSimplifyInflectionPreset,
    PostGraphileConnectionFilterPreset,
  ],
  pgServices: [
    makePgService({
      connectionString: process.env.DATABASE_URL,
      schemas: ["legacy"],
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
  schema: {
    // read-only: no mutations are emitted
    defaultBehavior: "-insert -update -delete",
  },
};

export default preset;
