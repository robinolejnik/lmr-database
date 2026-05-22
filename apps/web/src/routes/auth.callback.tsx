// OIDC redirect target. AuthProvider (mounted in main.tsx) intercepts the
// ?code=…&state=… query params on mount, exchanges them for tokens, then
// fires `onSigninCallback` which strips the URL params. We also need to
// navigate off `/auth/callback` once the exchange completes — without this
// the user is stuck staring at the spinner after a successful sign-in.

import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import { useAuth } from "react-oidc-context";

export const Route = createFileRoute("/auth/callback")({
  component: function AuthCallback() {
    const auth = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
      if (auth.isAuthenticated && !auth.isLoading) {
        void navigate({ to: "/", replace: true });
      }
    }, [auth.isAuthenticated, auth.isLoading, navigate]);

    if (auth.error) {
      return (
        <Center mih={200}>
          <Alert color="red" title="Sign-in failed" maw={420}>
            {auth.error.message}
          </Alert>
        </Center>
      );
    }
    return (
      <Center mih={200}>
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text c="dimmed">{auth.isLoading ? "Completing sign-in…" : "Signed in, redirecting…"}</Text>
        </Stack>
      </Center>
    );
  },
});
