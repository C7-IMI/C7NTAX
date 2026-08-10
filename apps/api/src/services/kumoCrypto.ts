import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const KEY = Buffer.from(process.env.KUMO_MASTER_KEY || randomBytes(32).toString("hex"), "hex").slice(0, 32);

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
