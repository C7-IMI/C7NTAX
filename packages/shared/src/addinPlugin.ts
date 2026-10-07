/**
 * The Outlook add-in as a versioned artifact: its identity, its version, and the payload it is
 * made of.
 *
 * One definition, because three callers have to agree and each one failing differently:
 *
 *   · the **API** serves the manifest's version and has to know whether the installer on offer
 *     is older than the files it is serving;
 *   · the **build script** stamps the version into the MSI and records what it was built from;
 *   · the **guard** refuses a plugin change that has not been versioned, and a version that has
 *     no installer.
 *
 * The hashing lives here rather than in the scripts so the answer cannot differ between the
 * guard that passes and the API that reports. It takes its file reads as a callback because
 * `packages/shared` is bundled into the browser as well, and `node:fs` has no business in it.
 */

/** The files that make up the plugin. Adding one here is what makes it versioned. */
export const ADDIN_PAYLOAD = [
  "manifest.xml",
  "taskpane.html",
  "taskpane.js",
  "commands.html",
  "commands.js",
  "styles.css",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-80.png",
] as const;

/**
 * The plugin's own record, written by `pnpm plugin:bump` and read by everything else.
 *
 * `sourceHash` is the reason the record exists: it is what lets a change to the pane be *detected*
 * rather than remembered. A plugin that was edited without being versioned and rebuilt fails the
 * guard, and an installer built before the last edit is reported as stale on the screen that
 * offers it.
 */
export type AddinPluginRecord = {
  /** Office's identity for the add-in — the manifest's `<Id>`, and the registry value name. */
  id: string;
  /** `YY.M.PPPP`, monotonic across releases. Stamped into the manifest and the MSI. */
  version: string;
  /** The application release this version shipped with, for traceability back to BuildNotes. */
  release: string;
  /** SHA-256 over `ADDIN_PAYLOAD`, in the order listed. */
  sourceHash: string;
};

/**
 * A stable digest of the payload.
 *
 * Length-prefixed and path-qualified per file so that two different payloads cannot produce the
 * same digests by concatenation — `ab` + `c` and `a` + `bc` are different files, and a hash that
 * says otherwise would let an unversioned change through.
 */
export async function computeAddinSourceHash(
  readFile: (relativePath: string) => Promise<Uint8Array | null>,
): Promise<string> {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const relativePath of ADDIN_PAYLOAD) {
    const content = await readFile(relativePath);
    // A missing file is part of the payload's identity, not an error: the hash has to change
    // when a file is deleted, and it has to be computable by a guard that runs before a build.
    const bytes = content ?? new Uint8Array();
    parts.push(encoder.encode(`${relativePath}:${bytes.length}:`));
    parts.push(bytes);
  }

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  const digest = await sha256(joined);
  return digest;
}

/** WebCrypto in the browser and the API, `node:crypto` in a script that has no global crypto. */
async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hash = await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The plugin version for an application release.
 *
 * Derived from the release so the two can never disagree about which build a plugin belongs to —
 * and mapped the same way the MSI version is, because Windows Installer cannot hold a four-digit
 * year. `2026.10.7.031` becomes `26.10.7031`.
 */
export function pluginVersionForRelease(release: string): string | null {
  const match = /^(\d{4})\.(\d+)\.(\d+)\.(\d+)$/.exec(release.trim());
  if (!match) return null;
  const year = match[1] ?? "";
  const month = match[2] ?? "0";
  const patch = Number(match[3] ?? 0);
  const build = Number(match[4] ?? 0);
  return `${year.slice(2)}.${month}.${patch * 1000 + build}`;
}

/** Office wants four numeric fields, each below 65536. */
export function officeManifestVersion(pluginVersion: string): string {
  const [major = "0", minor = "0", build = "0"] = pluginVersion.split(".");
  return `${major}.${minor}.${build}.0`;
}
