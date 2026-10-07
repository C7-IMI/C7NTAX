/**
 * The Outlook add-in as a *package*: the manifest Office reads and the Windows installer that
 * registers it.
 *
 * The manifest on disk keeps three placeholders, because the origin, the add-in's identity and its
 * version differ per deployment or per build — and nothing used to replace them. `/addin` is served
 * straight off disk by `express.static`, so a manifest downloaded from a running server still read
 * `__ADDIN_HOST__/addin/taskpane.html` and Office refused to load the add-in without saying why.
 * The substitution happens here, once, so the served manifest, the installer build and the
 * deployment report cannot disagree — the same reason `addinAssets.ts` exists.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { addinDirectory } from "./addinAssets";
import {
  ADDIN_PAYLOAD,
  computeAddinSourceHash,
  officeManifestVersion,
  type AddinPluginRecord,
} from "@C7NTAX/shared";

const PLACEHOLDER_HOST = "__ADDIN_HOST__";
const PLACEHOLDER_ID = "__ADDIN_GUID__";
const PLACEHOLDER_VERSION = "__ADDIN_VERSION__";

/**
 * The plugin's own record — identity, version, and the hash of the payload it was versioned from.
 *
 * Read from `apps/outlook-addin/plugin.json` rather than kept as a constant here, because the build
 * script and the guard have to see the same file: a version this module invented could disagree
 * with the version stamped into the installer that this module then offers for download.
 */
export function addinPlugin(): AddinPluginRecord {
  const fallback: AddinPluginRecord = {
    id: "d25125d4-fcab-47bb-82a8-89a19450042a",
    version: "0.0.0",
    release: "unknown",
    sourceHash: "",
  };
  const configuredId = (process.env.OUTLOOK_ADDIN_GUID || "").trim();
  try {
    const raw = JSON.parse(readFileSync(path.join(addinDirectory(), "plugin.json"), "utf8")) as Partial<AddinPluginRecord>;
    return {
      id: configuredId || raw.id || fallback.id,
      version: raw.version || fallback.version,
      release: raw.release || fallback.release,
      sourceHash: raw.sourceHash || fallback.sourceHash,
    };
  } catch {
    return { ...fallback, id: configuredId || fallback.id };
  }
}

/**
 * The add-in's identity in the sense Office means it: the `<Id>` GUID in the manifest.
 *
 * Fixed rather than generated. Office treats a new GUID as a different add-in, so a deployment
 * that regenerated it would strand every mailbox that had already sideloaded the previous one.
 * `OUTLOOK_ADDIN_GUID` overrides it, which is the escape hatch for a deployment that wants its
 * own identity (an AppSource listing, say).
 */
export function addinId(): string {
  return addinPlugin().id;
}

/**
 * Whether the add-in's own files have changed since the plugin was versioned.
 *
 * Cached for a minute: it hashes nine small files, and the answer only needs to keep up with a
 * deployment rather than with a keystroke. Recomputing per request would put nine synchronous
 * reads in front of every page load of the install screen.
 */
let sourceHashCache: { hash: string; at: number } | null = null;
const SOURCE_HASH_TTL_MS = 60_000;

export async function addinCurrentSourceHash(): Promise<string> {
  if (sourceHashCache && Date.now() - sourceHashCache.at < SOURCE_HASH_TTL_MS) return sourceHashCache.hash;
  const dir = addinDirectory();
  const hash = await computeAddinSourceHash(async (relativePath) => {
    try {
      return readFileSync(path.join(dir, relativePath));
    } catch {
      return null;
    }
  });
  sourceHashCache = { hash, at: Date.now() };
  return hash;
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
  // The version is stretched to Office's four fields here, so the single `YY.M.PPPP` in
  // plugin.json is the only version anybody maintains and the manifest cannot drift from the MSI.
  return source
    .split(PLACEHOLDER_HOST).join(origin)
    .split(PLACEHOLDER_ID).join(id)
    .split(PLACEHOLDER_VERSION).join(officeManifestVersion(addinPlugin().version));
}

export type InstallerRelease = {
  fileName: string;
  /** Absolute path on this machine, resolved from the history rather than from the request. */
  path: string;
  size: number;
  /** The plugin version this installer registers, `YY.M.PPPP`. */
  pluginVersion: string;
  /** The application release the plugin shipped in, for tracing back to BuildNotes. */
  productVersion: string;
  /** The origin baked into the manifest this installer registers. */
  addinHost: string;
  addinId: string;
  builtAt: string;
  sha256: string;
  /** Hash of the plugin payload this installer was built from. */
  sourceHash: string;
};

/**
 * Where `installer/build.ps1` writes its output.
 *
 * Deliberately not `dist/` or `release/`: the repository ignores both wholesale, and the artifacts
 * have to be committed for the in-app download to work from a fresh clone.
 */
