/**
 * Password helpers for EmailConnector rows (kumoCrypto-backed).
 * Kept in a standalone service so routes and the connector runtime can share
 * them without circular imports.
 */
import { encrypt, decrypt } from "./kumoCrypto";

export function encryptPassword(plain: string): string {
  const e = encrypt(plain);
  return JSON.stringify(e);
}

export function decryptPassword(stored: string): string {
  try {
    const e = JSON.parse(stored) as { ciphertext: string; iv: string; authTag: string };
    return decrypt(e.ciphertext, e.iv, e.authTag);
  } catch {
    return stored; // legacy/plaintext fallback
  }
}
