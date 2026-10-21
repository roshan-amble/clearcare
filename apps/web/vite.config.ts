import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser talks to the local API through Vite, so both share one origin and no CORS is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 8090,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8091", changeOrigin: false },
    },
  },
});
