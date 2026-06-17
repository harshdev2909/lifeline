import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bridge runs on localhost only. In dev, proxy the HTTP API and the
// WebSocket to it so the browser still talks to a single origin. In a built
// deploy the bridge serves these paths itself (see packages/server), so the
// proxy is a dev-only convenience. No external origins are ever contacted.
const BRIDGE_PORT = process.env.LIFELINE_BRIDGE_PORT ?? "8787";
const bridge = `http://127.0.0.1:${BRIDGE_PORT}`;

export default defineConfig({
  plugins: [react()],
  // Everything is bundled and self-hosted; no runtime CDN, no analytics.
  build: { outDir: "dist", assetsInlineLimit: 0, sourcemap: false },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: bridge, changeOrigin: true },
      "/ws": { target: bridge, ws: true, changeOrigin: true },
    },
  },
});
