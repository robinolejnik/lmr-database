# PostGraphile v5 + commonly-needed plugins.
# v5 ships as ESM and uses a graphile.config.mjs for configuration.
FROM node:22-alpine

WORKDIR /app

# Build deps for postgis/native modules
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev \
      postgraphile@latest \
      @graphile/simplify-inflection@latest \
      postgraphile-plugin-connection-filter@beta \
 && apk del .build-deps \
 && npm cache clean --force

COPY graphile.config.mjs ./graphile.config.mjs

EXPOSE 5050

ENV PORT=5050
ENV GRAPHILE_ENV=production
# DATABASE_URL is injected by docker-compose

CMD ["node", "./node_modules/postgraphile/dist/cli-run.js", "-C", "./graphile.config.mjs"]
