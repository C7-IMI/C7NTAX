/**
 * Re-encrypts every value protected by the Kumo vault key: the key derived from `JWT_SECRET` → the
 * key supplied as `KUMO_MASTER_KEY`.
 *
 * Why this is needed. `KUMO_MASTER_KEY` is documented as 32 bytes base64 in `infra/README.md`, both
 * `.bicepparam` files and `infra/env/.env.production.example`, but the code accepted only hex of 64
 * characters or more. Every documented deployment therefore supplied a key that was silently skipped,
 * and the vault was encrypted under a key derived from `JWT_SECRET` — so the key in Key Vault
 * protected nothing. Fixing the parsing alone would leave every existing row unreadable, which is why
 * the parsing fix and this job belong together (KUMO-SECURITY-REVIEW.md, finding 1).
 *
 * Idempotent: a value that already decrypts under the current key is left untouched, so this is safe
 * to re-run. Dry run by default, and it never overwrites a value it cannot read.
 *
 *   pnpm kumo:reencrypt          # report only, writes nothing
 *   pnpm kumo:reencrypt:apply    # re-encrypt the legacy rows
 */
import { PrismaClient } from "@prisma/client";
import {
  encrypt,
  decrypt,
  decryptWithKey,
  legacyVaultKey,
  kumoKeyStatus,
  CURRENT_KEY_ID,
} from "./services/kumoCrypto";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type Triple = { ciphertext: string; iv: string; authTag: string };
type Verdict = "current" | "legacy" | "unreadable" | "empty";

const legacyKey = legacyVaultKey();

/**
 * Which key reads this value. GCM authenticates, so the wrong key fails outright rather than returning
 * plausible rubbish — which is what makes trial decryption a safe way to tell the generations apart.
 */
function classify(t: Triple): Verdict {
  if (!t.ciphertext) return "empty";
  try {
    decrypt(t.ciphertext, t.iv, t.authTag);
    return "current";
  } catch {
    try {
      decryptWithKey(legacyKey, t.ciphertext, t.iv, t.authTag);
      return "legacy";
    } catch {
      return "unreadable";
    }
  }
}

function readable(t: Triple): string | null {
  try {
    return decrypt(t.ciphertext, t.iv, t.authTag);
  } catch {
    try {
      return decryptWithKey(legacyKey, t.ciphertext, t.iv, t.authTag);
    } catch {
      return null;
    }
  }
}

/** `totpSecret` is either `ciphertext:iv:authTag` or a bare ciphertext sharing the row's iv/authTag. */
function parseTotp(stored: string, rowIv: string, rowAuthTag: string): Triple {
  const parts = stored.split(":");
  const [ciphertext, iv, authTag] = parts;
  if (parts.length === 3 && ciphertext && iv && authTag) return { ciphertext, iv, authTag };
  return { ciphertext: stored, iv: rowIv, authTag: rowAuthTag };
}

/** Email-connector secrets are stored as JSON of the same triple, or as plaintext from before encryption. */
function parseJsonTriple(stored: string): Triple | null {
  try {
    const v = JSON.parse(stored) as Partial<Triple>;
    if (typeof v?.ciphertext === "string" && typeof v?.iv === "string" && typeof v?.authTag === "string") {
      return { ciphertext: v.ciphertext, iv: v.iv, authTag: v.authTag };
    }
    return null;
  } catch {
    return null;
  }
}

const tally = { current: 0, legacy: 0, unreadable: 0, empty: 0, plaintext: 0 };
const problems: string[] = [];

