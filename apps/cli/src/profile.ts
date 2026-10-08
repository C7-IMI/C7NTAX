/**
 * The c7ntax profile: which server, and which API key.
 *
 * Kept in `~/.c7ntax/config.json`, mode `0600`, with the key stored as the API gave it and nothing else.
 * **No password is ever stored**, because a password is a credential for a *person* and this file belongs
 * to a program: the key is issued in the application (Administration → API Access), scoped to what its
 * owner holds, attributed to them in the audit trail, and revocable on its own. That is also why losing
 * this file is survivable and losing a config file full of passwords would not be.
 *
 * `C7NTAX_SERVER` and `C7NTAX_KEY` override the file, which is what makes the CLI usable in CI where
 * there is no home directory worth writing to.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Profile {
  server: string;
  /** The API key, as issued. Never printed; only ever sent. */
  apiKey: string;
  /** Who the key belongs to, remembered so `context` can answer without a round trip. */
  account?: string;
  /** The key's own scopes, when the API reported them. */
  scopes?: string[];
}

const DIR = join(homedir(), ".c7ntax");
const FILE = join(DIR, "config.json");

/** The API's own key prefix, used only to give a better error than "401". */
export function looksLikeApiKey(value: string): boolean {
  return /^c7k_/.test(value);
}

export function profilePath(): string {
  return FILE;
}

export function readProfile(): Profile | null {
  try {
    if (!existsSync(FILE)) return null;
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Profile>;
    if (typeof parsed.server !== "string" || typeof parsed.apiKey !== "string") return null;
    return {
      server: parsed.server.replace(/\/+$/, ""),
      apiKey: parsed.apiKey,
      ...(parsed.account ? { account: parsed.account } : {}),
      ...(Array.isArray(parsed.scopes) ? { scopes: parsed.scopes } : {}),
    };
  } catch {
    // A corrupt or unreadable profile is "not signed in", not a crash: the person can log in again.
    return null;
  }
}

export function writeProfile(profile: Profile): string {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  // `writeFileSync`'s mode is subject to the umask and is ignored when the file already exists, so the
  // permissions are set explicitly — a key readable by other accounts on the machine is the one failure
  // this file must not have.
  try {
    chmodSync(FILE, 0o600);
  } catch {
    /* Windows has no POSIX modes; the file is still user-scoped by ACL */
  }
  return FILE;
}

export function clearProfile(): void {
  try {
    if (existsSync(FILE)) writeFileSync(FILE, "{}\n", { mode: 0o600 });
  } catch {
    /* nothing to do */
  }
}

/**
 * The profile in force: the environment first, then the file.
 *
 * The environment wins so a pipeline can point the CLI at a server and a key without writing anything to
 * disk — and so a single command can be aimed at a different deployment without changing what is stored.
 */
export interface ResolvedProfile extends Profile {
  /** Where the values came from, so `context` can say so and a failure can be explained. */
  source: "environment" | "file" | "mixed";
}

export function resolveProfile(): ResolvedProfile | null {
  const file = readProfile();
  const envServer = process.env.C7NTAX_SERVER?.trim();
  const envKey = process.env.C7NTAX_KEY?.trim();

  const server = (envServer || file?.server || "").replace(/\/+$/, "");
  const apiKey = envKey || file?.apiKey || "";
  if (!server || !apiKey) return null;

  const source: ResolvedProfile["source"] =
    envServer && envKey ? "environment" : envServer || envKey ? "mixed" : "file";

  return {
    server,
    apiKey,
    ...(file?.account ? { account: file.account } : {}),
    ...(file?.scopes ? { scopes: file.scopes } : {}),
    source,
  };
}

/** The server's API root, whether it was given with or without the `/api` suffix. */
export function apiBase(server: string): string {
  return /\/api$/.test(server) ? server : `${server}/api`;
}
