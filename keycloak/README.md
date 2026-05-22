# Keycloak

Source of truth for this project's Keycloak client configuration.

The Keycloak instance itself (`https://auth.commsplice.com/`) is managed
separately — this directory only contains the **client** definition that
the LMR database authenticates against, in a form that can be imported into
the Keycloak admin console.

---

## Files

| File | Purpose |
|---|---|
| [lmr-database-client.json](lmr-database-client.json) | Importable Keycloak client config for the SPA |

---

## Auth model (one paragraph)

The SPA logs the user in against the `CommSplice` realm via the OIDC
Authorization Code flow with PKCE. There is no client secret — the client
is **public** (it runs in the browser). PostGraphile verifies incoming JWTs
against Keycloak's JWKS, then pushes the user's `sub` into the Postgres
session via `pgSettings`. A trigger on `current.*` tables reads
`current_setting('jwt.claims.sub')`, upserts a row in `current.app_user`,
and stamps `created_by` / `updated_by`. Every authenticated user has equal
write access (see [../CLAUDE.md](../CLAUDE.md) for the access-model
decision).

---

## One-time setup: importing the client

1. Open the Keycloak admin console at <https://auth.commsplice.com/>.
2. Top-left realm switcher → **CommSplice**.
3. **Clients** → top-right **Import client** → upload
   [`lmr-database-client.json`](lmr-database-client.json) → **Save**.

That's it. The file already contains the audience mapper, redirect URIs
for both production and the LAN dev URL, and PKCE enforcement.

---

## What the client config does

| Setting | Value | Why |
|---|---|---|
| `publicClient` | `true` | SPA, no secret. PKCE compensates. |
| `pkce.code.challenge.method` | `S256` | Forces PKCE for the auth code flow. |
| `standardFlowEnabled` | `true` | Auth Code + PKCE is the only flow allowed. |
| `directAccessGrantsEnabled` | `false` | No `password` grant — users always go through the login page. |
| `implicitFlowEnabled` | `false` | Implicit flow is deprecated. |
| `serviceAccountsEnabled` | `false` | This client is per-user, not machine-to-machine. |
| `redirectUris` | prod + LAN dev | Both environments registered up front. |
| `webOrigins` | `+` | CORS automatically follows `redirectUris` — no separate maintenance. |
| `post.logout.redirect.uris` | prod + LAN dev | Where Keycloak sends the user after logout. `##` is Keycloak's separator. |
| Audience mapper | adds `aud: lmr-database` | Keycloak doesn't include the client ID in `aud` by default for public clients; we need it for server-side verification. |

---

## Environments

The client trusts two browser origins:

| Environment | Origin | Notes |
|---|---|---|
| **Production** | `https://lmrdb.commsplice.com` | Canonical home (`rootUrl`). |
| **Local dev** | `http://localhost:5173` | Reached from the workstation via VSCode Remote port-forwarding to the linux dev box. **Must** be `localhost` (not a LAN IP) — PKCE needs `crypto.subtle`, which browsers only expose on HTTPS or `localhost`/loopback origins. |

Dev servers bind to localhost on the linux box; VSCode Remote forwards the
ports transparently to the workstation, so the browser sees a normal
`localhost` origin and PKCE works without HTTPS setup.

### Adding a new environment (e.g. a staging URL or another developer)

Edit [`lmr-database-client.json`](lmr-database-client.json) and add the new
origin to **three** places:

1. `redirectUris` — add both `<origin>/auth/callback` and `<origin>/auth/silent-renew`.
2. `attributes.post.logout.redirect.uris` — append `##<origin>/*`.
3. (Cosmetic only) update `rootUrl`/`baseUrl` if the new env should be the default link from the admin console.

Then re-import the file (Clients → `lmr-database` → **Action** menu →
**Export** to verify what's currently set, then either edit in the UI or
delete + re-import). `webOrigins: ["+"]` means CORS auto-follows, so no
change needed there.

---

## Env vars derived from this client

Backend (`apps/postgraphile`):

```
KEYCLOAK_ISSUER=https://auth.commsplice.com/realms/CommSplice
KEYCLOAK_AUDIENCE=lmr-database
```

Frontend (`apps/web`, Vite-prefixed):

```
VITE_KEYCLOAK_AUTHORITY=https://auth.commsplice.com/realms/CommSplice
VITE_KEYCLOAK_CLIENT_ID=lmr-database
```

Redirect URIs are derived at runtime from `window.location.origin` in
[`../apps/web/src/auth/oidcConfig.ts`](../apps/web/src/auth/oidcConfig.ts), so
the same SPA works at `localhost`, in production, or any other registered
origin without rebuild or env tweaks.

The frontend lib (`oidc-client-ts` / `react-oidc-context`) only needs the
authority + client ID; everything else is discovered via OIDC discovery
(`{authority}/.well-known/openid-configuration`).

---

## What is *not* in this directory

- **Realm export.** The realm has other clients in it (managed elsewhere)
  and exporting it whole would entangle this repo with unrelated config.
- **Users / groups / roles.** Users live in Keycloak. No role gating today —
  the moment we need "can this user log into LMR at all", we'll add a
  realm role like `lmr-database-user` and require it on the client (a
  ~10-minute Keycloak change, no schema impact).
- **Identity provider federation** (Google Workspace / GitHub / etc.).
  Not configured yet; users authenticate with username/password against
  the realm directly. Easy to add later without touching this client.

---

## When something goes wrong

| Symptom | Likely cause |
|---|---|
| `Invalid redirect_uri` on login | The URL the SPA is running at isn't in `redirectUris`. Add it and re-import. |
| `CORS error` on token exchange | New origin isn't covered. Verify `webOrigins` includes `+`, then verify the URL is in `redirectUris` (CORS follows it). |
| `aud claim mismatch` server-side | Audience mapper missing or the wrong client. Open the client → **Client scopes** → `lmr-database-dedicated` → confirm `lmr-database-audience` mapper exists. |
| Login works but Postgres complains about `jwt.claims.sub` | PostGraphile isn't pushing claims into `pgSettings`. Check `KEYCLOAK_ISSUER` matches the token's `iss` exactly (case-sensitive — `CommSplice`, not `commsplice`). |
