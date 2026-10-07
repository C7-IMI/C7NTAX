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

  // The permission sweep's write probes create one row per persona in each module. Every
  // name carries the "Persona probe" prefix, except the locale, which uses a generated code.
  const sweepCompanyWhere = { name: { startsWith: "Persona probe client" } };
  const sweepArticles = await prisma.knowledgeBaseArticle.findMany({ where: { title: { startsWith: "Persona probe article" } }, select: { id: true } });
  const sweepArticleIds = sweepArticles.map(a => a.id);
  await remove(
    "sweep kb articles",
    () => Promise.resolve(sweepArticleIds.length),
    async () => {
      await prisma.kBArticleVersion.deleteMany({ where: { articleId: { in: sweepArticleIds } } }).catch(() => ({ count: 0 }));
      await prisma.kBArticleAttachment.deleteMany({ where: { articleId: { in: sweepArticleIds } } }).catch(() => ({ count: 0 }));
      await prisma.kBArticleTicket.deleteMany({ where: { articleId: { in: sweepArticleIds } } }).catch(() => ({ count: 0 }));
      return prisma.knowledgeBaseArticle.deleteMany({ where: { id: { in: sweepArticleIds } } });
    },
  );
  await remove(
    "sweep kb categories",
    () => prisma.kBCategory.count({ where: { name: { startsWith: "Persona probe category" } } }),
    () => prisma.kBCategory.deleteMany({ where: { name: { startsWith: "Persona probe category" } } }),
  );
  await remove(
    "sweep workflow rules",
    () => prisma.workflowRule.count({ where: { name: { startsWith: "Persona probe rule" } } }),
    () => prisma.workflowRule.deleteMany({ where: { name: { startsWith: "Persona probe rule" } } }),
  );
  await remove(
    "sweep surveys",
    () => prisma.survey.count({ where: { name: { startsWith: "Persona probe survey" } } }),
    () => prisma.survey.deleteMany({ where: { name: { startsWith: "Persona probe survey" } } }),
  );
  await remove(
    "sweep reports",
    () => prisma.report.count({ where: { name: { startsWith: "Persona probe report" } } }),
    () => prisma.report.deleteMany({ where: { name: { startsWith: "Persona probe report" } } }),
  );
  // Chat sessions are not matched: the model carries no title, so a sweep-created session
  // cannot be told apart from a real one, and deleting by age would be a guess.
  await remove(
    "sweep clients",
    () => prisma.company.count({ where: sweepCompanyWhere }),
    () => prisma.company.deleteMany({ where: sweepCompanyWhere }),
  );
  await remove(
    "sweep locales",
    () => prisma.locale.count({ where: { name: "Persona Probe" } }),
    () => prisma.locale.deleteMany({ where: { name: "Persona Probe" } }),
  );
  await remove(
    "sweep checklists",
    () => prisma.checklist.count({ where: { name: { startsWith: "W1 session verification" } } }),
    () => prisma.checklist.deleteMany({ where: { name: { startsWith: "W1 session verification" } } }),
  );

  // The Kumo audit probe and the browser checks create credentials and documents, and the
  // trail those actions write is matched by the same names.
  const kumoProbeWhere = { label: { startsWith: "Probe vault" } };
  const kumoProbeDocs = await prisma.kumoDocument.findMany({ where: { title: { startsWith: "Probe doc" } }, select: { id: true } });
  const kumoProbeDocIds = kumoProbeDocs.map(d => d.id);
  const kumoProbePasswords = await prisma.kumoPassword.findMany({ where: kumoProbeWhere, select: { id: true } });
  const kumoProbePasswordIds = kumoProbePasswords.map(p => p.id);
  await remove(
    "kumo probe audit rows",
    () => prisma.kumoAuditLog.count({ where: { itemId: { in: [...kumoProbePasswordIds, ...kumoProbeDocIds] } } }),
    () => prisma.kumoAuditLog.deleteMany({ where: { itemId: { in: [...kumoProbePasswordIds, ...kumoProbeDocIds] } } }),
  );
  await remove(
    "kumo probe document revisions",
    () => prisma.kumoDocumentRevision.count({ where: { documentId: { in: kumoProbeDocIds } } }),
    () => prisma.kumoDocumentRevision.deleteMany({ where: { documentId: { in: kumoProbeDocIds } } }),
  );
  await remove(
    "kumo probe documents",
    () => Promise.resolve(kumoProbeDocIds.length),
    () => prisma.kumoDocument.deleteMany({ where: { id: { in: kumoProbeDocIds } } }),
  );
  await remove(
    "kumo probe access logs",
    () => prisma.kumoPasswordAccessLog.count({ where: { passwordId: { in: kumoProbePasswordIds } } }),
    () => prisma.kumoPasswordAccessLog.deleteMany({ where: { passwordId: { in: kumoProbePasswordIds } } }),
  );
  await remove(
    "kumo probe credentials",
    () => Promise.resolve(kumoProbePasswordIds.length),
    () => prisma.kumoPassword.deleteMany({ where: { id: { in: kumoProbePasswordIds } } }),
  );

  // The time-rules probe and the browser check leave one client, agreement and ticket each.
  const timeRuleCompanyWhere = { OR: [{ name: { startsWith: "TimeRules Probe" } }, { name: { startsWith: "TimeRules Off Probe" } }, { name: { startsWith: "Expense Probe" } }] };
  const timeRuleCompanies = await prisma.company.findMany({ where: timeRuleCompanyWhere, select: { id: true } });
  const timeRuleCompanyIds = timeRuleCompanies.map(c => c.id);
  const timeRuleTickets = await prisma.ticket.findMany({ where: { companyId: { in: timeRuleCompanyIds } }, select: { id: true } });
  const timeRuleTicketIds = timeRuleTickets.map(t => t.id);
  await remove(
    "time-rules probe time entries",
    () => prisma.timeEntry.count({ where: { ticketId: { in: timeRuleTicketIds } } }),
    () => prisma.timeEntry.deleteMany({ where: { ticketId: { in: timeRuleTicketIds } } }),
  );
  await remove(
    "time-rules probe tickets",
    () => Promise.resolve(timeRuleTicketIds.length),
    () => prisma.ticket.deleteMany({ where: { id: { in: timeRuleTicketIds } } }),
  );
  await remove(
    "time-rules probe agreements",
    () => prisma.serviceAgreement.count({ where: { companyId: { in: timeRuleCompanyIds } } }),
    () => prisma.serviceAgreement.deleteMany({ where: { companyId: { in: timeRuleCompanyIds } } }),
  );
  await remove(
    "time-rules probe clients",
    () => Promise.resolve(timeRuleCompanyIds.length),
    () => prisma.company.deleteMany({ where: { id: { in: timeRuleCompanyIds } } }),
  );
  await remove(
    "browser-check agreements",
    () => prisma.serviceAgreement.count({ where: { name: { startsWith: "Probe block agreement" } } }),
    () => prisma.serviceAgreement.deleteMany({ where: { name: { startsWith: "Probe block agreement" } } }),
  );

  // The expense probe files costs against a throwaway ticket and configures a throwaway
  // accounting integration; both are named, so both can go.
  const expenseProbeTickets = await prisma.ticket.findMany({ where: { title: { in: ["Expense probe", "Time rules probe", "Time rules off probe"] } }, select: { id: true } });
  const expenseProbeTicketIds = expenseProbeTickets.map(t => t.id);
  await remove(
    "expense probe expenses",
    () => prisma.expense.count({ where: { OR: [{ ticketId: { in: expenseProbeTicketIds } }, { description: { startsWith: "Parking at the client" } }] } }),
    () => prisma.expense.deleteMany({ where: { OR: [{ ticketId: { in: expenseProbeTicketIds } }, { description: { startsWith: "Parking at the client" } }] } }),
  );
  await remove(
    "expense probe tickets",
    () => Promise.resolve(expenseProbeTicketIds.length),
    () => prisma.ticket.deleteMany({ where: { id: { in: expenseProbeTicketIds } } }),
  );
  await remove(
    "probe accounting integrations",
    () => prisma.integration.count({ where: { name: { startsWith: "Probe accounting" } } }),
    () => prisma.integration.deleteMany({ where: { name: { startsWith: "Probe accounting" } } }),
  );
  await remove(
    "stale sessions",
    () => prisma.userSession.count({ where: { invalidatedAt: { not: null } } }),
    () => prisma.userSession.deleteMany({ where: { invalidatedAt: { not: null } } }),
  );

  console.log("remaining:", JSON.stringify({
    users: await prisma.user.count(),
    providers: await prisma.aiProviderConfig.count(),
    services: await prisma.serviceAlertService.count(),
    audits: await prisma.auditLog.count(),
  }));
}

void main().finally(() => prisma.$disconnect());
