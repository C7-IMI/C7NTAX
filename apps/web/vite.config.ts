import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { WEB_PORT, API_ORIGIN } from "../../packages/shared/src/constants";

/** Copy FEATURE_LIST.md from project root into public/ so it's served at /FEATURE_LIST.md */
function syncFeatureList(): import("vite").Plugin {
  const src = path.resolve(__dirname, "../../FEATURE_LIST.md");
  const dest = path.resolve(__dirname, "public/FEATURE_LIST.md");
  return {
    name: "sync-feature-list",
    buildStart() {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log("[sync-feature-list] FEATURE_LIST.md → public/");
      } catch (e) {
        console.warn("[sync-feature-list] Could not copy FEATURE_LIST.md:", (e as Error).message);
      }
    },
  };
}

export default defineConfig({
  plugins: [syncFeatureList(), react()],
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
