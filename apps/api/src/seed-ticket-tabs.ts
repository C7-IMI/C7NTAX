/**
 * Seed Ticket Tabs — populates the ticket-detail toolbar tabs with sample
 * data for EVERY ticket in the database.
 *
 * Usage:  npx tsx src/seed-ticket-tabs.ts
 *
 * Adds per ticket:
 *  - customFields: ticketConfigurations, ticketProducts, ticketLinks,
 *    ticketAttachments (persisted on the ticket record)
 *  - Expenses (real Expense rows linked by ticketId — visible in
 *    Billing → Time & Expenses)
 *  - ScheduleEntry rows (visible in the Calendar and the Schedule tab)
 *  - One change-log History comment (visible in the History tab)
 *  - Audit log rows (visible in the Audit Trail tab)
 *
 * Idempotent per ticket: existing customFields tab data and existing
 * expenses/schedule entries for a ticket are preserved.
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CONFIG_POOL = [
  { name: "DC-01 Domain Controller", type: "Kumo Config" },
  { name: "EXCH-01 Exchange Server", type: "Kumo Config" },
  { name: "FW-EDGE Firewall", type: "Kumo Config" },
  { name: "ThinkPad T14 — Finance", type: "Asset" },
  { name: "Reception Printer IR-ADV C5550", type: "Asset" },
  { name: "VPN Gateway Appliance", type: "Asset" },
  { name: "M365 Tenant", type: "Kumo Config" },
  { name: "NAS Backup Server", type: "Asset" },
];

const PRODUCT_POOL = [
  { name: "SSD 1TB Upgrade Kit", qty: 1, unitCost: 149.99 },
  { name: "Microsoft 365 Business Premium", qty: 3, unitCost: 22.0 },
  { name: "Patch Cable Cat6 (10-pack)", qty: 1, unitCost: 24.5 },
  { name: "USB-C Docking Station", qty: 2, unitCost: 189.0 },
  { name: "Laptop RAM 16GB SODIMM", qty: 2, unitCost: 79.99 },
  { name: "Adobe Creative Cloud License", qty: 8, unitCost: 54.99 },
  { name: "Replacement Toner Cartridge", qty: 2, unitCost: 118.0 },
  { name: "VPN Client License", qty: 12, unitCost: 9.5 },
];

const EXPENSE_POOL = [
  { description: "On-site travel — client office", category: "travel", amount: 85.5 },
  { description: "Replacement network switch", category: "hardware", amount: 249.99 },
  { description: "Malware analysis tool subscription", category: "software", amount: 59.0 },
  { description: "Replacement toner cartridge", category: "parts", amount: 118.0 },
  { description: "After-hours labor surcharge", category: "labor", amount: 175.0 },
];

const SCHEDULE_POOL = [
  { title: "On-site visit", location: "Client office" },
  { title: "Remote session with user", location: "" },
  { title: "Change window maintenance", location: "" },
  { title: "Vendor conference call", location: "Teams" },
  { title: "Backup verification review", location: "" },
];

const ATTACH_POOL = [
  "error-log-export.txt",
  "network-diagram.pdf",
  "screenshot-before-after.png",
  "purchase-order.pdf",
  "config-backup.json",
  "meeting-notes.docx",
];

const LINK_REL_POOL = ["related", "parent", "duplicate"];

const HISTORY_POOL = [
  "Status: New → In Progress",
  "Priority: Medium → High",
  "Due Date: (empty) → next business day",
  "Assigned To: (empty) → assigned technician",
];

const AUDIT_ACTIONS: Array<{ action: string; changes: Record<string, unknown> }> = [
  { action: "ticket:update", changes: { status: "in_progress" } },
  { action: "ticket:update", changes: { priority: "high" } },
  { action: "ticket:create", changes: { title: "sample" } },
  { action: "ticket:update", changes: { assignedToId: "assigned" } },
];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   C7NTAX — Seed Ticket Tabs              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const tickets = await prisma.ticket.findMany({ orderBy: { ticketNumber: "asc" } });
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } });
  if (tickets.length === 0) {
    console.log("No tickets found — nothing to seed. Run db:seed-full or db:seed-from-snapshots first.");
    return;
  }
  const tech = users.find(u => u.firstName && u.lastName && u.firstName !== "Admin") || users[0];
  if (!tech) {
    console.log("No users found — cannot seed linked data.");
    return;
  }

  console.log(`Seeding tab data for ${tickets.length} tickets (linked user: ${tech.firstName} ${tech.lastName})...\n`);

  // Real entities for cross-app links
  const realAssets = await prisma.asset.findMany({ take: 12, select: { id: true, name: true } });
  const realServers = await prisma.kumoServer.findMany({ take: 12, select: { id: true, hostname: true, kumoAsset: { select: { name: true } } } });

  let addedConfigs = 0, addedProducts = 0, addedLinks = 0, addedAttach = 0;
  let addedExpenses = 0, addedSchedules = 0, addedHistory = 0, addedAudit = 0;

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const offset = i * 2;

    // ── customFields tab data ──
    const existing = (t.customFields && typeof t.customFields === "object" ? t.customFields : {}) as Record<string, unknown>;
    const existingCf = existing as Record<string, unknown>;

    const configs = Array.isArray(existingCf.ticketConfigurations) ? (existingCf.ticketConfigurations as unknown[]) : [];
    if (configs.length === 0) {
      const c1 = CONFIG_POOL[offset % CONFIG_POOL.length];
      const c2 = CONFIG_POOL[(offset + 1) % CONFIG_POOL.length];
      const a1 = realAssets[offset % realAssets.length];
      const a2 = realAssets[(offset + 1) % realAssets.length];
      const s1 = realServers[offset % realServers.length];
      const s2 = realServers[(offset + 1) % realServers.length];
      existingCf.ticketConfigurations = [
        { id: `s-${t.id.slice(0, 8)}-c1`, name: a1 ? a1.name : c1.name, type: "Asset", kind: "asset", refId: a1?.id || "", linkedAt: daysAgo(6 - (i % 5)).toISOString() },
        { id: `s-${t.id.slice(0, 8)}-c2`, name: s1 ? (s1.kumoAsset?.name || s1.hostname) : (s2 ? (s2.kumoAsset?.name || s2.hostname) : c2.name), type: "Kumo Config", kind: "kumoServer", refId: s1?.id || s2?.id || "", linkedAt: daysAgo(4 - (i % 3)).toISOString() },
      ];
      addedConfigs += 2;
    }

    const products = Array.isArray(existingCf.ticketProducts) ? (existingCf.ticketProducts as unknown[]) : [];
    if (products.length === 0) {
      const p1 = PRODUCT_POOL[offset % PRODUCT_POOL.length];
      const p2 = PRODUCT_POOL[(offset + 3) % PRODUCT_POOL.length];
      existingCf.ticketProducts = [
        { id: `s-${t.id.slice(0, 8)}-p1`, ...p1 },
        { id: `s-${t.id.slice(0, 8)}-p2`, ...p2 },
      ];
      addedProducts += 2;
    }

    const links = Array.isArray(existingCf.ticketLinks) ? (existingCf.ticketLinks as unknown[]) : [];
    if (links.length === 0) {
      const other = tickets[(i + 1) % tickets.length];
      const other2 = tickets[(i + 3) % tickets.length];
      existingCf.ticketLinks = [
        { id: `s-${t.id.slice(0, 8)}-l1`, ticketId: other.id, ticketNumber: other.ticketNumber, title: other.title, rel: LINK_REL_POOL[i % LINK_REL_POOL.length], linkedAt: daysAgo(5).toISOString() },
        { id: `s-${t.id.slice(0, 8)}-l2`, ticketId: other2.id, ticketNumber: other2.ticketNumber, title: other2.title, rel: "related", linkedAt: daysAgo(2).toISOString() },
      ];
      addedLinks += 2;
    }

    const attaches = Array.isArray(existingCf.ticketAttachments) ? (existingCf.ticketAttachments as unknown[]) : [];
    // Migrate legacy customFields attachments into real TicketAttachment records
    const realAttCount = await prisma.ticketAttachment.count({ where: { ticketId: t.id } });
    if (realAttCount === 0) {
      const rows: Array<{ ticketId: string; filename: string; mimeType: string; size: number; storagePath: string; uploadedById: string; createdAt: Date }> = [];
      if (attaches.length > 0) {
        for (const a of attaches as any[]) {
          rows.push({ ticketId: t.id, filename: a.name || "attachment", mimeType: "application/octet-stream", size: 0, storagePath: "pending-upload", uploadedById: tech.id, createdAt: a.at ? new Date(a.at) : daysAgo(3) });
        }
        addedAttach += attaches.length;
      }
      if (rows.length === 0) {
        rows.push(
          { ticketId: t.id, filename: ATTACH_POOL[offset % ATTACH_POOL.length], mimeType: "text/plain", size: 2048, storagePath: "pending-upload", uploadedById: tech.id, createdAt: daysAgo(3) },
          { ticketId: t.id, filename: ATTACH_POOL[(offset + 4) % ATTACH_POOL.length], mimeType: "application/pdf", size: 153600, storagePath: "pending-upload", uploadedById: tech.id, createdAt: daysAgo(1) },
        );
        addedAttach += 2;
      }
      await prisma.ticketAttachment.createMany({ data: rows as any });
    }
    delete existingCf.ticketAttachments;

    await prisma.ticket.update({ where: { id: t.id }, data: { customFields: existingCf as any } });

    // ── Expenses (linked by ticketId) ──
    const existingExpenses = await prisma.expense.count({ where: { ticketId: t.id } });
    if (existingExpenses === 0) {
      const e1 = EXPENSE_POOL[offset % EXPENSE_POOL.length];
      const e2 = EXPENSE_POOL[(offset + 2) % EXPENSE_POOL.length];
      await prisma.expense.createMany({
        data: [
          { ticketId: t.id, description: e1.description, amount: e1.amount, category: e1.category, expenseDate: daysAgo(5 - (i % 4)), createdById: tech.id, companyId: t.companyId },
          { ticketId: t.id, description: e2.description, amount: e2.amount, category: e2.category, expenseDate: daysAgo(2 - (i % 2)), createdById: tech.id, companyId: t.companyId },
        ],
      });
      addedExpenses += 2;
    }

    // ── Schedule entries (linked by ticketId) ──
    const existingSchedules = await prisma.scheduleEntry.count({ where: { ticketId: t.id } });
    if (existingSchedules === 0) {
      const s1 = SCHEDULE_POOL[offset % SCHEDULE_POOL.length];
      const s2 = SCHEDULE_POOL[(offset + 1) % SCHEDULE_POOL.length];
      const d1 = daysAgo(-1 - (i % 3));
      const d2 = daysAgo(-3 - (i % 4));
      const start1 = new Date(d1); start1.setHours(9, 0, 0, 0);
      const end1 = new Date(d1); end1.setHours(11, 0, 0, 0);
      const start2 = new Date(d2); start2.setHours(14, 30, 0, 0);
      const end2 = new Date(d2); end2.setHours(15, 30, 0, 0);
      await prisma.scheduleEntry.createMany({
        data: [
          { ticketId: t.id, userId: tech.id, title: s1.title, location: s1.location || null, startTime: start1, endTime: end1, status: "scheduled", color: "#3b82d6" },
          { ticketId: t.id, userId: tech.id, title: s2.title, location: s2.location || null, startTime: start2, endTime: end2, status: "scheduled", color: "#8b5cf6" },
        ],
      });
      addedSchedules += 2;
    }

    // ── History (change-log comment) ──
    const historyCount = await prisma.ticketComment.count({ where: { ticketId: t.id, isInternal: true, body: { contains: "→" } } });
    if (historyCount === 0) {
      await prisma.ticketComment.create({
        data: {
          ticketId: t.id,
          body: HISTORY_POOL[i % HISTORY_POOL.length],
          authorId: tech.id,
          isInternal: true,
          createdAt: daysAgo(7 - (i % 5)),
        },
      });
      addedHistory++;
    }

    // ── Audit trail entries ──
    const auditCount = await prisma.auditLog.count({ where: { entity: "ticket", entityId: t.id } });
    if (auditCount === 0) {
      const a1 = AUDIT_ACTIONS[i % AUDIT_ACTIONS.length];
      const a2 = AUDIT_ACTIONS[(i + 2) % AUDIT_ACTIONS.length];
      await prisma.auditLog.createMany({
        data: [
          { action: a1.action, entity: "ticket", entityId: t.id, changes: a1.changes as any, userId: tech.id, ipAddress: "127.0.0.1", createdAt: daysAgo(6 - (i % 5)) },
          { action: a2.action, entity: "ticket", entityId: t.id, changes: a2.changes as any, userId: tech.id, ipAddress: "127.0.0.1", createdAt: daysAgo(1 + (i % 3)) },
        ],
      });
      addedAudit += 2;
    }

    console.log(`  ✓ ${t.ticketNumber}: configs, products, links, attachments, expenses, schedule, history, audit`);
  }

  console.log(`\nSeed complete:`);
  console.log(`  Configurations: +${addedConfigs}`);
  console.log(`  Products: +${addedProducts}`);
  console.log(`  Links: +${addedLinks}`);
  console.log(`  Attachments: +${addedAttach}`);
  console.log(`  Expenses: +${addedExpenses}`);
  console.log(`  Schedule entries: +${addedSchedules}`);
  console.log(`  History comments: +${addedHistory}`);
  console.log(`  Audit entries: +${addedAudit}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
