/**
 * Removes verification residue left by the W0 probes (probe users, roles, audit rows,
 * connector-suite tickets/clients/contacts) so the snapshot capture stays clean.
 *
 * Dry run by default — it prints what it would delete and changes nothing. Pass --apply
 * to actually remove the rows:
 *
 *   npx tsx clean-probe-residue.ts            # what would be removed
 *   npx tsx clean-probe-residue.ts --apply    # remove it
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

/** Counts first, deletes only with --apply, and always says what it did. */
async function remove(label: string, count: () => Promise<number>, removeRows: () => Promise<{ count: number }>) {
  const found = await count();
  if (!found) {
    console.log(`${label}: 0`);
    return 0;
  }
  if (apply) {
    const result = await removeRows();
    console.log(`${label}: ${result.count}`);
    return result.count;
  }
  console.log(`${label}: ${found} (dry run — pass --apply to remove)`);
  return found;
}

async function main() {
  const recentAudits = () => prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) } } });

  // Probe users, the roles a probe creates, and the audit rows that mention either — the
  // create/update rows are written by the admin, not by the probe, so matching on the
  // acting user is not enough.
  const probeUsers = await prisma.user.findMany({ where: { email: { endsWith: "@probe.local" } }, select: { id: true, email: true } });
  const probeUserIds = probeUsers.map(u => u.id);
  const probeUserEmails = probeUsers.map(u => u.email);

  await remove(
    "probe roles",
    () => prisma.role.count({ where: { name: { startsWith: "User Management only" } } }),
    () => prisma.role.deleteMany({ where: { name: { startsWith: "User Management only" } } }),
  );

  await remove(
    "probe users",
    () => Promise.resolve(probeUsers.length),
    () => prisma.user.deleteMany({ where: { id: { in: probeUserIds } } }),
  );

  if (probeUserIds.length || probeUserEmails.length) {
    const hits = (await recentAudits()).filter(r =>
      probeUserIds.includes(r.entityId)
      || probeUserEmails.some(e => e && JSON.stringify(r).includes(e))
      || /probe-/.test(JSON.stringify(r)),
    );
    await remove(
      "audit rows",
      () => Promise.resolve(hits.length),
      () => prisma.auditLog.deleteMany({ where: { id: { in: hits.map(h => h.id) } } }),
    );
  }

  await remove(
    "probe providers",
    () => prisma.aiProviderConfig.count({ where: { name: { contains: "probe" } } }),
    () => prisma.aiProviderConfig.deleteMany({ where: { name: { contains: "probe" } } }),
  );

  await remove(
    "probe alert services",
    () => prisma.serviceAlertService.count({ where: { name: { contains: "probe" } } }),
    () => prisma.serviceAlertService.deleteMany({ where: { name: { contains: "probe" } } }),
  );

  // Connector-suite residue: the probes ingest mail into "Attribution …" tickets, create
  // clients for made-up domains, and write contacts on .example addresses. Only recent
  // rows that match those shapes are touched.
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const probeTickets = await prisma.ticket.findMany({ where: { createdAt: { gte: since }, title: { startsWith: "Attribution" } }, select: { id: true } });
  const probeTicketIds = probeTickets.map(t => t.id);

  await remove(
    "probe ticket comments",
    () => prisma.ticketComment.count({ where: { ticketId: { in: probeTicketIds } } }),
    () => prisma.ticketComment.deleteMany({ where: { ticketId: { in: probeTicketIds } } }),
  );
  await remove(
    "probe tickets",
    () => Promise.resolve(probeTicketIds.length),
    () => prisma.ticket.deleteMany({ where: { id: { in: probeTicketIds } } }),
  );

  const probeCompanyWhere = { createdAt: { gte: since }, OR: [{ name: { contains: "muxiu" } }, { name: { startsWith: "Brandnewcorp" } }] };
  const probeCompanies = await prisma.company.findMany({ where: probeCompanyWhere, select: { id: true, name: true } });
  const probeContactWhere = { createdAt: { gte: since }, OR: [{ email: { endsWith: ".example" } }, { email: { contains: "muxiu" } }] };

  await remove(
    "probe contacts",
    () => prisma.contact.count({ where: probeContactWhere }),
    () => prisma.contact.deleteMany({ where: probeContactWhere }),
  );
  await remove(
    `probe clients${probeCompanies.length ? ` (${probeCompanies.map(c => c.name).join(", ")})` : ""}`,
    () => Promise.resolve(probeCompanies.length),
    () => prisma.company.deleteMany({ where: probeCompanyWhere }),
  );

  console.log("remaining:", JSON.stringify({
    users: await prisma.user.count(),
    providers: await prisma.aiProviderConfig.count(),
    services: await prisma.serviceAlertService.count(),
    audits: await prisma.auditLog.count(),
  }));
}

void main().finally(() => prisma.$disconnect());
