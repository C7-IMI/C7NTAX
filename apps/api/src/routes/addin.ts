/**
 * Serving `/addin`: the taskpane Office loads, the manifest Office reads, and the Windows
 * installer that registers both.
 *
 * Split out of `index.ts` because the mount now answers three different things, one of which
 * (the manifest) has to be *generated* rather than served from disk. The CSP explanation below
 * is the reason the taskpane cannot use the global helmet policy, and belongs beside the code
 * it is about.
 */
import express, { type Express, type Response } from "express";
import { configFlag } from "../services/appSettings";
import { addinAssetsPresent, addinDirectory } from "../services/addinAssets";
import { installerBuild, installerDescriptor, installerRelease, installerStableName, publicOrigin, renderAddinManifest } from "../services/addinPackage";

/**
 * Office.js is only served from Microsoft's CDN (bundling it is not permitted), and Office
 * frames the taskpane, so the pane needs a policy that allows that one script origin and those
 * two frames — and nothing else.
 */
function setTaskpaneCsp(res: Response): void {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://appsforoffice.microsoft.com",
    // Office.js injects its own elements and styles them inline; without this the pane loads
    // with the host's chrome unstyled, which reads as a broken add-in.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    // Office.js opens a hidden telemetry frame on Microsoft's own host. Naming it keeps the
    // rest of default-src closed.
    "frame-src https://telemetryservice.firstpartyapps.oaspapps.com",
    "frame-ancestors https://*.office.com https://*.office365.com https://*.outlook.com https://outlook.office.com https://outlook.office365.com",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "));
}

/**
 * PLAN-012: the taskpane is served from the same origin as the API, because the manifest's
 * URLs must be HTTPS and same-origin is what lets the pane call /api without CORS.
 *
 * The switch is checked **per request** rather than at start-up, so the same setting that
 * governs the endpoint also governs the taskpane, and turning it off in Administration →
 * Configuration → Client Apps takes effect immediately. A mailbox that already has the add-in
 * sideloaded then gets a clear 404 from the pane rather than a half-working one. It governs
 * the installer download too: offering a package for a switched-off add-in would install a
 * button that answers 404.
 */
export function mountAddinRoutes(app: Express): void {
  if (!addinAssetsPresent()) return;

  const addinFiles = express.static(addinDirectory(), { index: "taskpane.html", extensions: ["html"] });

  app.use("/addin", async (req, res, next) => {
    if (!configFlag("apps", "outlookAddin")) {
      res.status(404).json({ error: "Outlook add-in disabled" });
      return;
    }

    // The manifest is generated, not served. The copy on disk still holds `__ADDIN_HOST__`,
    // and a manifest carrying a placeholder is one Office rejects, so the raw file must never
    // reach a client — this branch is what makes the export usable for a manual sideload or a
    // centralized deployment rather than a file that fails to load.
    if (req.method === "GET" && req.path === "/manifest.xml") {
      const xml = renderAddinManifest(publicOrigin(req));
      if (!xml) {
        res.status(404).json({ error: "Add-in manifest not found" });
        return;
      }
      res.type("application/xml").send(xml);
      return;
    }

    // What the application's own install page asks for: whether there is an installer to offer,
    // what it is, and every earlier version still available to fall back to — public, because the
    // button is shown to every signed-in user and most of them cannot read the admin-only
    // deployment report.
    if (req.method === "GET" && req.path === "/installer") {
      res.json(await installerDescriptor());
      return;
    }

    // An installer, matched against the artifacts `installer/build.ps1` has recorded — by its
    // versioned name or the versionless alias the application links to. Any other name falls
    // through to the static handler, which is an honest 404: asking for a file by name is not a
    // way to enumerate the filesystem, and encoded traversal never reaches a path.
    if (req.method === "GET" || req.method === "HEAD") {
      if (req.path.startsWith("/installer/")) {
        const wanted = req.path.slice("/installer/".length);
        const latest = installerBuild();
        const release =
          latest && wanted === installerStableName(latest.fileName)
            ? latest
            : installerRelease(wanted);
        if (release) {
          res.download(release.path, release.fileName);
          return;
        }
        next();
        return;
      }
    }

    setTaskpaneCsp(res);
    addinFiles(req, res, next);
  });

  console.log(`[C7NTAX] Outlook add-in served from /addin (${addinDirectory()})`);
}
