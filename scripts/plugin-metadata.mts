/**
 * The plugin's version record: read it, check it, or bump it.
 *
 * Three modes, all sharing one implementation of the hash with the API (see
 * `packages/shared/src/addinPlugin.ts`) so a guard that passes and an application that reports
 * cannot disagree:
 *
 *   print   the resolved record as JSON, for `build.ps1` to stamp into the MSI
 *   check   exit 1 if the payload has changed since the record was written
 *   bump    recompute the hash and set the version from the current release
 *
 * `check` is the rule the user asked for — *if changes are made to the plugin, the installer should
 * be updated too* — expressed as something that fails rather than something somebody remembers.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADDIN_PAYLOAD,
  computeAddinSourceHash,
  pluginVersionForRelease,
  type AddinPluginRecord,
} from "../packages/shared/src/addinPlugin.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "apps", "outlook-addin");
const recordPath = path.join(pluginDir, "plugin.json");

const read = (relativePath: string) =>
  readFile(path.join(pluginDir, relativePath)).catch(() => null);

async function loadRecord(): Promise<AddinPluginRecord> {
  try {
    return JSON.parse(await readFile(recordPath, "utf8")) as AddinPluginRecord;
  } catch {
    throw new Error(`${recordPath} is missing or unreadable. Run: pnpm plugin:bump`);
  }
}

/** The release at the top of BuildNotes — the same source the installer version comes from. */
async function currentRelease(): Promise<string> {
  const notes = await readFile(path.join(root, "BuildNotes.md"), "utf8");
  const match = /^##\s+(\d{4}\.\d+\.\d+\.\d+)/m.exec(notes);
  if (!match) throw new Error("BuildNotes.md has no version heading. Run: node scripts/next-version.mjs");
  return match[1];
}

/** Every plugin version present in the installer history, newest first. */
async function installerReleases(): Promise<Array<{ fileName: string; pluginVersion?: string; sourceHash?: string }>> {
  try {
    const index = JSON.parse(await readFile(path.join(root, "installer", "artifacts", "index.json"), "utf8"));
    return Array.isArray(index.releases) ? index.releases : [];
  } catch {
    return [];
  }
}

const mode = process.argv[2] ?? "check";
const record = await loadRecord();
const actualHash = await computeAddinSourceHash(read);

if (mode === "print") {
  const latest = (await installerReleases())[0];
  console.log(JSON.stringify({
    ...record,
    actualHash,
    installer: latest
      ? { fileName: latest.fileName, pluginVersion: latest.pluginVersion ?? null, sourceHash: latest.sourceHash ?? null }
      : null,
  }));
  process.exit(0);
}

if (mode === "bump") {
  const release = await currentRelease();
  const version = pluginVersionForRelease(release);
  if (!version) throw new Error(`Cannot derive a plugin version from release "${release}".`);

  const updated: AddinPluginRecord = { ...record, version, release, sourceHash: actualHash };
  await writeFile(recordPath, JSON.stringify(updated, null, 2) + "\n");

  console.log(
    actualHash === record.sourceHash
      ? `plugin record is up to date (${version}); the payload is unchanged`
      : `plugin ${record.version} -> ${version} for release ${release}\n  payload ${record.sourceHash.slice(0, 12)} -> ${actualHash.slice(0, 12)}`
  );
  process.exit(0);
}

// ── check ─────────────────────────────────────────────────────────────────────
const problems: string[] = [];

if (record.sourceHash !== actualHash) {
  problems.push(
    `the plugin payload has changed since it was versioned:\n` +
    `    record  ${record.sourceHash}\n` +
    `    payload ${actualHash}\n` +
    `  Run: pnpm plugin:bump, then rebuild the installer (pnpm installer:build).`
  );
}

const releases = await installerReleases();
const latest = releases[0];
if (!latest) {
  problems.push(
    "there is no installer in the history. Build one: pnpm installer:build\n" +
    "  (An add-in that ships without an installer cannot be installed from C7NC.)"
  );
} else {
  if (latest.pluginVersion && latest.pluginVersion !== record.version) {
    problems.push(
      `the newest installer is plugin ${latest.pluginVersion} but the plugin is ${record.version}.\n` +
      `  Rebuild it: pnpm installer:build`
    );
  }
  if (latest.sourceHash && latest.sourceHash !== actualHash) {
    problems.push(
      `the newest installer was built from an older plugin payload (` +
      `${latest.sourceHash.slice(0, 12)} vs ${actualHash.slice(0, 12)}).\n` +
      `  Rebuild it: pnpm installer:build`
    );
  }
}

if (problems.length) {
  console.error("plugin-installer check: the plugin and its installer are out of step.\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(
  `plugin-installer check: plugin ${record.version} (release ${record.release}) matches ` +
  `${latest.fileName}, payload ${actualHash.slice(0, 12)}`
);
