/**
 * Reconcile the stored role permissions with the declared intent.
 *
 * `ROLE_PERMISSIONS` in `@C7NTAX/shared` is the source of truth for what each system
 * role may do, but the seeded role rows were written by hand (seed-full.ts) and have
 * drifted: Admin was missing 22 permissions, Super Admin was missing both service-alert
 * permissions, and Technician was missing the KB, contacts, projects, chat and
 * inference views it needs. Anything built on those rows — permission gates in
 * particular — inherits the drift.
 *
 * This merges the intent into every role **additively**: nothing is ever removed, so
 * the worst case of a mistake is a role that can do more than intended, never one that
 * unexpectedly cannot work. Run it after any change to ROLE_PERMISSIONS.
 *
 *   pnpm --filter @C7NTAX/api exec tsx src/seed-role-permissions.ts            # apply
 *   pnpm --filter @C7NTAX/api exec tsx src/seed-role-permissions.ts --dry-run  # report
 */
import { PrismaClient } from "@prisma/client";
import { ROLE_PERMISSIONS, SystemRole, type Permission } from "@C7NTAX/shared";

// Own client rather than the shared one from ./index — importing that module starts the
// HTTP server, which is both unnecessary here and fatal when the API is already running.
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

/** Role names in the database can differ from the enum key, so match on systemRole. */
async function main() {
  const roles = await prisma.role.findMany({ select: { id: true, name: true, systemRole: true, permissions: true } });
  let changed = 0;

  for (const role of roles) {
    const intent = ROLE_PERMISSIONS[role.systemRole as SystemRole];
    if (!intent) {
      console.log(`  - ${role.name}: no declared intent for systemRole "${role.systemRole}" — left alone`);
      continue;
    }
    const stored = new Set<string>(role.permissions);
    const added = (intent as Permission[]).filter((p) => !stored.has(p));
    if (added.length === 0) {
      console.log(`  = ${role.name}: already matches its intent (${stored.size} permissions)`);
      continue;
    }
    const merged = [...stored, ...added];
    if (DRY_RUN) {
      console.log(`  + ${role.name}: would add ${added.length} of ${merged.length} — ${added.join(" ")}`);
    } else {
      await prisma.role.update({ where: { id: role.id }, data: { permissions: merged } });
      console.log(`  + ${role.name}: added ${added.length} of ${merged.length} — ${added.join(" ")}`);
    }
    changed++;
  }

  console.log(`\n${DRY_RUN ? "would update" : "updated"} ${changed} of ${roles.length} roles.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
