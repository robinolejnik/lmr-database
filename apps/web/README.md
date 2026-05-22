# web

React frontend for the LMR database.

Stack:
- **Vite** + **React 19** + **TypeScript** — SPA, no SSR.
- **TanStack Router** — type-safe file-based routing.
- **TanStack Query** — caching layer (mostly for non-GraphQL state; urql handles GraphQL).
- **urql** — GraphQL client. Talks to PostGraphile at `/graphql` (proxied to the postgraphile service in dev).
- **GraphQL Code Generator** — typed query objects derived from the live PostGraphile schema.

## Dev

```bash
# from the repo root
pnpm install
pnpm dev   # vite at http://127.0.0.1:5173
```

The dev server proxies `/graphql` → `http://127.0.0.1:5050/graphql` so the browser doesn't see CORS.

## Typed queries

After PostGraphile is up:

```bash
pnpm codegen           # one-shot
pnpm codegen:watch     # watch mode
```

This produces fully-typed `graphql()` helpers under `src/gql/`. Replace the raw
template-literal query in `routes/antennen.tsx` with the codegen-typed version
once you're ready.

## Routing

File-based, in `src/routes/`. `__root.tsx` is the shell; every other file is a route.
TanStack Router auto-generates `routeTree.gen.ts` from the filesystem at dev time.
