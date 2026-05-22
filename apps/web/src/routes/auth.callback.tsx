// OIDC redirect target. AuthProvider (mounted in main.tsx) intercepts the
// ?code=…&state=… query params on mount, exchanges them for tokens, then
// fires `onSigninCallback` which cleans the URL. This component just keeps
// the user company while that happens.

import { createFileRoute } from "@tanstack/react-router";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import { useAuth } from "react-oidc-context";

export const Route = createFileRoute("/auth/callback")({
  component: function AuthCallback() {
    const auth = useAuth();
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
          <Text c="dimmed">{auth.isLoading ? "Completing sign-in…" : "Signed in."}</Text>
        </Stack>
      </Center>
    );
  },
});
