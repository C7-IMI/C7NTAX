/**
 * Removes verification residue left by the W0 probes (audit rows, provider rows,
 * alert-service rows) so the snapshot capture stays clean.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Probe users (and the role grant rows a probe may leave behind), plus the audit rows
  // that mention them — the create/update rows are written by the admin, not by the probe.
  const probeUsers = await prisma.user.findMany({ where: { email: { endsWith: "@probe.local" } }, select: { id: true, email: true } });
  const orphanRoles = await prisma.role.findMany({ where: { name: { startsWith: "User Management only" } }, select: { id: true, name: true } });
  if (orphanRoles.length) {
    const del = await prisma.role.deleteMany({ where: { id: { in: orphanRoles.map(r => r.id) } } });
    console.log(`probe roles removed: ${del.count}`);
  }
  if (probeUsers.length) {
    const ids = probeUsers.map(u => u.id);
    const emails = probeUsers.map(u => u.email);
    const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`probe users removed: ${del.count}`);
    const recent = await prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } } });
    const hits = recent.filter(r => ids.includes(r.entityId) || emails.some(e => e && JSON.stringify(r).includes(e)) || /probe-/.test(JSON.stringify(r)));
    if (hits.length) {
      const gone = await prisma.auditLog.deleteMany({ where: { id: { in: hits.map(h => h.id) } } });
      console.log(`audit rows removed: ${gone.count}`);
    } else {
      console.log("audit rows removed: 0");
    }
  } else {
    const recent = await prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } } });
    const hits = recent.filter(r => /probe-/.test(JSON.stringify(r)) || /@probe\.local/.test(JSON.stringify(r)));
    if (hits.length) {
      const gone = await prisma.auditLog.deleteMany({ where: { id: { in: hits.map(h => h.id) } } });
      console.log(`audit rows removed: ${gone.count}`);
    } else {
      console.log("audit rows removed: 0");
    }
  }

  const providers = await prisma.aiProviderConfig.findMany({ where: { name: { contains: "probe" } } });
  if (providers.length) {
    const del = await prisma.aiProviderConfig.deleteMany({ where: { id: { in: providers.map(p => p.id) } } });
    console.log(`probe providers removed: ${del.count}`);
  } else {
    console.log("probe providers removed: 0");
  }

  const services = await prisma.serviceAlertService.findMany({ where: { name: { contains: "probe" } } });
  if (services.length) {
    await prisma.serviceAlertService.deleteMany({ where: { id: { in: services.map(s => s.id) } } });
  }
  console.log(`probe alert services removed: ${services.length}`);

  const counts = {
    users: await prisma.user.count(),
    providers: await prisma.aiProviderConfig.count(),
    services: await prisma.serviceAlertService.count(),
    audits: await prisma.auditLog.count(),
  };
  console.log("remaining:", JSON.stringify(counts));
}

void main().finally(() => prisma.$disconnect());
