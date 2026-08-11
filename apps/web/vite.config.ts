import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { WEB_PORT, API_ORIGIN } from "../../packages/shared/src/constants";

/** Copy BuildNotes.md from project root into public/ so it's served at /BuildNotes.md */
function syncBuildNotes(): import("vite").Plugin {
  const src = path.resolve(__dirname, "../../BuildNotes.md");
  const dest = path.resolve(__dirname, "public/BuildNotes.md");
  return {
    name: "sync-build-notes",
    buildStart() {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log("[sync-build-notes] BuildNotes.md → public/");
      } catch (e) {
        console.warn("[sync-build-notes] Could not copy BuildNotes.md:", (e as Error).message);
      }
    },
  };
}

export default defineConfig({
  plugins: [syncBuildNotes(), react()],
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
