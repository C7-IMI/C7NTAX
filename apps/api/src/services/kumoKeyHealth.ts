/**
 * Opens a sample of stored values with the key actually in use, and says so loudly when none of them opens.
 *
 * The assertion beside this one validates the *shape* of `KUMO_MASTER_KEY`. That is not the same as the key
 * being the one the data was written under. A rotated Key Vault value, or a database restored from a backup
 * taken before a rotation, produces a key that is perfectly well formed and opens nothing — and every
 * symptom then appears at the first reveal, which is the worst possible moment to discover it.
 *
 * Deliberately **not** a boot refusal. A data problem should not take ticketing down: an instance that reads
 * tickets correctly and cannot open the vault is more useful, and more diagnosable, than one that will not
 * start. The point is to have the log say what is wrong before a technician finds it.
 *
 * Prisma is imported at the point of use, because index.ts imports this module and would otherwise still be
 * assembling its exports.
 */
import { decrypt, kumoKeyStatus } from "./kumoCrypto";
import { logger } from "./logger";

/** Enough rows that a wrong key is certain to show, few enough to be free at startup. */
const SAMPLE_SIZE = 20;

export async function warnIfKeyCannotOpenVault(): Promise<void> {
  try {
    const { prisma } = await import("../index");
    const rows = await prisma.kumoPassword.findMany({
      select: { encryptedPassword: true, iv: true, authTag: true },
      take: SAMPLE_SIZE,
    });

    // An empty vault agrees with any key, which is the state of a first deploy.
    if (rows.length === 0) return;

    let opened = 0;
    for (const row of rows) {
      try {
        decrypt(row.encryptedPassword, row.iv, row.authTag);
        opened++;
      } catch {
        // Counted by the total below; one unreadable row is not on its own a key problem.
      }
    }
    if (opened === rows.length) return;

    const { source, fingerprint } = kumoKeyStatus();
    logger.warn(
      "startup",
      `the vault key from ${source} (fingerprint ${fingerprint}) opened ${opened} of ${rows.length} sampled ` +
        `passwords. Reveals will fail for the rest. This is what a rotated key or a database restored from ` +
        `before a rotation looks like: the key is well formed but is not the one the data was written under. ` +
        `Do not re-encrypt in response to this until you have established which key the data belongs to.`
    );
  } catch {
    // A check that cannot run must never affect startup.
  }
}