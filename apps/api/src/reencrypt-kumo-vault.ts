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
 * Three generations can exist, because two earlier versions of `kumoCrypto` were in the field:
 *
 *   1. `KUMO_MASTER_KEY` as hex of 64 characters or more, of which only the first 32 bytes were used.
 *      The boot check now refuses that value outright, so this is the oldest generation.
 *   2. `SHA-256("kumo-vault:" + JWT_SECRET)` — and, where `JWT_SECRET` was unset, the built-in
 *      development secret instead. A job that knows only one of the two reports the other's rows as
 *      unreadable, so both are tried.
 *   3. The current key.
 *
 * Idempotent: a value the current key already opens is left untouched, so this is safe to re-run.
 * Dry run by default; it never overwrites a value it cannot read, and every write is conditional on
 * the row still holding what was read, so an edit made while the job runs is never clobbered.
 *
 * **Every consumer of the vault key must appear here.** `services/kumoCrypto.ts` is imported by the
 * Kumo routes (passwords and two-factor secrets) and by `services/emailConnectorCrypto.ts` (the email
 * connector's password, client secret and OAuth refresh token) — both are covered below. A new
 * importer is a new generation of ciphertext this job will not know about.
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
  deriveVaultKeyFrom,
  DEVELOPMENT_SECRET,
  kumoKeyStatus,
  CURRENT_KEY_ID,
} from "./services/kumoCrypto";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type Triple = { ciphertext: string; iv: string; authTag: string };
type Opened = { text: string; via: string };

interface Candidate {
  name: string;
  key: Buffer;
}

/**
 * Every key a previous version of this module could have written with, deduplicated by material so a
 * deployment that sets `JWT_SECRET` to the development secret does not try the same key twice.
 */
function legacyCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (name: string, key: Buffer) => {
    const id = key.toString("hex");
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push({ name, key });
  };

  const configured = process.env.JWT_SECRET;
  add(
    configured ? "the SHA-256 derivation from the configured JWT_SECRET" : "the SHA-256 derivation from the built-in development secret",
    legacyVaultKey()
  );
  if (configured) add("the SHA-256 derivation from the built-in development secret", deriveVaultKeyFrom(DEVELOPMENT_SECRET));

  const raw = process.env.KUMO_MASTER_KEY?.trim();
  if (raw && /^[0-9a-fA-F]+$/.test(raw) && raw.length > 64) {
    add("KUMO_MASTER_KEY truncated to its first 32 bytes (the old hex behaviour)", Buffer.from(raw, "hex").slice(0, 32));
  }
  return candidates;
}

const candidates = legacyCandidates();

