/**
 * Serves the built web application from the API process (PLAN-016: one codebase, one image).
 *
 * In development the SPA is served by Vite on its own port and this is inert. In a
 * deployment there is no second server: the web build is copied into the image and served
 * from here, so the API and the UI share an origin — which is also what the CSP, the
 * cookie policy and the WebSocket path already assume.
 *
 * Enabled when `SERVE_WEB` is not "false" and the directory exists, so a deployment cannot
 * silently come up without a UI: a missing directory is logged loudly at startup.
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./services/logger";

/** Where the web build lives: `WEB_DIST` if set, else ./web beside the running code. */
export function webDistDir(): string {
  if (process.env.WEB_DIST) return path.resolve(process.env.WEB_DIST);
  const beside = path.resolve(process.cwd(), "web");
  if (fs.existsSync(path.join(beside, "index.html"))) return beside;
  // Running from source (tsx src/index.ts) with the sibling app checked out.
  const source = path.resolve(process.cwd(), "../web/dist");
  return source;
}

export function mountWebApp(app: Express): void {
  if (process.env.SERVE_WEB === "false") {
    logger.info("web", "SERVE_WEB=false — the API will not serve the web application");
    return;
  }
  const dir = webDistDir();
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    logger.warn("web", `No web build found at ${dir} — the API will serve the API only. Build it with "pnpm --filter @C7NTAX/web build" or set WEB_DIST.`);
    return;
  }

  logger.info("web", `Serving the web application from ${dir}`);

  // Hashed assets are immutable; index.html must never be cached or a deploy strands
  // browsers on an old bundle whose asset URLs no longer exist.
  app.use("/assets", express.static(path.join(dir, "assets"), { immutable: true, maxAge: "1y", index: false }));
  app.use(express.static(dir, { index: false, setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  } }));

  // Client-side routing: anything that is not an API call and not a file resolves to the
  // SPA shell. /api/* is excluded so a missing endpoint still answers 404 JSON.
  app.get(/^\/(?!api\/|ws$|BuildNotes\.md$).*/, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path.includes(".")) return next();
    res.sendFile(path.join(dir, "index.html"), err => { if (err) next(err); });
  });
}
