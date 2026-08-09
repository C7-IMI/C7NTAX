import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, SystemRole } from "@C7NTAX/shared";

const prisma = new PrismaClient();

async function main() {
  console.log("[Seed] Starting database seed...\n");

  // ── 1. Create default roles ──────────────────────────────────────
  const roleDefs = [
    { name: "Admin", systemRole: SystemRole.Admin, isDefault: true },
    { name: "Manager", systemRole: SystemRole.Manager, isDefault: false },
    { name: "Technician", systemRole: SystemRole.Technician, isDefault: false },
    { name: "Dispatcher", systemRole: SystemRole.Dispatcher, isDefault: false },
    { name: "Billing Manager", systemRole: SystemRole.BillingManager, isDefault: false },
    { name: "Client Admin", systemRole: SystemRole.ClientAdmin, isDefault: false },
    { name: "Client User", systemRole: SystemRole.ClientUser, isDefault: false },
    { name: "Read Only", systemRole: SystemRole.ReadOnly, isDefault: false },
  ];

  for (const def of roleDefs) {
    const permissions = ROLE_PERMISSIONS[def.systemRole] || [];
    const existing = await prisma.role.findUnique({ where: { name: def.name } });
    if (!existing) {
      await prisma.role.create({
        data: { name: def.name, systemRole: def.systemRole, permissions, isDefault: def.isDefault },
      });
      console.log(`  ✓ Created role: ${def.name} (${permissions.length} permissions)`);
    } else {
      await prisma.role.update({
        where: { name: def.name },
        data: { permissions, systemRole: def.systemRole },
      });
      console.log(`  ✓ Updated role: ${def.name} (${permissions.length} permissions)`);
    }
  }