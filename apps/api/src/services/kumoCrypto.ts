import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";

// Derive a stable key from JWT_SECRET or use environment variable.
// KEY is computed once at module load and stays stable across restarts.
function deriveKey(): Buffer {
  const envKey = process.env.KUMO_MASTER_KEY;
  if (envKey && envKey.length >= 64) {
    return Buffer.from(envKey, "hex").slice(0, 32);
  }
  // Fallback: derive from JWT secret (stable across restarts in dev)
  const base = process.env.JWT_SECRET || "C7NTAX-dev-secret-change-in-prod";
  const hash = createHash("sha256").update("kumo-vault:" + base).digest();
  return hash.slice(0, 32);
}

const KEY = deriveKey();
console.log("[KumoCrypto] Key initialized (length:" + KEY.length + ")");

export function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: (cipher as any).getAuthTag().toString("base64"),
  };
}

export function decrypt(ciphertext: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(iv, "base64"));
  (decipher as any).setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function secureClear(buf: Buffer): void {
  buf.fill(0);
}
