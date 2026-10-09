/**
 * The **Developer Admin** role, and the account that wears it.
 *
 * The Developer section is gated on `developer:view`, and that permission is deliberately **not**
 * inherited by Super Admin or Admin — read the note on `DeveloperView` in `@C7NTAX/shared` for why.
 * This script is how the role comes into existence: it writes the permission set that
 * `ROLE_PERMISSIONS[SystemRole.DeveloperAdmin]` declares, which is every permission in the product
 * including the two the section needs. Change the declared set and re-run this, rather than editing
 * the role in the UI, so the stored row and the shared table cannot disagree.
 *
 *   npx tsx src/seed-developer-admin.ts                    # the role, and report what it holds
 *   npx tsx src/seed-developer-admin.ts --with-user        # …and the devadmin account
 *   npx tsx src/seed-developer-admin.ts --with-user --reset-password
 *
 * The account is a **development convenience** and is not part of `seed-full.ts`: a deployment should
 * not ship with a known password on a role that can empty the database. It is created here instead, so
 * that creating it is a deliberate act somebody typed.
 *
 * The password comes from `DEVADMIN_PASSWORD`, and falls back to `devadmin` — which is printed rather
 * than hidden, because a fallback nobody can read is a fallback nobody will change. Nothing else in
 * the product depends on either: the account is an ordinary user with an unusual role.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, SystemRole, Permission } from "@C7NTAX/shared";

const prisma = new PrismaClient();

const ROLE_NAME = "Developer Admin";
const EMAIL = "devadmin@c7ntax.com";
const USERNAME = "devadmin";

async function main(): Promise<void> {
  const withUser = process.argv.includes("--with-user");
  const resetPassword = process.argv.includes("--reset-password");
  const declared = ROLE_PERMISSIONS[SystemRole.DeveloperAdmin];

  const role = await prisma.role.upsert({
    where: { name: ROLE_NAME },
    update: { systemRole: SystemRole.DeveloperAdmin, permissions: declared },
    create: { name: ROLE_NAME, systemRole: SystemRole.DeveloperAdmin, permissions: declared },
  });
  console.log(`  ✓ role "${role.name}" holds ${declared.length} permissions, including ${Permission.DeveloperView} and ${Permission.DeveloperPurge}`);

  const holders = await prisma.user.count({ where: { roleId: role.id } });
  console.log(`    ${holders} account(s) hold it`);

  if (!withUser) {
    console.log("\nRole only. Pass --with-user to create the devadmin account.");
    return;
  }

  const password = process.env.DEVADMIN_PASSWORD || "devadmin";
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: { equals: EMAIL, mode: "insensitive" } }, { username: USERNAME }] },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        roleId: role.id,
        isActive: true,
        isLocked: false,
        loginAttempts: 0,
        ...(resetPassword ? { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: false } : {}),
      },
    });
    console.log(`  ✓ existing account ${existing.email} moved onto the role${resetPassword ? " and given a new password" : " (password untouched)"}`);
    // Every live session keeps the permissions it was issued with, so a role change only takes effect
    // on the next sign-in. Retiring the tokens here makes the change true immediately rather than
    // leaving somebody holding a session that still has the old answer.
    await prisma.refreshToken.deleteMany({ where: { userId: existing.id } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log("  ✓ its existing sessions retired, so the next sign-in carries the new role");
  } else {
    await prisma.user.create({
      data: {
        email: EMAIL,
        username: USERNAME,
        passwordHash: await bcrypt.hash(password, 12),
        firstName: "Developer",
        lastName: "Admin",
        title: "Developer Admin",
        roleId: role.id,
        isActive: true,
        emailVerified: true,
      },
    });
    console.log(`  ✓ created ${EMAIL} as "${ROLE_NAME}"`);
  }

  if (!process.env.DEVADMIN_PASSWORD) {
    console.warn(
      "\n⚠️  The password is the built-in default `devadmin`. Set DEVADMIN_PASSWORD to change it, or sign in\n" +
      "    and change it from My Account. This account can empty the database; do not carry it into a real\n" +
      "    deployment — set it inactive there instead.",
    );
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
