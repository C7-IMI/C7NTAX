/**
 * The Outlook add-in as a *package*: the manifest Office reads and the Windows installer that
 * registers it.
 *
 * The manifest on disk keeps two placeholders, because the origin and the add-in's identity
 * differ per deployment — and nothing used to replace them. `/addin` is served straight off
 * disk by `express.static`, so a manifest downloaded from a running server still read
 * `__ADDIN_HOST__/addin/taskpane.html` and Office refused to load the add-in without saying
 * why. The substitution happens here, once, so the served manifest, the installer build and
 * the deployment report cannot disagree about either value — the same reason
 * `addinAssets.ts` exists.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { addinDirectory } from "./addinAssets";

const PLACEHOLDER_HOST = "__ADDIN_HOST__";
const PLACEHOLDER_ID = "__ADDIN_GUID__";

/**
 * The add-in's identity in the sense Office means it: the `<Id>` GUID in the manifest.
 *
 * Fixed rather than generated. Office treats a new GUID as a different add-in, so a
 * deployment that regenerated it would strand every mailbox that had already sideloaded the
 * previous one. `OUTLOOK_ADDIN_GUID` overrides it, which is the escape hatch for a
 * deployment that wants its own identity (an AppSource listing, say).
 */
export const DEFAULT_ADDIN_ID = "d25125d4-fcab-47bb-82a8-89a19450042a";

export function addinId(): string {
  return (process.env.OUTLOOK_ADDIN_GUID || "").trim() || DEFAULT_ADDIN_ID;
}

/**
 * The origin the add-in's URLs must carry.
 *
 * `PUBLIC_BASE_URL` wins: behind the App Gateway (PLAN-016) the request arrives on an
 * internal host, and the manifest has to name the hostname the *user's* Outlook can reach
 * over HTTPS. With nothing set, the request's own host is the best available answer, and is
 * what makes a development run self-consistent.
 */
export function publicOrigin(req?: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = req?.get("host");
  if (host) return `${req!.protocol}://${host}`;
  return `http://localhost:${Number(process.env.PORT) || 4000}`;
}

/** The manifest exactly as it ships, placeholders intact. Null when the folder is not on disk. */
export function addinManifestSource(): string | null {
  try {
    return readFileSync(path.join(addinDirectory(), "manifest.xml"), "utf8");
  } catch {
    return null;
  }
}

/**
 * The manifest Office can actually load.
 *
 * `split`/`join` rather than a regex: the placeholders are literal, and a URL origin is full
 * of characters a regular expression would have to be escaped for.
 */
export function renderAddinManifest(origin: string, id: string = addinId()): string | null {
  const source = addinManifestSource();
  if (!source) return null;
  return source.split(PLACEHOLDER_HOST).join(origin).split(PLACEHOLDER_ID).join(id);
}

export type InstallerBuild = {
  fileName: string;
  /** Absolute path on this machine. */
  path: string;
  size: number;
  version: string;
  /** The version the changelog carries, which differs: Windows Installer cannot hold a four-digit year. */
  productVersion: string;
  /** The origin baked into the manifest this installer registers. */
  addinHost: string;
  addinId: string;
  builtAt: string;
  sha256: string;
};

/**
 * Where `installer/build.ps1` writes its output.
 *
 * Deliberately not a `dist/` directory: the repository ignores `dist/` wholesale, and the
 * artifact is meant to be committed so the in-app download works from a fresh clone.
 */
export function installerDirectory(): string {
  return (
    process.env.OUTLOOK_ADDIN_INSTALLER_DIR ||
    path.resolve(__dirname, "..", "..", "..", "..", "installer", "release")
  );
}

/**
 * A versionless alias for the current artifact.
 *
 * The versioned name is the honest one to put on disk, but nothing outside this module knows it
 * — and the download button is shown to every signed-in user, most of whom cannot read the
 * deployment report that would tell them the filename. This is the name the application links
 * to; the response still carries the real filename, so a saved copy is still identifiable.
 */
export function installerStableName(fileName: string): string {
  const extension = path.extname(fileName) || ".msi";
  return `C7NTAX-OutlookAddIn${extension}`;
}

/**
 * The public description of the current artifact — everything a user needs in order to install
 * it, and nothing about the deployment.
 *
 * A JSON endpoint rather than the obvious "send a HEAD and see": a probed HEAD that fails for
 * any transient reason would have the page state that no installer exists, which is a false
 * claim about a file that is sitting right there. Asking once for a description means the page
 * can be wrong only about *when*, never about *whether*.
 */
export function installerDescriptor(): Record<string, unknown> {
  const build = installerBuild();
  if (!build) return { available: false };
  return {
    available: true,
    fileName: build.fileName,
    version: build.version,
    productVersion: build.productVersion,
    size: build.size,
    builtAt: build.builtAt,
    sha256: build.sha256,
    downloadPath: `/addin/installer/${build.fileName}`,
    /** The versionless name the application links to, which needs no admin rights. */
    stableDownloadPath: `/addin/installer/${installerStableName(build.fileName)}`,
  };
}

/**
 * The built installer, or null when it has not been built here.
 *
 * `build.json` is what makes this answerable rather than guessable: an MSI is a binary, so
 * the version and the origin baked into it cannot be read back out of it, and the page has to
 * be able to say whether the installer it is offering actually points at this server.
 */
export function installerBuild(): InstallerBuild | null {
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(path.join(installerDirectory(), "build.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const fileName = typeof meta.fileName === "string" ? path.basename(meta.fileName) : "";
  if (!fileName) return null;
  const file = path.join(installerDirectory(), fileName);
  let size: number;
  let modified: Date;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) return null;
    size = stats.size;
    modified = stats.mtime;
  } catch {
    return null;
  }
  const text = (key: string): string => (typeof meta[key] === "string" ? (meta[key] as string) : "");
  return {
    fileName,
    path: file,
    size,
    version: text("version"),
    productVersion: text("productVersion"),
    addinHost: text("addinHost"),
    addinId: text("addinId") || addinId(),
    builtAt: text("builtAt") || modified.toISOString(),
    sha256: text("sha256"),
  };
}