export function installerDirectory(): string {
  return (
    process.env.OUTLOOK_ADDIN_INSTALLER_DIR ||
    path.resolve(__dirname, "..", "..", "..", "..", "installer", "artifacts")
  );
}

/**
 * A versionless alias for the newest artifact.
 *
 * The versioned name is the honest one to put on disk, but nothing outside this module knows it —
 * and the download button is shown to every signed-in user, most of whom cannot read the deployment
 * report that would tell them the filename. This is the name the application links to; the response
 * still carries the real filename, so a saved copy is still identifiable.
 */
export function installerStableName(fileName: string): string {
  const extension = path.extname(fileName) || ".msi";
  return `C7NTAX-OutlookAddIn${extension}`;
}

/**
 * Every installer this deployment has, newest first.
 *
 * The history is what makes a rollback possible: a plugin change can be the reason a mailbox
 * misbehaves, and the remedy is to install the version that worked rather than to wait for a fix.
 * Only artifacts named in `index.json` are ever served, so the request path never becomes a
 * filesystem path — a name is a lookup, not a route.
 */
export function installerHistory(): InstallerRelease[] {
  let raw: { releases?: unknown };
  try {
    raw = JSON.parse(readFileSync(path.join(installerDirectory(), "index.json"), "utf8")) as { releases?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(raw.releases)) return [];

  const dir = installerDirectory();
  const out: InstallerRelease[] = [];
  for (const entry of raw.releases as Array<Record<string, unknown>>) {
    const text = (key: string): string => (typeof entry[key] === "string" ? (entry[key] as string) : "");
    const fileName = text("fileName");
    if (!fileName) continue;
    // `basename` because the name is written by the build script but read by a server: a history
    // entry is data, and data does not get to name a path outside the directory it lives in.
    const file = path.join(dir, path.basename(fileName));
    try {
      const stats = statSync(file);
      if (!stats.isFile()) continue;
      out.push({
        fileName: path.basename(fileName),
        path: file,
        size: stats.size,
        pluginVersion: text("pluginVersion"),
        productVersion: text("productVersion"),
        addinHost: text("addinHost"),
        addinId: text("addinId") || addinId(),
        builtAt: text("builtAt"),
        sha256: text("sha256"),
        sourceHash: text("sourceHash"),
      });
    } catch {
      // A history entry whose artifact has been removed is skipped rather than reported: the file
      // is the thing being offered, and offering a row that cannot be downloaded is worse than
      // offering fewer rows.
    }
  }
  return out;
}

/** The newest installer, or null when none has been built here. */
export function installerBuild(): InstallerRelease | null {
  return installerHistory()[0] ?? null;
}

/** One named release from the history, or null. The only way an artifact is ever served. */
export function installerRelease(fileName: string): InstallerRelease | null {
  const base = path.basename(fileName);
  return installerHistory().find((release) => release.fileName === base) ?? null;
}

/**
 * The public description of what is on offer — everything a user needs in order to install it, and
 * nothing about the deployment except the one fact that matters to the file they are about to run.
 *
 * A JSON endpoint rather than the obvious "send a HEAD and see": a probed HEAD that fails for any
 * transient reason would have the page state that no installer exists, which is a false claim about
 * a file that is sitting right there. Asking once for a description means the page can be wrong
 * only about *when*, never about *whether*.
 */
export async function installerDescriptor(): Promise<Record<string, unknown>> {
  const plugin = addinPlugin();
  const currentHash = await addinCurrentSourceHash();
  const history = installerHistory();
  const latest = history[0];

  if (!latest) {
    return {
      available: false,
      plugin: { version: plugin.version, release: plugin.release, sourceHash: currentHash },
      versions: [],
    };
  }

  // Whether the newest installer was built from the payload being served now. Reported per entry,
  // because a rollback target that predates the current plugin is *supposed* to differ — what
  // matters is which ones match, and the newest one matching is the healthy state.
  const describe = (release: InstallerRelease) => ({
    fileName: release.fileName,
    pluginVersion: release.pluginVersion,
    productVersion: release.productVersion,
    size: release.size,
    builtAt: release.builtAt,
    sha256: release.sha256,
    sourceHash: release.sourceHash,
    addinHost: release.addinHost,
    matchesPlugin: release.sourceHash === currentHash,
    downloadPath: `/addin/installer/${release.fileName}`,
  });

  return {
    available: true,
    ...describe(latest),
    /** The versionless name the application links to, which needs no admin rights. */
    stableDownloadPath: `/addin/installer/${installerStableName(latest.fileName)}`,
    /** True when the newest installer is older than the plugin files in this deployment. */
    stale: Boolean(latest.sourceHash) && latest.sourceHash !== currentHash,
    plugin: { version: plugin.version, release: plugin.release, sourceHash: currentHash },
    versions: history.map(describe),
  };
}
