// PostGraphile v5 + Express entrypoint.
//
// Why programmatic (not the CLI)? We need a middleware slot to verify
// incoming Keycloak JWTs before PostGraphile runs. The CLI doesn't expose
// that.
//
// Flow per request:
//   1. JWT middleware reads `Authorization: Bearer …`, verifies against
//      Keycloak's JWKS, attaches the payload to `req.auth`.
//   2. PostGraphile handles the GraphQL request. Its `pgSettings` reads
//      `req.auth` and pushes claims into the Postgres session as
//      `jwt.claims.*`, then SET ROLE app_authenticated.
//   3. The audit trigger inside Postgres reads `jwt.claims.sub` and
//      stamps created_by / updated_by on every mutated row.

import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { postgraphile } from "postgraphile";
import { grafserv } from "postgraphile/grafserv/express/v4";

import preset from "./graphile.config.mjs";

const PORT = Number(process.env.PORT ?? 5050);
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER;
const KEYCLOAK_AUDIENCE = process.env.KEYCLOAK_AUDIENCE;

if (!KEYCLOAK_ISSUER || !KEYCLOAK_AUDIENCE) {
  console.error(
    "KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE must be set. See .env.example."
  );
  process.exit(1);
}

const JWKS = createRemoteJWKSet(
  new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`)
);

// Verifies the bearer token if present. On success, attaches the JWT payload
// to req.auth. On failure (missing/invalid/expired), leaves req.auth unset
// and the request continues as anonymous — pgSettings will then SET ROLE
// app_anonymous which has no access to `current`.
async function jwtMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const { payload } = await jwtVerify(header.slice(7), JWKS, {
        issuer: KEYCLOAK_ISSUER,
        audience: KEYCLOAK_AUDIENCE,
      });
      req.auth = payload;
    } catch (err) {
      // Always log — these failures are hard to diagnose otherwise.
      console.warn(`[jwt] rejected: ${err.code ?? err.message}`);
    }
  }
  next();
}

const app = express();
app.use(jwtMiddleware);

const pgl = postgraphile(preset);
const serv = pgl.createServ(grafserv);
await serv.addTo(app);

// Bind to localhost only. The container runs with `network_mode: host` (see
// docker-compose.yml) so this is the host's 127.0.0.1; VSCode Remote forwards
// it to the workstation. Host networking is necessary because Keycloak is
// only reachable via IPv6 on this network, and docker's default bridge has
// no IPv6 — see CLAUDE.md gotcha.
app.listen(PORT, "127.0.0.1", () => {
  console.log(`PostGraphile listening on 127.0.0.1:${PORT}`);
  console.log(`  GraphQL:  http://localhost:${PORT}/graphql`);
  console.log(`  GraphiQL: http://localhost:${PORT}/graphiql`);
  console.log(`  Keycloak issuer:   ${KEYCLOAK_ISSUER}`);
  console.log(`  Keycloak audience: ${KEYCLOAK_AUDIENCE}`);
});
