import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const uid = "a23d9925-5c8f-4812-baf7-5662a1df8bbe"; // admin
const uid2 = "b23d9925-5c8f-4812-baf7-5662a1df8bbe"; // placeholder tech

async function main() {
  console.log("=== C7NTAX Comprehensive Seed ===\n");

  // ── Opportunities ────────────────────────────────────────────────
  const opps = await p.opportunity.count();
  if (opps < 3) {
    const companies = await p.company.findMany({ take: 3 });
    await p.opportunity.createMany({ data: [
      { name: "Cloud Migration Project", companyId: companies[0]?.id, stage: "proposal", amount: 75000, probability: 60, expectedCloseDate: new Date("2026-10-15"), createdById: uid },
      { name: "Managed Services Renewal", companyId: companies[1]?.id, stage: "negotiation", amount: 120000, probability: 85, expectedCloseDate: new Date("2026-09-01"), createdById: uid },
      { name: "Security Audit Upsell", companyId: companies[2]?.id, stage: "qualified", amount: 15000, probability: 40, expectedCloseDate: new Date("2026-11-01"), createdById: uid },
      { name: "Hardware Refresh Q4", companyId: companies[0]?.id, stage: "prospect", amount: 45000, probability: 25, expectedCloseDate: new Date("2026-12-15"), createdById: uid },
    ] });
    console.log("✓ 4 opportunities");
  }

  // ── Contracts ────────────────────────────────────────────────────
  const contracts = await p.contract.count();
  if (contracts < 2) {
    const companies = await p.company.findMany({ take: 2 });
    await p.contract.createMany({ data: [
      { name: "SLA Agreement - Premium Support", companyId: companies[0]?.id, type: "sla", status: "active", startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), value: 48000, createdById: uid },
      { name: "Data Processing Agreement", companyId: companies[1]?.id, type: "dpa", status: "active", startDate: new Date("2026-03-15"), endDate: new Date("2027-03-15"), value: 0, createdById: uid },
    ] });
    console.log("✓ 2 contracts");
  }

  // ── Surveys ──────────────────────────────────────────────────────
  const surveys = await p.survey.count();
  if (surveys < 2) {
    const s1 = await p.survey.create({ data: { name: "CSAT Survey", description: "Post-resolution satisfaction", type: "csat", sendOnResolve: true, sendDelayHours: 24 } });
    await p.surveyQuestion.createMany({ data: [
      { surveyId: s1.id, text: "How satisfied were you?", type: "rating", required: true, sortOrder: 0 },
      { surveyId: s1.id, text: "What could we improve?", type: "text", required: false, sortOrder: 1 },
    ] });
    const s2 = await p.survey.create({ data: { name: "NPS Survey", description: "Quarterly NPS", type: "nps", isActive: true } });
    await p.surveyQuestion.createMany({ data: [
      { surveyId: s2.id, text: "How likely to recommend?", type: "rating", required: true, sortOrder: 0 },
    ] });
    console.log("✓ 2 surveys with questions");
  }

  // ── Expenses ─────────────────────────────────────────────────────
  const expenses = await p.expense.count();
  if (expenses < 3) {
    await p.expense.createMany({ data: [
      { description: "Microsoft 365 Annual Licenses", amount: 2400, category: "software", expenseDate: new Date("2026-07-15"), createdById: uid },
      { description: "Server RAM Upgrade Kit", amount: 890, category: "hardware", expenseDate: new Date("2026-06-20"), createdById: uid },
      { description: "Tech Conference Registration", amount: 450, category: "training", expenseDate: new Date("2026-08-01"), createdById: uid },
      { description: "Office Supplies Q3", amount: 175, category: "other", expenseDate: new Date("2026-08-05"), createdById: uid },
    ] });
    console.log("✓ 4 expenses");
  }

  // ── Alert Rules ──────────────────────────────────────────────────
  const rules = await p.alertRule.count();
  if (rules < 2) {
    await p.alertRule.createMany({ data: [
      { name: "Domain Expiry Alert", entityType: "domain", triggerDays: 30, enabled: true, createdById: uid },
      { name: "SSL Certificate Expiry", entityType: "certificate", triggerDays: 14, enabled: true, createdById: uid },
      { name: "Invoice Overdue", entityType: "invoice", triggerDays: 7, enabled: true, createdById: uid },
    ] });
    console.log("✓ 3 alert rules");
  }

  // ── Schedule Entries ─────────────────────────────────────────────
  const schedules = await p.scheduleEntry.count();
  if (schedules < 3) {
    await p.scheduleEntry.createMany({ data: [
      { userId: uid, title: "Weekly Team Standup", startTime: new Date("2026-08-11T09:00:00"), endTime: new Date("2026-08-11T09:30:00"), status: "scheduled", color: "#3b82d6" },
      { userId: uid, title: "Client Onboarding - Contoso", startTime: new Date("2026-08-11T14:00:00"), endTime: new Date("2026-08-11T15:30:00"), status: "scheduled", color: "#10b981" },
      { userId: uid, title: "Server Maintenance Window", startTime: new Date("2026-08-12T22:00:00"), endTime: new Date("2026-08-13T02:00:00"), status: "scheduled", color: "#f59e0b" },
    ] });
    console.log("✓ 3 schedule entries");
  }

  // ── PTO Requests ─────────────────────────────────────────────────
  const ptos = await p.ptoRequest.count();
  if (ptos < 2) {
    await p.ptoRequest.createMany({ data: [
      { userId: uid, type: "vacation", status: "approved", startDate: new Date("2026-08-20"), endDate: new Date("2026-08-25"), hours: 40, reason: "Summer vacation" },
      { userId: uid, type: "sick", status: "pending", startDate: new Date("2026-08-15"), endDate: new Date("2026-08-15"), hours: 8, reason: "Doctor appointment" },
    ] });
    console.log("✓ 2 PTO requests");
  }

  // ── Time Entries ─────────────────────────────────────────────────
  const timeEntries = await p.timeEntry.count();
  if (timeEntries < 3) {
    const tickets = await p.ticket.findMany({ take: 3 });
    if (tickets.length >= 2) {
      await p.timeEntry.createMany({ data: [
        { ticketId: tickets[0].id, userId: uid, startTime: new Date("2026-08-10T09:00:00"), endTime: new Date("2026-08-10T10:30:00"), description: "Initial triage and diagnosis", billable: true },
        { ticketId: tickets[1].id, userId: uid, startTime: new Date("2026-08-10T11:00:00"), endTime: new Date("2026-08-10T12:00:00"), description: "Remote support session", billable: true },
        { ticketId: tickets[0].id, userId: uid, startTime: new Date("2026-08-10T14:00:00"), endTime: new Date("2026-08-10T15:30:00"), description: "Resolution and documentation", billable: true },
      ] });
    }
    console.log("✓ time entries");
  }

  // ── Procurement ──────────────────────────────────────────────────
  const pos = await p.purchaseOrder.count();
  if (pos < 2) {
    const companies = await p.company.findMany({ take: 2 });
    await p.purchaseOrder.createMany({ data: [
      { poNumber: "PO-2026-001", vendorId: "vendor-1", status: "ordered", total: 3500, expectedAt: new Date("2026-08-20"), companyId: companies[0]?.id, createdById: uid },
      { poNumber: "PO-2026-002", vendorId: "vendor-2", status: "pending", total: 1200, companyId: companies[1]?.id, createdById: uid },
    ] });
    console.log("✓ 2 purchase orders");
  }

  // ── KB Articles (existing system) ────────────────────────────────
  const kbCount = await p.knowledgeBaseArticle.count();
  if (kbCount < 3) {
    await p.knowledgeBaseArticle.createMany({ data: [
      { title: "VPN Connection Troubleshooting", slug: "vpn-troubleshooting", content: "# VPN Troubleshooting\n\n## Quick Fixes\n1. Restart VPN client\n2. Check credentials\n3. Verify DNS settings", status: "published", visibility: "internal", authorId: uid },
      { title: "New User Onboarding Checklist", slug: "user-onboarding", content: "# Onboarding Checklist\n\n- Create AD account\n- Assign O365 license\n- Configure email\n- Setup VPN access", status: "published", visibility: "internal", authorId: uid },
      { title: "Common Printer Issues", slug: "printer-issues", content: "# Printer Issues\n\n## Paper Jam\n1. Open tray\n2. Remove paper\n3. Check rollers", status: "published", visibility: "internal", authorId: uid },
    ] });
    console.log("✓ KB articles");
  }

  const counts = {
    opportunities: await p.opportunity.count(),
    projects: await p.project.count(),
    contracts: await p.contract.count(),
    surveys: await p.survey.count(),
    expenses: await p.expense.count(),
    alertRules: await p.alertRule.count(),
    scheduleEntries: await p.scheduleEntry.count(),
    ptoRequests: await p.ptoRequest.count(),
    timeEntries: await p.timeEntry.count(),
    purchaseOrders: await p.purchaseOrder.count(),
    kbArticles: await p.knowledgeBaseArticle.count(),
  };
  console.log("\n=== Seed Complete ===");
  console.log(JSON.stringify(counts, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
