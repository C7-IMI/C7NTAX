import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { WEB_PORT, API_ORIGIN } from "../../packages/shared/src/constants";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@C7NTAX/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  optimizeDeps: {
    include: ["@C7NTAX/shared"],
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/api": API_ORIGIN,
      "/ws": { target: API_ORIGIN.replace("http", "ws"), ws: true },
    },
  },
});
