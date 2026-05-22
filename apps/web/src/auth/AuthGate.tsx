// Gates the app behind a successful Keycloak login.
//
// Mount once near the root (inside <AuthProvider>, outside the router) so
// every route inherits the guarantee that `auth.user` exists.

import { useEffect, type ReactNode } from "react";
import { useAuth } from "react-oidc-context";

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    // Kick off a redirect to Keycloak once we're done loading and not yet
    // signed in. The redirect-back lands on /auth/callback which AuthProvider
    // processes automatically.
    if (
      !auth.isAuthenticated &&
      !auth.isLoading &&
      !auth.activeNavigator &&
      !auth.error
    ) {
      void auth.signinRedirect();
    }
  }, [auth]);

  if (auth.activeNavigator === "signinSilent") {
    return <Splash text="Refreshing session…" />;
  }
  if (auth.isLoading) {
    return <Splash text="Loading…" />;
  }
  if (auth.error) {
    return <Splash text={`Auth error: ${auth.error.message}`} error />;
  }
  if (!auth.isAuthenticated) {
    return <Splash text="Redirecting to sign in…" />;
  }

  return <>{children}</>;
}

function Splash({ text, error }: { text: string; error?: boolean }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, sans-serif",
        color: error ? "crimson" : "#444",
      }}
    >
      <p>{text}</p>
    </div>
  );
}
