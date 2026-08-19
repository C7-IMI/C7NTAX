/**
 * Seed coverage 2026-08-19 — creates sample data for every section/subsection
 * that has none, so no area of the app renders empty. Idempotent: each table is
 * seeded only when its count is 0. Run: npx tsx src/seed-coverage.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function count(model: string): Promise<number> {
  return (p as any)[model].count();
}

async function main(): Promise<void> {
  const log = (msg: string) => console.log(`[SeedCoverage] ${msg}`);
  const user = await p.user.findFirst({ orderBy: { createdAt: "asc" } });
  const company = await p.company.findFirst({ orderBy: { createdAt: "asc" } });
  const board = await p.serviceBoard.findFirst({ orderBy: { createdAt: "asc" } });
  const ticket = await p.ticket.findFirst({ orderBy: { createdAt: "asc" } });
  const invoice = await p.invoice.findFirst({ orderBy: { createdAt: "asc" } });
  const project = await p.project.findFirst({ orderBy: { createdAt: "asc" } });
  const opportunity = await p.opportunity.findFirst({ orderBy: { createdAt: "asc" } });
  const asset = await p.kumoAsset.findFirst({ orderBy: { createdAt: "asc" } });
  const integration = await p.integration.findFirst({ orderBy: { createdAt: "asc" } });

  const now = new Date();
  const inDays = (d: number) => new Date(Date.now() + d * 86400000);

  // Calendar
  if ((await count("scheduleEntry")) === 0 && user) {
    await p.scheduleEntry.createMany({
      data: [
        { userId: user.id, title: "Onsite visit — Acme Corp", description: "Quarterly onsite maintenance", startTime: inDays(1), endTime: inDays(1), status: "scheduled", location: "Acme HQ" },
        { userId: user.id, ticketId: ticket?.id || null, title: "Server firmware update", startTime: inDays(2), endTime: inDays(2), status: "scheduled" },
      ],
    });
    log("scheduleEntry seeded (2)");
  }

  // Procurement: vendors, purchase orders, line items
  if ((await count("vendor")) === 0) {
    await p.vendor.createMany({
      data: [
        { name: "TechSupply Co", contactName: "Dana Reyes", email: "sales@techsupply.example", paymentTerms: "Net 30" },
        { name: "HardwareHub", contactName: "Sam Ortiz", email: "orders@hardwarehub.example", paymentTerms: "Net 15" },
      ],
    });
    log("vendor seeded (2)");
  }
  if ((await count("purchaseOrder")) === 0 && user) {
    const vendor = await p.vendor.findFirst({ orderBy: { createdAt: "asc" } });
    if (vendor) {
      const po = await p.purchaseOrder.create({
        data: { poNumber: "PO-1001", vendorId: vendor.id, status: "ordered", subtotal: 2400, taxTotal: 0, total: 2400, orderedAt: now, expectedAt: inDays(7), createdById: user.id, notes: "Replacement SSDs" },
      });
      await p.pOLineItem.create({ data: { poId: po.id, description: "1TB NVMe SSD", quantity: 12, unitPrice: 200, total: 2400 } });
      log("purchaseOrder + polineItem seeded");
    }
  }

  // Payments
  if ((await count("payment")) === 0 && invoice) {
    await p.payment.createMany({
      data: [
        { amount: 500, method: "ach", reference: "TXN-SAMPLE-001", invoiceId: invoice.id, processedAt: now },
        { amount: 150, method: "credit_card", reference: "TXN-SAMPLE-002", invoiceId: invoice.id, processedAt: now },
      ],
    });
    log("payment seeded (2)");
  }

  // Analytics: custom reports + schedule
  if ((await count("report")) === 0 && user) {
    const r1 = await p.report.create({ data: { name: "Monthly Ticket Volume", description: "Standard ticket volume report", type: "ticket_summary", createdById: user.id } });
    await p.report.create({ data: { name: "Client Value Report", description: "Value delivered per client", type: "revenue", createdById: user.id } });
    await p.reportSchedule.create({ data: { reportId: r1.id, frequency: "weekly", dayOfWeek: 1, timeOfDay: "06:00", recipients: ["ops@example.com"], format: "pdf" } });
    log("report + reportSchedule seeded");
  }

  // PTO + holidays
  if ((await count("ptoRequest")) === 0 && user) {
    await p.ptoRequest.createMany({
      data: [
        { userId: user.id, type: "vacation", status: "approved", startDate: inDays(10), endDate: inDays(12), hours: 24, reason: "Family trip", approvedById: user.id, approvedAt: now },
        { userId: user.id, type: "sick", status: "pending", startDate: inDays(3), endDate: inDays(3), hours: 8 },
      ],
    });
    log("ptoRequest seeded (2)");
  }
  if ((await count("holiday")) === 0) {
    await p.holiday.createMany({
      data: [
        { name: "New Year's Day", date: new Date(now.getFullYear(), 0, 1), recurring: true, country: "US" },
        { name: "Independence Day", date: new Date(now.getFullYear(), 6, 4), recurring: true, country: "US" },
      ],
    });
    log("holiday seeded (2)");
  }

  // Contracts + milestones
  if ((await count("contract")) === 0 && company) {
    const c = await p.contract.create({
      data: { name: "Managed Services Contract", contractNumber: "CTR-2026-001", companyId: company.id, type: "service", status: "active", startDate: inDays(-30), endDate: inDays(335), autoRenew: true, value: 48000, billingPeriod: "monthly" },
    });
    await p.contractMilestone.create({ data: { contractId: c.id, name: "Annual review", description: "Client business review", dueDate: inDays(120), status: "pending" } });
    log("contract + contractMilestone seeded");
  }

  // Pipeline activities
  if ((await count("salesActivity")) === 0 && opportunity && user) {
    await p.salesActivity.createMany({
      data: [
        { opportunityId: opportunity.id, type: "call", subject: "Discovery call", body: "Discussed requirements.", userId: user.id, scheduledAt: inDays(1) },
        { opportunityId: opportunity.id, type: "email", subject: "Proposal follow-up", userId: user.id, completedAt: now },
      ],
    });
    log("salesActivity seeded (2)");
  }

  // KB categories
  if ((await count("kBCategory")) === 0) {
    await p.kBCategory.createMany({
      data: [
        { name: "How-To", slug: "how-to", description: "Step-by-step guides", sortOrder: 1 },
        { name: "Troubleshooting", slug: "troubleshooting", description: "Diagnosis and fixes", sortOrder: 2 },
      ],
    });
    log("kbCategory seeded (2)");
  }

  // Chat
  if ((await count("chatSession")) === 0) {
    const s = await p.chatSession.create({ data: { status: "active", companyId: company?.id || null, guestName: "Casey Customer", guestEmail: "casey@client.example" } });
    await p.chatMessage.createMany({
      data: [
        { sessionId: s.id, senderType: "customer", content: "Hi — my VPN is down.", contentType: "text" },
        { sessionId: s.id, senderType: "agent", senderId: user?.id || null, content: "On it — checking now.", contentType: "text" },
      ],
    });
    log("chatSession + chatMessage seeded");
  }

  // Workflows
  if ((await count("workflowRule")) === 0) {
    const rule = await p.workflowRule.create({ data: { name: "Escalate high-priority tickets", entity: "ticket", trigger: "on_create", conditions: [{ field: "priority", op: "eq", value: "critical" }] } });
    await p.workflowRuleAction.create({ data: { ruleId: rule.id, type: "notify", config: { recipients: ["ops@example.com"] }, sortOrder: 1 } });
    await p.workflowExecution.create({ data: { ruleId: rule.id, entityId: ticket?.id || "sample", status: "completed", result: { actions: 1 }, completedAt: now } });
    log("workflowRule + action + execution seeded");
  }

  // Locales + translations
  if ((await count("locale")) === 0) {
    await p.locale.createMany({
      data: [
        { code: "en-US", name: "English (US)", isActive: true, isDefault: true, direction: "ltr" },
        { code: "es-MX", name: "Spanish (Mexico)", isActive: true, isDefault: false, direction: "ltr" },
      ],
    });
    await p.translation.create({ data: { localeCode: "es-MX", key: "ticket.new", value: "Nuevo ticket", namespace: "tickets" } });
    log("locale + translation seeded");
  }

  // Surveys
  if ((await count("survey")) === 0) {
    const survey = await p.survey.create({ data: { name: "CSAT — Post-Ticket", description: "Sent after ticket resolution", type: "csat", sendOnResolve: true, sendDelayHours: 1 } });
    const q = await p.surveyQuestion.create({ data: { surveyId: survey.id, text: "How satisfied are you with the resolution?", type: "rating", required: true, choices: ["1", "2", "3", "4", "5"] } });
    const resp = await p.surveyResponse.create({ data: { surveyId: survey.id, ticketId: ticket?.id || null, companyId: company?.id || null, npsScore: 9 } });
    await p.surveyAnswer.create({ data: { responseId: resp.id, questionId: q.id, value: "5" } });
    log("survey chain seeded");
  }

  // M365 sync sample data (each table guarded separately so partial states self-heal)
  if (integration && (await count("m365User")) === 0) {
    await p.m365User.create({ data: { integrationId: integration.id, azureObjectId: "azure-sample-user-001", userPrincipalName: "alex@client.example", displayName: "Alex Rivera", givenName: "Alex", surname: "Rivera", mail: "alex@client.example" } });
    log("m365User seeded");
  }
  if (integration && (await count("m365Group")) === 0) {
    await p.m365Group.create({ data: { integrationId: integration.id, azureObjectId: "azure-sample-group-001", displayName: "Finance Team", mail: "finance@client.example", visibility: "Private" } });
    log("m365Group seeded");
  }
  if (integration && (await count("m365Subscription")) === 0) {
    await p.m365Subscription.create({ data: { integrationId: integration.id, skuId: "ENTERPRISEPREMIUM", skuPartNumber: "Microsoft 365 E5", activeUnits: 25 } });
    log("m365Subscription seeded");
  }
  if (integration && (await count("syncLog")) === 0) {
    await p.syncLog.create({ data: { integrationId: integration.id, status: "success", entityType: "user", recordsProcessed: 12, recordsCreated: 12, recordsUpdated: 0, recordsFailed: 0, completedAt: now } });
    await p.syncedEntity.create({ data: { integrationId: integration.id, entityKind: "microsoft365", entityType: "user", externalId: "azure-sample-user-001", displayName: "Alex Rivera", data: {} } });
    log("syncLog + syncedEntity seeded");
  }

  // Expenses
  if ((await count("expense")) === 0 && user) {
    await p.expense.createMany({
      data: [
        { description: "Parking — client site", amount: 12, category: "parking", companyId: company?.id || null, ticketId: ticket?.id || null, expenseDate: now, createdById: user.id },
        { description: "Replacement keyboard", amount: 89, category: "hardware", companyId: company?.id || null, expenseDate: now, createdById: user.id },
      ],
    });
    log("expense seeded (2)");
  }

  // Alert rules + log
  if ((await count("alertRule")) === 0 && user) {
    const rule = await p.alertRule.create({ data: { name: "Domain expiry warning", entityType: "domain", triggerDays: 30, enabled: true, createdById: user.id } });
    await p.alertLog.create({ data: { ruleId: rule.id, entityType: "domain", entityId: "sample-domain", message: "Sample domain expires soon", severity: "warning" } });
    log("alertRule + alertLog seeded");
  }

  // Notifications
  if ((await count("notification")) === 0 && user) {
    await p.notification.createMany({
      data: [
        { userId: user.id, type: "system", title: "Welcome to C7NTAX", body: "Sample notification — explore Tickets, Billing, and Kumo.", isRead: false },
        { userId: user.id, type: "invoice_sent", title: "Invoice overdue", body: "Sample invoice is past due.", ticketId: ticket?.id || null, isRead: false },
      ],
    });
    log("notification seeded (2)");
  }

  // Kumo configurations, domains, certificates, links
  if ((await count("kumoServer")) === 0 && asset) {
    await p.kumoServer.create({ data: { kumoAssetId: asset.id, hostname: "srv-dc01", fqdn: "srv-dc01.client.local", operatingSystem: "Windows Server 2022", cpuCores: 8, ramGb: 32, storageGb: 512 } });
    log("kumoServer seeded (Kumo Configurations)");
  }
  if ((await count("kumoDomain")) === 0) {
    await p.kumoDomain.create({ data: { domainName: "client.example", registrar: "Namecheap", expiryDate: inDays(200), autoRenew: true, dnsProvider: "Cloudflare", companyId: company?.id || null } });
    log("kumoDomain seeded");
  }
  if ((await count("kumoCertificate")) === 0) {
    await p.kumoCertificate.create({ data: { name: "client.example cert", domain: "client.example", issuer: "Let's Encrypt", expiryDate: inDays(45), certificateType: "DV", autoRenew: true, companyId: company?.id || null } });
    log("kumoCertificate seeded");
  }
  if ((await count("kumoLink")) === 0 && user && asset) {
    await p.kumoLink.create({ data: { sourceType: "asset", sourceId: asset.id, targetType: "domain", targetId: "client.example", relationship: "related_to", label: "Primary domain", createdById: user.id } });
    log("kumoLink seeded");
  }

  // Project phases + tasks
  if ((await count("projectPhase")) === 0 && project) {
    const phase = await p.projectPhase.create({ data: { projectId: project.id, name: "Discovery", description: "Requirements gathering", sortOrder: 1, status: "completed" } });
    await p.projectTask.create({ data: { phaseId: phase.id, name: "Kickoff meeting", sortOrder: 1, status: "completed", assignedToId: user?.id || null } });
    await p.projectTask.create({ data: { phaseId: phase.id, name: "Deliver SOW", sortOrder: 2, status: "pending", assignedToId: user?.id || null } });
    log("projectPhase + projectTask seeded");
  }

  log("done");
}

main().finally(() => p.$disconnect());
