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

  // Connector-suite residue: the probes ingest mail into "Attribution …" tickets, create
  // clients for made-up domains, and write contacts on .example addresses. Only recent
  // rows that match those shapes are touched.
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const probeTickets = await prisma.ticket.findMany({ where: { createdAt: { gte: since }, title: { startsWith: "Attribution" } }, select: { id: true } });
  if (probeTickets.length) {
    const ids = probeTickets.map(t => t.id);
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ids } } }).catch(() => {});
    const gone = await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
    console.log(`probe tickets removed: ${gone.count}`);
  } else {
    console.log("probe tickets removed: 0");
  }

  const probeCompanies = await prisma.company.findMany({ where: { createdAt: { gte: since }, OR: [{ name: { contains: "muxiu" } }, { name: { startsWith: "Brandnewcorp" } }] }, select: { id: true, name: true } });
  const probeContacts = await prisma.contact.findMany({ where: { createdAt: { gte: since }, OR: [{ email: { endsWith: ".example" } }, { email: { contains: "muxiu" } }] }, select: { id: true } });
  if (probeCompanies.length) {
    await prisma.ticket.deleteMany({ where: { companyId: { in: probeCompanies.map(c => c.id) } } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { companyId: { in: probeCompanies.map(c => c.id) } } }).catch(() => {});
    const gone = await prisma.company.deleteMany({ where: { id: { in: probeCompanies.map(c => c.id) } } });
    console.log(`probe clients removed: ${gone.count} (${probeCompanies.map(c => c.name).join(", ")})`);
  } else {
    console.log("probe clients removed: 0");
  }
  if (probeContacts.length) {
    const gone = await prisma.contact.deleteMany({ where: { id: { in: probeContacts.map(c => c.id) } } });
    console.log(`probe contacts removed: ${gone.count}`);
  } else {
    console.log("probe contacts removed: 0");
  }

  const counts = {
    users: await prisma.user.count(),
    providers: await prisma.aiProviderConfig.count(),
    services: await prisma.serviceAlertService.count(),
    audits: await prisma.auditLog.count(),
  };
  console.log("remaining:", JSON.stringify(counts));
}

void main().finally(() => prisma.$disconnect());
