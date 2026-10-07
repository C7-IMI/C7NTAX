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
    // The shared package is source in this repository, not a published dependency, so it is served as
    // source. Pre-bundling it means a new export is missing until someone remembers `--force`, and the
    // symptom is a blank page with a module-export error rather than anything that names the cause.
    exclude: ["@C7NTAX/shared"],
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/api": API_ORIGIN,
      // The add-in's taskpane, its generated manifest and its installer download. Proxied so a
      // link on the C7NC page resolves same-origin in development exactly as it does in a
      // deployment — including the manifest, whose URLs are built from the host it was asked on.
      "/addin": API_ORIGIN,
      "/ws": { target: API_ORIGIN.replace("http", "ws"), ws: true },
    },
  },
});
