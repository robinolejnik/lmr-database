import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      // route GraphQL through Vite during dev so the browser doesn't see CORS
      "/graphql": "http://127.0.0.1:5050",
    },
  },
});
