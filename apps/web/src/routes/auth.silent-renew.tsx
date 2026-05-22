// Silent-renew target. The hidden iframe that oidc-client-ts uses to refresh
// the access token loads this URL, completes the OIDC dance, and posts the
// result back to the parent window. The page itself just needs to mount
// AuthProvider so oidc-client-ts can process the response.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/silent-renew")({
  component: () => null,
});
