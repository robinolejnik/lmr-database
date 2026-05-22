import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider as UrqlProvider } from "urql";
import { AuthProvider } from "react-oidc-context";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

import { oidcConfig } from "./auth/oidcConfig";
import { AuthGate } from "./auth/AuthGate";
import { createUrqlClient } from "./auth/urqlClient";
import { theme } from "./theme";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const urqlClient = createUrqlClient();
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" />
      <AuthProvider {...oidcConfig}>
        <AuthGate>
          <UrqlProvider value={urqlClient}>
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </UrqlProvider>
        </AuthGate>
      </AuthProvider>
    </MantineProvider>
  </StrictMode>
);