async function reencryptPasswords(): Promise<number> {
  const rows = await prisma.kumoPassword.findMany({
    select: { id: true, label: true, encryptedPassword: true, iv: true, authTag: true, totpSecret: true, encryptionKeyId: true },
  });
  let changed = 0;

  for (const row of rows) {
    const data: Record<string, unknown> = {};
    let touched = false;

    const password: Triple = { ciphertext: row.encryptedPassword, iv: row.iv, authTag: row.authTag };
    const verdict = classify(password);
    tally[verdict]++;
    if (verdict === "legacy") {
      const plaintext = readable(password);
      if (plaintext !== null) {
        const e = encrypt(plaintext);
        data.encryptedPassword = e.ciphertext;
        data.iv = e.iv;
        data.authTag = e.authTag;
        touched = true;
      }
    } else if (verdict === "unreadable") {
      problems.push(`KumoPassword ${row.id} ("${row.label}") cannot be read with either key — left untouched`);
    }

    if (row.totpSecret) {
      const totp = parseTotp(row.totpSecret, row.iv, row.authTag);
      const tverdict = classify(totp);
      if (tverdict === "legacy") {
        const secret = readable(totp);
        if (secret !== null) {
          // Written back in the self-contained `ct:iv:tag` form, which stops it depending on the row's
          // iv/authTag — those are shared with the password and change when the password is re-encrypted.
          const e = encrypt(secret);
          data.totpSecret = `${e.ciphertext}:${e.iv}:${e.authTag}`;
          touched = true;
        }
      } else if (tverdict === "unreadable") {
        problems.push(`KumoPassword ${row.id} has a two-factor secret that neither key can read — left untouched`);
      }
    }

    if (touched) {
      data.encryptionKeyId = CURRENT_KEY_ID;
      changed++;
      if (apply) await prisma.kumoPassword.update({ where: { id: row.id }, data });
    }
  }
  return changed;
}

async function reencryptConnectors(): Promise<number> {
  const rows = await prisma.emailConnector.findMany({
    select: { id: true, host: true, passwordEncrypted: true, clientSecretEncrypted: true, oauthRefreshTokenEncrypted: true },
  });
  let changed = 0;

  for (const row of rows) {
    const data: Record<string, unknown> = {};
    let touched = false;

    const fields: [string, string | null][] = [
      ["passwordEncrypted", row.passwordEncrypted],
      ["clientSecretEncrypted", row.clientSecretEncrypted],
      ["oauthRefreshTokenEncrypted", row.oauthRefreshTokenEncrypted],
    ];

    for (const [field, stored] of fields) {
      if (!stored) continue;
      const triple = parseJsonTriple(stored);
      if (!triple) {
        // decryptPassword() returns the stored string when it cannot be parsed, so this is pre-encryption
        // plaintext rather than a key problem.
        tally.plaintext++;
        continue;
      }
      const verdict = classify(triple);
      tally[verdict]++;
      if (verdict === "legacy") {
        const plaintext = readable(triple);
        if (plaintext !== null) {
          data[field] = JSON.stringify(encrypt(plaintext));
          touched = true;
        }
      } else if (verdict === "unreadable") {
        problems.push(`EmailConnector ${row.id} (${row.host}) field ${field} cannot be read with either key — left untouched`);
      }
    }

    if (touched) {
      changed++;
      if (apply) await prisma.emailConnector.update({ where: { id: row.id }, data });
    }
  }
  return changed;
}

async function main(): Promise<void> {
  const status = kumoKeyStatus();
  console.log(`[kumo:reencrypt] ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[kumo:reencrypt] vault key: ${status.source}, fingerprint ${status.fingerprint}`);
  if (status.source !== "KUMO_MASTER_KEY") {
    console.log(
      "[kumo:reencrypt] KUMO_MASTER_KEY is not set, so the current key *is* the legacy key and nothing needs moving."
    );
  }

  const passwords = await reencryptPasswords();
  const connectors = await reencryptConnectors();

  console.log("");
  console.log(`[kumo:reencrypt] values already on the current key : ${tally.current}`);
  console.log(`[kumo:reencrypt] values on the legacy key          : ${tally.legacy}`);
  console.log(`[kumo:reencrypt] values neither key can read        : ${tally.unreadable}`);
  console.log(`[kumo:reencrypt] empty values                       : ${tally.empty}`);
  console.log(`[kumo:reencrypt] connector values stored in plaintext: ${tally.plaintext}`);
  console.log(`[kumo:reencrypt] rows re-encrypted: ${passwords} password row(s), ${connectors} connector row(s)`);

  if (problems.length) {
    console.log("");
    console.log("[kumo:reencrypt] needs attention:");
    for (const problem of problems) console.log(`  - ${problem}`);
  }

  if (!apply && passwords + connectors > 0) {
    console.log("");
    console.log("[kumo:reencrypt] Nothing was written. Re-run with --apply to re-encrypt.");
  }
}

main()
  .catch((e) => {
    console.error("[kumo:reencrypt] failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());