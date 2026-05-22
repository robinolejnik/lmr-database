# PostGraphile v5 service.
#
# Programmatic Express + Grafserv entrypoint (server.mjs). The CLI variant
# was used initially; we switched off it to mount a JWT verification
# middleware in front of PostGraphile (Keycloak access tokens).
FROM node:22-alpine

WORKDIR /app

# Build deps for any native modules
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev \
      postgraphile@latest \
      @graphile/simplify-inflection@latest \
      postgraphile-plugin-connection-filter@beta \
      express@^4 \
      jose@^5 \
 && apk del .build-deps \
 && npm cache clean --force

COPY graphile.config.mjs ./graphile.config.mjs
COPY server.mjs           ./server.mjs

EXPOSE 5050

ENV PORT=5050
ENV NODE_ENV=production
# DATABASE_URL, KEYCLOAK_ISSUER, KEYCLOAK_AUDIENCE injected by docker-compose.

CMD ["node", "./server.mjs"]
