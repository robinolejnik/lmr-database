// OIDC configuration consumed by <AuthProvider> from react-oidc-context.
//
// Values come from .env at the repo root (see VITE_KEYCLOAK_* in
// .env.example). Vite is configured with `envDir: '../..'` so root .env is
// loaded automatically.

import { WebStorageStateStore } from "oidc-client-ts";
import type { AuthProviderProps } from "react-oidc-context";

const authority = import.meta.env.VITE_KEYCLOAK_AUTHORITY;
const clientId  = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

if (!authority || !clientId) {
  throw new Error(
    "Missing VITE_KEYCLOAK_AUTHORITY / VITE_KEYCLOAK_CLIENT_ID " +
      "in .env — see .env.example."
  );
}

// Derive redirect URIs from the current origin so the same SPA works at
// http://localhost:5173 (local dev) and the production URL with no rebuild.
// Each origin must be registered in the Keycloak client's Valid Redirect URIs
// (see keycloak/lmr-database-client.json).
//
// Why runtime-derive: if redirect_uri's host differs from the SPA's host,
// the OIDC library stores the request state on origin A but the callback
// lands on origin B, which can't read A's localStorage — leading to
// "No matching state found in storage".
const origin = window.location.origin;
const redirect      = `${origin}/auth/callback`;
const silentRenewUri = `${origin}/auth/silent-renew`;
const logoutTo      = `${origin}/`;

export const oidcConfig: AuthProviderProps = {
  authority,
  client_id: clientId,
  redirect_uri: redirect,
  post_logout_redirect_uri: logoutTo,
  silent_redirect_uri: silentRenewUri,
  response_type: "code",
  scope: "openid profile email",
  automaticSilentRenew: true,
  // Persist the user across reloads so a refresh doesn't bounce through login.
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // After the auth code is exchanged for tokens, clean the ?code=… query
  // params out of the URL so a refresh doesn't replay the (now stale) code.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};
