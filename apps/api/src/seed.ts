import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("[Seed] Starting database seed...\n");

  // ── 1. Create default roles ──────────────────────────────────────
  const roles = [
    {
      name: "Admin",
      systemRole: "admin",
      permissions: [
        "ticket:view","ticket:create","ticket:edit","ticket:delete","ticket:assign","ticket:close","ticket:view_all",
        "board:view","board:manage",
        "client:view","client:create","client:edit","client:delete",
        "billing:view","billing:manage","invoice:create","invoice:send",
        "user:manage","role:manage","system:config",
        "integration:view","integration:manage",
        "report:view","report:export",
      ],
      isDefault: true,
    },
    {
      name: "Technician",
      systemRole: "technician",
      permissions: [
        "ticket:view","ticket:create","ticket:edit","ticket:view_all",
        "board:view","client:view","integration:view","report:view",
      ],
      isDefault: false,
    },
    {
      name: "Client Admin",
      systemRole: "client_admin",
      permissions: [
        "ticket:view","ticket:create","ticket:edit","ticket:close",
        "board:view","client:view","billing:view","report:view",
      ],
      isDefault: false,
    },
    {
      name: "Read Only",
      systemRole: "read_only",
      permissions: [
        "ticket:view","board:view","client:view","billing:view","report:view",
      ],
      isDefault: false,
    },
  ];

  for (const role of roles) {
    const existing = await prisma.role.findUnique({ where: { name: role.name } });
    if (!existing) {
      await prisma.role.create({ data: role });
      console.log(`  ✓ Created role: ${role.name}`);
    } else {
      await prisma.role.update({ where: { name: role.name }, data: { permissions: role.permissions } });
      console.log(`  ✓ Updated role: ${role.name}`);
    }
  }

  // ── 2. Create default admin user ─────────────────────────────────
  const adminRole = await prisma.role.findUnique({ where: { name: "Admin" } });
  if (!adminRole) throw new Error("Admin role not found");

  const passwordHash = await bcrypt.hash("admin", 12);

  const existingAdmin = await prisma.user.findUnique({ where: { email: "admin@c7overwatch.com" } });
  if (existingAdmin) {
    await prisma.user.update({
      where: { email: "admin@c7overwatch.com" },
      data: {
        passwordHash,
        firstName: "Admin",
        lastName: "User",
        roleId: adminRole.id,
        isActive: true,
        emailVerified: true,
      },
    });
    console.log("  ✓ Updated admin user (password reset to: admin)");
  } else {
    await prisma.user.create({
      data: {
        email: "admin@c7overwatch.com",
        passwordHash,
        firstName: "Admin",
        lastName: "User",
        roleId: adminRole.id,
        isActive: true,
        emailVerified: true,
      },
    });
    console.log("  ✓ Created admin user (admin@c7overwatch.com / admin)");
  }

  // ── 3. Default system configs ────────────────────────────────────
  const configs = [
    { key: "default_landing_page", value: JSON.stringify({ path: "/", label: "Dashboard" }) },
    { key: "app_name", value: JSON.stringify("C7 Overwatch") },
    { key: "app_version", value: JSON.stringify("1.0.0") },
    { key: "ticket_auto_close_days", value: JSON.stringify(14) },
    { key: "follow_up_interval_hours", value: JSON.stringify(24) },
    { key: "company_name", value: JSON.stringify("Cyber 7 Group") },
    { key: "smtp_from_address", value: JSON.stringify("noreply@cyber7group.com") },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      create: cfg,
      update: { value: cfg.value },
    });
  }
  console.log("  ✓ Created/updated system configuration");

  // ── 4. Default service board ─────────────────────────────────────
  const existingBoard = await prisma.serviceBoard.findFirst({ where: { name: "General Support" } });
  if (!existingBoard) {
    await prisma.serviceBoard.create({
      data: {
        name: "General Support",
        description: "Default service board for all incoming tickets",
        autoCloseDays: 14,
      },
    });
    console.log("  ✓ Created default service board: General Support");
  }

  // ── 5. Default locales ───────────────────────────────────────────
  const defaultLocale = await prisma.locale.findUnique({ where: { code: "en" } });
  if (!defaultLocale) {
    await prisma.locale.create({
      data: { code: "en", name: "English", isDefault: true, isActive: true, direction: "ltr" },
    });
    console.log("  ✓ Created default locale: English (en)");
  }

  // ── 6. Default currencies ────────────────────────────────────────
  const usd = await prisma.currency.findUnique({ where: { code: "USD" } });
  if (!usd) {
    await prisma.currency.create({ data: { code: "USD", name: "US Dollar", symbol: "$", isActive: true } });
    console.log("  ✓ Created default currency: USD");
  }

  // ── 7. Default AI Provider (local) ───────────────────────────────
  const localProvider = await prisma.aiProviderConfig.findUnique({ where: { name: "Local Engine" } });
  if (!localProvider) {
    await prisma.aiProviderConfig.create({
      data: {
        name: "Local Engine",
        provider: "local",
        isActive: true,
        isDefault: true,
        model: "keyword-search",
      },
    });
    console.log("  ✓ Created default AI provider: Local Engine");
  }

  console.log("\n[Seed] Database seeding complete!");
  console.log("  Login: admin@c7overwatch.com / admin\n");
}

main()
  .catch((e) => {
    console.error("[Seed] Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
