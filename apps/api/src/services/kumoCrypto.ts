import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;

/** Stamped on every row this module writes, so a future rotation can tell the generations apart. */
export const CURRENT_KEY_ID = "v1";

/** The public development secret, used only when nothing else is configured. */
const DEV_JWT_FALLBACK = "C7NTAX-dev-secret-change-in-prod";

type KeySource = "KUMO_MASTER_KEY" | "JWT_SECRET" | "development-default";

interface ResolvedKey {
  key: Buffer;
  source: KeySource;
}

/**
 * `KUMO_MASTER_KEY` is 32 bytes as base64 — the documented format, 44 characters, in
 * `infra/README.md`, `infra/env/.env.production.example` and both `.bicepparam` files. Hex is also
 * accepted because it was the only form the code ever read.
 *
 * A key that is present but unusable is a configuration error, and refusing it is the whole point:
 * the previous test was `length >= 64` with a hex parse, so a documented base64 key was silently
 * skipped and the vault was encrypted with a key derived from `JWT_SECRET`. The Key Vault key
 * protected nothing, and nothing anywhere said so (KUMO-SECURITY-REVIEW.md, finding 1).
 */
function decodeMasterKey(raw: string): Buffer {
  const value = raw.trim();
  let key: Buffer;

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else if (/^[0-9a-fA-F]+$/.test(value) && value.length > 64) {
    // The previous code accepted this and silently kept the first 32 bytes. Reporting a base64 byte
    // count for a value that was supplied as hex tells the operator nothing about what went wrong.
    throw new Error(
      `KUMO_MASTER_KEY is not a valid key: it is ${value.length} hex characters. The previous code used the ` +
        `first 64 of them (32 bytes) and ignored the rest, so ciphertext written by that code is under a ` +
        `truncated key. Supply exactly 64 hex characters or 32 bytes base64, and run \`pnpm kumo:reencrypt\` ` +
        `if the vault already holds rows.`
    );
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `KUMO_MASTER_KEY is not a valid key: expected 32 bytes as base64 (44 characters) or 64 hex ` +
          `characters, but the value decodes to ${key.length} bytes.`
      );
    }
  } else {
    throw new Error(
      `KUMO_MASTER_KEY is not a valid key: expected 32 bytes as base64 (44 characters) or 64 hex ` +
        `characters, but the value contains characters that are neither.`
    );
  }

  // All zeros is what a placeholder or a Buffer.alloc(32) produces, and a single repeated byte is what a
  // template or a typed-in key looks like. Both are well formed, pass every other check here, and would
  // silently become the vault key.
  if (key.every((b) => b === 0)) {
    throw new Error(
      `KUMO_MASTER_KEY is 32 zero bytes, which is a placeholder rather than a key. Generate one with ` +
        `\`openssl rand -base64 32\`.`
    );
  }
  if (key.every((b) => b === key[0])) {
    throw new Error(
      `KUMO_MASTER_KEY is the same byte repeated 32 times, which is a placeholder rather than a key. ` +
        `Generate one with \`openssl rand -base64 32\`.`
    );
  }

  return key;
}

/** The derivation used before the master key was parsed correctly. Only the re-encryption job needs it. */
export function legacyVaultKey(): Buffer {
  return deriveVaultKeyFrom(process.env.JWT_SECRET || DEV_JWT_FALLBACK);
}

/** The same derivation for an explicit secret, so a job can reach a generation written under another one. */
export function deriveVaultKeyFrom(secret: string): Buffer {
  return createHash("sha256").update("kumo-vault:" + secret).digest().slice(0, KEY_BYTES);
}

/** Exported so the re-encryption job can name the generation it is looking for rather than restate it. */
export const DEVELOPMENT_SECRET = DEV_JWT_FALLBACK;

function resolve(): ResolvedKey {
  const envKey = process.env.KUMO_MASTER_KEY;
  if (envKey !== undefined && envKey.trim() !== "") {
    return { key: decodeMasterKey(envKey), source: "KUMO_MASTER_KEY" };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "KUMO_MASTER_KEY must be set and usable when NODE_ENV=production. Refusing to start rather than " +
        "derive the vault key from JWT_SECRET, which would leave every stored credential readable by anyone " +
        "holding the signing secret. If this host should not be treated as production, set NODE_ENV to " +
        "something else; if it should, supply the key."
    );
  }
  const base = process.env.JWT_SECRET;
  return { key: legacyVaultKey(), source: base ? "JWT_SECRET" : "development-default" };
}

// Resolved on first use, not at module load. The key was previously frozen at import time, which made
// it depend on whether the environment happened to be loaded first — it worked only because requiring
// @prisma/client loads .env as a side effect, and one reordered import would have derived the vault key
// from a constant in this repository with no error.
let cached: ResolvedKey | null = null;

function resolved(): ResolvedKey {
  if (!cached) cached = resolve();
  return cached;
}

/** A short identifier for the key in use. Safe to log; it does not reveal the key. */
export function kumoKeyStatus(): { source: KeySource; fingerprint: string } {
  const { key, source } = resolved();
  return { source, fingerprint: createHash("sha256").update(key).digest("hex").slice(0, 12) };
}

/**
 * Called once at startup so a broken configuration fails at boot rather than at the first reveal.
 * The restart is cheap; a vault nobody can decrypt, discovered by a technician mid-incident, is not.
 */
export function assertKumoKeyUsable(): void {
  const { source, fingerprint } = kumoKeyStatus();
  console.log(`[KumoCrypto] Vault key from ${source}, fingerprint ${fingerprint}`);
  if (source !== "KUMO_MASTER_KEY") {
    console.warn(
      `[KumoCrypto] KUMO_MASTER_KEY is not set, so the vault key comes from ${source}. This is refused when ` +
        `NODE_ENV=production; if this host is a real deployment but NODE_ENV is not "production", the check ` +
        `will not fire, so set it or set the key. Ciphertext written now must be re-encrypted ` +
        `(pnpm kumo:reencrypt) before the master key can be relied on.`
    );
  }
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, resolved().key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: (cipher as any).getAuthTag().toString("base64"),
  };
}

export function decrypt(ciphertext: string, iv: string, authTag: string): string {
  return decryptWithKey(resolved().key, ciphertext, iv, authTag);
}

/** Decrypt under a caller-supplied key. The re-encryption job uses this to read legacy ciphertext. */
export function decryptWithKey(key: Buffer, ciphertext: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  (decipher as any).setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Zeroes a buffer. It is **not** a control on plaintext lifetime: every caller passes
 * `Buffer.from(someString)`, a fresh copy, and JavaScript strings are immutable, so the original is
 * untouched. Kept because callers exist, but do not count it as protection in an audit
 * (KUMO-SECURITY-REVIEW.md, finding 12).
 */
export function secureClear(buf: Buffer): void {
  buf.fill(0);
}
