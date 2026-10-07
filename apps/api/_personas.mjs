import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const p = new PrismaClient();
const PW = "Persona-Dev-Only-2026!";
const acme = await p.company.findFirst({ where: { name: { contains: "Acme" } }, select: { id: true, name: true } })
  ?? await p.company.findFirst({ select: { id: true, name: true } });
// Internal roles run with companyId = null (the convention in tickets/index.ts: no company = unrestricted);
// the client-facing role is scoped to one company, and a scoped technician proves scoping without *:ViewAll.
const people = [
  ["persona.superadmin@c7ntax.local", "Super Admin", "super_admin", null],
  ["persona.admin@c7ntax.local", "Admin", "admin", null],
  ["persona.tech@c7ntax.local", "Technician", "technician", null],
  ["persona.readonly@c7ntax.local", "Read Only", "read_only", null],
  ["persona.clientadmin@c7ntax.local", "Client Admin", "client_admin", acme?.id ?? null],
  ["persona.tech.scoped@c7ntax.local", "Scoped Tech", "technician", acme?.id ?? null],
];
const hash = await bcrypt.hash(PW, 12);
for (const [email, label, roleName, companyId] of people) {
  const role = await p.role.findFirst({ where: { systemRole: roleName }, select: { id: true, name: true } });
  if (!role) { console.log("  MISSING ROLE", roleName); continue; }
  await p.user.upsert({
    where: { email },
    update: { passwordHash: hash, isActive: true, isLocked: false, loginAttempts: 0, mustChangePassword: false, roleId: role.id, companyId },
    create: { email, firstName: "Persona", lastName: label, passwordHash: hash, isActive: true, roleId: role.id, companyId, timezone: "America/Chicago", department: "Verification", mfaEnabled: false },
  });
  console.log(`  ${label.padEnd(12)} ${email.padEnd(34)} role=${role.name.padEnd(12)} company=${companyId ? acme?.name : "(none — internal)"}`);
}
const seededClient = await p.user.findFirst({ where: { role: { systemRole: "client_admin" } }, select: { email: true, companyId: true } });
console.log("seeded client_admin:", seededClient?.email, "| company:", seededClient?.companyId ? "set" : "(none)");
console.log("password for all personas:", PW);
await p.$disconnect();