/** Which key opens this value, and what it reads as. Null when nothing does. */
function open(t: Triple): Opened | null {
  try {
    return { text: decrypt(t.ciphertext, t.iv, t.authTag), via: "the current key" };
  } catch {
    // Falls through to the older generations.
  }
  for (const candidate of candidates) {
    try {
      return { text: decryptWithKey(candidate.key, t.ciphertext, t.iv, t.authTag), via: candidate.name };
    } catch {
      // Not this generation either.
    }
  }
  return null;
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

const tally = { current: 0, legacy: 0, unreadable: 0, empty: 0, plaintext: 0, conflicts: 0, skipped: 0 };
const problems: string[] = [];

async function reencryptPasswords(): Promise<number> {
  const rows = await prisma.kumoPassword.findMany({
    select: { id: true, label: true, encryptedPassword: true, iv: true, authTag: true, totpSecret: true },
  });
  let changed = 0;

  for (const row of rows) {
    const password: Triple = { ciphertext: row.encryptedPassword, iv: row.iv, authTag: row.authTag };
    const openedPassword = row.encryptedPassword ? open(password) : null;
    if (!row.encryptedPassword) tally.empty++;
    else if (!openedPassword) tally.unreadable++;
    else if (openedPassword.via === "the current key") tally.current++;
    else tally.legacy++;

    // A two-factor secret in its bare form shares the row's iv/authTag with the password. Re-encrypting
    // the password replaces those columns, so a secret that cannot be read cannot be preserved either —
    // and rewriting only half the row would leave the rest pointing at values that no longer exist.
    const totp = row.totpSecret ? parseTotp(row.totpSecret, row.iv, row.authTag) : null;
    const openedTotp = totp ? open(totp) : null;
    if (totp && !openedTotp) {
      tally.skipped++;
      problems.push(
        `KumoPassword ${row.id} ("${row.label}") has a two-factor secret no known key can read, so the whole ` +
          `row was left alone — including its password, which may be re-encryptable on its own if you know the ` +
          `secret is disposable`
      );
      continue;
    }

    const passwordNeedsWriting = openedPassword !== null && openedPassword.via !== "the current key";
    // A readable secret is rewritten in its self-contained form whenever the row is touched, so it stops
    // depending on columns the password is about to change.
    const totpNeedsWriting =
      openedTotp !== null && totp !== null && (openedTotp.via !== "the current key" || passwordNeedsWriting);

    if (!passwordNeedsWriting && !totpNeedsWriting) continue;

    const data: Record<string, unknown> = {};
    const guard: Record<string, unknown> = { id: row.id };
    if (passwordNeedsWriting) {
      const e = encrypt(openedPassword.text);
      data.encryptedPassword = e.ciphertext;
      data.iv = e.iv;
      data.authTag = e.authTag;
      guard.encryptedPassword = row.encryptedPassword;
      guard.iv = row.iv;
      guard.authTag = row.authTag;
    }
    if (totpNeedsWriting && openedTotp) {
      const e = encrypt(openedTotp.text);
      data.totpSecret = `${e.ciphertext}:${e.iv}:${e.authTag}`;
      guard.totpSecret = row.totpSecret;
    }
    data.encryptionKeyId = CURRENT_KEY_ID;

    changed++;
    if (apply) {
      // Conditional on what was read: an edit made since must not be overwritten.
      const result = await prisma.kumoPassword.updateMany({ where: guard, data });
      if (result.count === 0) {
        changed--;
        tally.conflicts++;
        problems.push(`KumoPassword ${row.id} ("${row.label}") changed while the job was running — skipped, re-run to pick it up`);
      }
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
    const guard: Record<string, unknown> = { id: row.id };

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
      const opened = open(triple);
      if (!opened) {
        tally.unreadable++;
        problems.push(`EmailConnector ${row.id} (${row.host}) field ${field} cannot be read with any known key — left untouched`);
        continue;
      }
      if (opened.via === "the current key") {
        tally.current++;
        continue;
      }
      tally.legacy++;
      data[field] = JSON.stringify(encrypt(opened.text));
      guard[field] = stored;
    }

    if (Object.keys(data).length === 0) continue;
    changed++;
    if (apply) {
      const result = await prisma.emailConnector.updateMany({ where: guard, data });
      if (result.count === 0) {
        changed--;
        tally.conflicts++;
        problems.push(`EmailConnector ${row.id} (${row.host}) changed while the job was running — skipped, re-run to pick it up`);
      }
    }
  }
  return changed;
}

async function main(): Promise<void> {
  const status = kumoKeyStatus();
  console.log(`[kumo:reencrypt] ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[kumo:reencrypt] vault key: ${status.source}, fingerprint ${status.fingerprint}`);
  console.log(`[kumo:reencrypt] older generations this job can read: ${candidates.length}`);
  for (const candidate of candidates) console.log(`[kumo:reencrypt]   - ${candidate.name}`);
  if (status.source !== "KUMO_MASTER_KEY") {
    console.log(
      "[kumo:reencrypt] KUMO_MASTER_KEY is not set, so the current key is one of the generations above and nothing needs moving."
    );
  }

  const passwords = await reencryptPasswords();
  const connectors = await reencryptConnectors();

  console.log("");
  console.log(`[kumo:reencrypt] values already on the current key : ${tally.current}`);
  console.log(`[kumo:reencrypt] values on an older key             : ${tally.legacy}`);
  console.log(`[kumo:reencrypt] values no known key can read        : ${tally.unreadable}`);
  console.log(`[kumo:reencrypt] empty values                        : ${tally.empty}`);
  console.log(`[kumo:reencrypt] connector values stored in plaintext: ${tally.plaintext}`);
  console.log(`[kumo:reencrypt] rows skipped for an unreadable part : ${tally.skipped}`);
  console.log(`[kumo:reencrypt] rows that changed under the job     : ${tally.conflicts}`);
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