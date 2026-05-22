// urql Client factory with bearer-token attachment.
//
// The token comes from react-oidc-context's user store, which keeps it fresh
// via silent renew. We read from localStorage directly (not via useAuth)
// because urql's authExchange runs outside React.

import { Client, cacheExchange, fetchExchange } from "urql";
import { authExchange } from "@urql/exchange-auth";
import { User } from "oidc-client-ts";

const authority = import.meta.env.VITE_KEYCLOAK_AUTHORITY!;
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID!;

/** Pulls the latest access token out of oidc-client-ts's localStorage entry. */
function loadAccessToken(): string | null {
  const raw = window.localStorage.getItem(`oidc.user:${authority}:${clientId}`);
  if (!raw) return null;
  try {
    const user = User.fromStorageString(raw);
    if (user.expired) return null;
    return user.access_token ?? null;
  } catch {
    return null;
  }
}

export function createUrqlClient(): Client {
  return new Client({
    url: "/graphql",
    exchanges: [
      cacheExchange,
      authExchange(async (utils) => {
        return {
          addAuthToOperation(operation) {
            // Read the token freshly on every request, not at init: the urql
            // client is created at app startup before the user has logged
            // in, so caching the token in a closure leaves it stuck at null.
            const token = loadAccessToken();
            if (!token) return operation;
            return utils.appendHeaders(operation, {
              Authorization: `Bearer ${token}`,
            });
          },
          didAuthError(error) {
            return error.response?.status === 401;
          },
          async refreshAuth() {
            // oidc-client-ts handles silent renew in the background; the
            // next call to addAuthToOperation will pick up the new token.
          },
        };
      }),
      fetchExchange,
    ],
  });
}
