// OIDC redirect target. AuthProvider (mounted in main.tsx) intercepts the
// ?code=…&state=… query params on mount, exchanges them for tokens, then
// fires `onSigninCallback` which cleans the URL. This component just keeps
// the user company while that happens.

import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "react-oidc-context";

export const Route = createFileRoute("/auth/callback")({
  component: function AuthCallback() {
    const auth = useAuth();
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p>{auth.isLoading ? "Completing sign-in…" : "Signed in."}</p>
        {auth.error && (
          <p style={{ color: "crimson" }}>Error: {auth.error.message}</p>
        )}
      </div>
    );
  },
});
