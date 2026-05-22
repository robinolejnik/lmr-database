import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
  // Single .env at the repo root (next to docker-compose). All VITE_-prefixed
  // vars defined there are available via `import.meta.env`.
  envDir: "../..",
  server: {
    // Default localhost binding — VSCode Remote auto-forwards localhost:5173
    // from the linux box to the windows side. No LAN exposure needed.
    port: 5173,
    proxy: {
      // route GraphQL through Vite during dev so the browser doesn't see CORS
      "/graphql": "http://127.0.0.1:5050",
    },
  },
});
