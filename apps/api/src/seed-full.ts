import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Permission } from "@C7NTAX/shared";
import { encrypt } from "./services/kumoCrypto";
const prisma = new PrismaClient();

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   C7NTAX — Full Database Seed           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ── Clean existing data (reverse FK order) ──
  await prisma.kumoFile.deleteMany();
  await prisma.kumoLink.deleteMany();
  await prisma.kumoCertificate.deleteMany();
  await prisma.kumoDomain.deleteMany();
  await prisma.kumoPassword.deleteMany();
  await prisma.kumoServer.deleteMany();
  await prisma.kumoWorkstation.deleteMany();
  await prisma.kumoNetworkDevice.deleteMany();
  await prisma.kumoDocument.deleteMany();
  await prisma.kumoAssetFieldValue.deleteMany();
  await prisma.kumoAsset.deleteMany();
  await prisma.kumoTemplateField.deleteMany();
  await prisma.kumoAssetTemplate.deleteMany();
  await prisma.kumoFolder.deleteMany();
  await prisma.syncedEntity.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.m365Subscription.deleteMany();
  await prisma.m365Group.deleteMany();
  await prisma.m365User.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.scheduleEntry.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.serviceAgreement.deleteMany();
  await prisma.projectPhase.deleteMany();
  await prisma.project.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.knowledgeBaseArticle.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.serviceBoard.deleteMany();
  console.log("  ✓ Cleaned existing data\n");

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  // ── Roles ──
  const superAdminRole = await prisma.role.create({ data: { name: "Super Admin", systemRole: "super_admin", isDefault: false, permissions: Object.values(Permission) } });
  const adminRole = await prisma.role.create({ data: { name: "Admin", systemRole: "admin", isDefault: true, permissions: ["ticket:view","ticket:create","ticket:edit","ticket:delete","ticket:assign","ticket:close","ticket:view_all","board:view","board:manage","client:view","client:create","client:edit","client:delete","billing:view","billing:manage","invoice:create","invoice:send","user:manage","role:manage","system:config","integration:view","integration:manage","report:view","report:export","report:create","kumo:view","kumo:manage","kumo:view_all","kumo:asset:view","kumo:asset:create","kumo:asset:edit","kumo:asset:delete","kumo:asset:template:manage","kumo:passwords:view","kumo:passwords:create","kumo:passwords:edit","kumo:passwords:delete","kumo:passwords:reveal","kumo:config:view","kumo:config:create","kumo:config:edit","kumo:config:delete","kumo:doc:view","kumo:doc:create","kumo:doc:edit","kumo:doc:delete","kumo:doc:publish","kumo:link:view","kumo:link:manage","asset:view","asset:create","asset:edit","asset:delete","project:view","project:create","project:edit","project:delete","project:manage","kb:view","kb:create","kb:edit","kb:delete","kb:manage","opportunity:view","opportunity:create","opportunity:edit","opportunity:delete","procurement:view","procurement:create","procurement:approve","schedule:view","schedule:manage","pto:view","pto:request","pto:approve","inference:view","inference:manage","security:manage","mfa:enforce"] } });
  const techRole = await prisma.role.create({ data: { name: "Technician", systemRole: "technician", permissions: ["ticket:view","ticket:create","ticket:edit","ticket:assign","ticket:close","board:view","client:view","integration:view","report:view"] } });
  const clientRole = await prisma.role.create({ data: { name: "Client Admin", systemRole: "client_admin", permissions: ["ticket:view","ticket:create","ticket:edit","board:view","client:view","billing:view"] } });
  const readOnlyRole = await prisma.role.create({ data: { name: "Read Only", systemRole: "read_only", permissions: ["ticket:view","board:view","client:view","report:view"] } });
  console.log("  ✓ Created 5 roles");

  // ── Users ──
  const adminUser = await prisma.user.create({ data: { email: "admin@C7NTAX.com", username: "admin", passwordHash: hash("admin"), firstName: "Admin", lastName: "User", roleId: adminRole.id, isActive: true, emailVerified: true } });
  const tech1 = await prisma.user.create({ data: { email: "john.smith@c7ntax.com", username: "jsmith", passwordHash: hash("password123"), firstName: "John", lastName: "Smith", roleId: techRole.id, isActive: true } });
  const tech2 = await prisma.user.create({ data: { email: "sarah.jones@c7ntax.com", username: "sjones", passwordHash: hash("password123"), firstName: "Sarah", lastName: "Jones", roleId: techRole.id, isActive: true } });
  const manager = await prisma.user.create({ data: { email: "mike.wilson@c7ntax.com", username: "mwilson", passwordHash: hash("password123"), firstName: "Mike", lastName: "Wilson", roleId: adminRole.id, isActive: true } });
  const billing = await prisma.user.create({ data: { email: "lisa.brown@c7ntax.com", username: "lbrown", passwordHash: hash("password123"), firstName: "Lisa", lastName: "Brown", roleId: adminRole.id, isActive: true } });
  const client1 = await prisma.user.create({ data: { email: "david@acmecorp.com", username: "david", passwordHash: hash("password123"), firstName: "David", lastName: "Chen", roleId: clientRole.id, isActive: true } });
  console.log("  ✓ Created 6 users");

  // ── Companies ──
  const acme = await prisma.company.create({ data: { name: "Acme Corporation", clientId: 1001, clientType: "MSP", email: "info@acmecorp.com", phone: "+1-555-0100", website: "https://acmecorp.com", city: "New York", state: "NY", country: "US", isActive: true } });
  const globex = await prisma.company.create({ data: { name: "Globex Industries", clientId: 1002, clientType: "INT", email: "contact@globexind.com", phone: "+1-555-0200", website: "https://globexind.com", city: "Chicago", state: "IL", country: "US", isActive: true } });
  const initech = await prisma.company.create({ data: { name: "Initech Solutions", clientId: 1003, clientType: "MSP", email: "support@initech.io", phone: "+1-555-0300", website: "https://initech.io", city: "Austin", state: "TX", country: "US", isActive: true } });
  const umbrell = await prisma.company.create({ data: { name: "Umbrella Corp", clientId: 1004, clientType: "INF", email: "info@umbrellacorp.net", phone: "+1-555-0400", website: "https://umbrellacorp.net", city: "Seattle", state: "WA", country: "US", isActive: true } });
  const stark = await prisma.company.create({ data: { name: "Stark Enterprises", clientId: 1005, clientType: "MSP", email: "hello@starkent.com", phone: "+1-555-0500", website: "https://starkent.com", city: "San Francisco", state: "CA", country: "US", isActive: true } });
  console.log("  ✓ Created 5 companies");

  // ── Contacts ──
  await prisma.contact.createMany({ data: [
    { firstName: "David", lastName: "Chen", email: "david@acmecorp.com", phone: "+1-555-0101", mobile: "+1-555-0111", title: "IT Director", department: "Information Technology", companyId: acme.id, isPrimary: true, isActive: true },
    { firstName: "Maria", lastName: "Garcia", email: "maria@acmecorp.com", phone: "+1-555-0102", title: "HR Manager", department: "Human Resources", companyId: acme.id, isPrimary: false, isActive: true },
    { firstName: "James", lastName: "Wilson", email: "jwilson@acmecorp.com", phone: "+1-555-0103", title: "CFO", department: "Finance", companyId: acme.id, isPrimary: false, isActive: true },
    { firstName: "Emily", lastName: "Johnson", email: "emily@globexind.com", phone: "+1-555-0201", mobile: "+1-555-0211", title: "VP Operations", department: "Operations", companyId: globex.id, isPrimary: true, isActive: true },
    { firstName: "Robert", lastName: "Kim", email: "rkim@globexind.com", phone: "+1-555-0202", title: "Network Admin", department: "IT", companyId: globex.id, isPrimary: false, isActive: true },
    { firstName: "Sarah", lastName: "Lee", email: "slee@globexind.com", phone: "+1-555-0203", mobile: "+1-555-0213", title: "Office Manager", department: "Administration", companyId: globex.id, isPrimary: false, isActive: true },
    { firstName: "Michael", lastName: "Brown", email: "mbrown@initech.io", phone: "+1-555-0301", title: "CEO", department: "Executive", companyId: initech.id, isPrimary: true, isActive: true },
    { firstName: "Jessica", lastName: "Davis", email: "jdavis@initech.io", phone: "+1-555-0302", mobile: "+1-555-0312", title: "CTO", department: "Engineering", companyId: initech.id, isPrimary: false, isActive: true },
    { firstName: "Alice", lastName: "Wong", email: "alice@umbrellacorp.net", phone: "+1-555-0401", title: "Security Officer", department: "Security", companyId: umbrell.id, isPrimary: true, isActive: true },
    { firstName: "Thomas", lastName: "Mueller", email: "tmueller@umbrellacorp.net", phone: "+1-555-0402", mobile: "+1-555-0412", title: "IT Manager", department: "IT", companyId: umbrell.id, isPrimary: false, isActive: true },
    { firstName: "Tony", lastName: "Stark", email: "tony@starkent.com", phone: "+1-555-0501", mobile: "+1-555-0511", title: "Owner", department: "Executive", companyId: stark.id, isPrimary: true, isActive: true },
    { firstName: "Pepper", lastName: "Potts", email: "pepper@starkent.com", phone: "+1-555-0502", mobile: "+1-555-0512", title: "Operations Director", department: "Operations", companyId: stark.id, isPrimary: false, isActive: true },
    { firstName: "Happy", lastName: "Hogan", email: "happy@starkent.com", phone: "+1-555-0503", title: "Facilities Manager", department: "Facilities", companyId: stark.id, isPrimary: false, isActive: true },
  ] });
  console.log("  ✓ Created 13 contacts");

  // ── Service Boards ──
  const helpdesk = await prisma.serviceBoard.create({ data: { name: "Helpdesk", description: "General IT support", slaResponseMinutes: 120, slaResolutionMinutes: 480 } });
  const security = await prisma.serviceBoard.create({ data: { name: "Security", description: "Security incidents and alerts", slaResponseMinutes: 30, slaResolutionMinutes: 240 } });
  const onboarding = await prisma.serviceBoard.create({ data: { name: "Client Onboarding", description: "New client setup and migration", slaResponseMinutes: 240, slaResolutionMinutes: 1440 } });
  console.log("  ✓ Created 3 service boards");

  // ── Service Agreements ──
  await prisma.serviceAgreement.createMany({ data: [
    { name: "Acme Standard Plan", companyId: acme.id, billingPeriod: "monthly", billingAmount: 2500, taxRate: 0.085, startDate: new Date("2026-01-01"), autoInvoiceEnabled: true },
    { name: "Globex Enterprise", companyId: globex.id, billingPeriod: "monthly", billingAmount: 8000, taxRate: 0.085, startDate: new Date("2026-03-01"), autoInvoiceEnabled: true },
    { name: "Initech Pro", companyId: initech.id, billingPeriod: "monthly", billingAmount: 3500, taxRate: 0.0825, startDate: new Date("2026-02-15"), autoInvoiceEnabled: true },
    { name: "Umbrella Silver", companyId: umbrell.id, billingPeriod: "quarterly", billingAmount: 4500, taxRate: 0.085, startDate: new Date("2026-01-15"), autoInvoiceEnabled: false },
    { name: "Stark Platinum", companyId: stark.id, billingPeriod: "monthly", billingAmount: 12000, taxRate: 0.0875, startDate: new Date("2025-06-01"), autoInvoiceEnabled: true },
  ] });
  console.log("  ✓ Created 5 service agreements");

  // ── Tickets ──
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  const t1 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1001-1001", title: "Email server not sending outbound messages", description: "Users cannot send external emails. Internal mail flow works fine. Error: 550 5.7.1 Unable to relay.", status: "in_progress", priority: "high", boardId: helpdesk.id, companyId: acme.id, contactId: (await prisma.contact.findFirst({ where: { companyId: acme.id } }))!.id, assignedToId: tech1.id, createdById: adminUser.id, startTime: daysAgo(1), dueDate: daysAgo(-2) } });
  const t2 = await prisma.ticket.create({ data: { ticketNumber: "INT-1002-1001", title: "Network drive mapping failure after migration", description: "All users in Chicago office lost mapped drives after weekend migration. GPO seems intact.", status: "new", priority: "critical", boardId: helpdesk.id, companyId: globex.id, assignedToId: tech2.id, createdById: manager.id, dueDate: daysAgo(-1) } });
  const t3 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1003-1001", title: "VPN connection drops every 15 minutes", description: "Remote users report consistent VPN disconnects. Affects 12 users. Started Monday morning.", status: "waiting_on_client", priority: "medium", boardId: helpdesk.id, companyId: initech.id, assignedToId: tech1.id, createdById: adminUser.id, startTime: daysAgo(3) } });
  const t4 = await prisma.ticket.create({ data: { ticketNumber: "INF-1004-1001", title: "Phishing alert: suspicious email circulating", description: "Multiple users received fake invoice email. Attachment was quarantined by Defender. Need to verify scope.", status: "resolved", priority: "high", boardId: security.id, companyId: umbrell.id, assignedToId: tech2.id, createdById: tech2.id, resolvedAt: daysAgo(1) } });
  const t5 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1005-1001", title: "New user onboarding — Finance department", description: "Need 3 new workstations set up with standard software stack. John in Finance starts next Monday.", status: "new", priority: "low", boardId: onboarding.id, companyId: stark.id, assignedToId: tech1.id, createdById: manager.id, dueDate: daysAgo(-5) } });
  const t6 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1001-1002", title: "Printer queue stuck — reception area", description: "Reception printer IR-ADV C5550 shows 'Processing' but never prints. Restarted spooler, no change.", status: "in_progress", priority: "medium", boardId: helpdesk.id, companyId: acme.id, assignedToId: tech2.id, createdById: adminUser.id } });
  const t7 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1003-1002", title: "Software license renewal — Adobe CC", description: "Adobe Creative Cloud licenses expire next month. Need to renew for design team (8 seats).", status: "pending_approval", priority: "medium", boardId: helpdesk.id, companyId: initech.id, createdById: manager.id, assignedToId: tech1.id } });
  const t8 = await prisma.ticket.create({ data: { ticketNumber: "MSP-1005-1002", title: "MFA setup for C-suite execs", description: "CEO and CFO need MFA configured on their accounts. Schedule with their EAs for 15-min remote session.", status: "in_progress", priority: "high", boardId: security.id, companyId: stark.id, assignedToId: tech2.id, createdById: tech2.id, startTime: daysAgo(0.5) } });
  console.log("  ✓ Created 8 tickets");

  // ── Ticket Comments ──
  await prisma.ticketComment.createMany({ data: [
    { ticketId: t1.id, body: "Checked Exchange Online — connector is healthy. Investigating transport rules.", authorId: tech1.id, createdAt: daysAgo(1) },
    { ticketId: t1.id, body: "Found the issue — outbound connector was pointing to old smart host IP after ISP change. Updated and testing.", authorId: tech1.id, createdAt: daysAgo(0.5) },
    { ticketId: t3.id, body: "We've tested VPN from three different locations. Issue appears to be with ISP routing, not our configuration.", authorId: tech1.id, createdAt: daysAgo(2) },
    { ticketId: t4.id, body: "Email was from spoofed domain. Defender has blocked the attachment across all mailboxes. User training scheduled.", authorId: tech2.id, createdAt: daysAgo(2) },
    { ticketId: t4.id, body: "Marking as resolved. All checks clear — no compromise detected. User awareness email sent company-wide.", authorId: tech2.id, createdAt: daysAgo(1) },
    { ticketId: t8.id, body: "CEO's MFA configured — Microsoft Authenticator. CFO session scheduled for tomorrow 10:00 AM.", authorId: tech2.id, createdAt: daysAgo(0.2) },
  ] });
  console.log("  ✓ Created 6 ticket comments");

  // ── Time Entries ──
  await prisma.timeEntry.createMany({ data: [
    { ticketId: t1.id, userId: tech1.id, minutes: 90, billable: true, description: "Diagnosed Exchange transport rules and connector config", date: daysAgo(1) },
    { ticketId: t1.id, userId: tech1.id, minutes: 45, billable: true, description: "Updated outbound connector and verified mail flow", date: daysAgo(0.5) },
    { ticketId: t4.id, userId: tech2.id, minutes: 120, billable: true, description: "Investigated phishing email — message trace, attachment analysis", date: daysAgo(2) },
    { ticketId: t4.id, userId: tech2.id, minutes: 30, billable: false, description: "Sent user awareness communication", date: daysAgo(1) },
    { ticketId: t8.id, userId: tech2.id, minutes: 15, billable: true, description: "MFA setup for CEO", date: daysAgo(0.2) },
  ] });
  console.log("  ✓ Created 5 time entries");

  // ── Ticket Tab Sample Data (toolbar tabs: Configurations, Products, Links,
  //    Attachments, Expenses, Schedule, History, Audit Trail) ──
  const allTickets = [t1, t2, t3, t4, t5, t6, t7, t8];
  const cfConfigs = [
    { name: "DC-01 Domain Controller", type: "Kumo Config" },
    { name: "EXCH-01 Exchange Server", type: "Kumo Config" },
    { name: "ThinkPad T14 — Finance", type: "Asset" },
    { name: "Reception Printer IR-ADV C5550", type: "Asset" },
  ];
  const cfProducts = [
    { name: "SSD 1TB Upgrade Kit", qty: 1, unitCost: 149.99 },
    { name: "USB-C Docking Station", qty: 2, unitCost: 189.0 },
    { name: "Patch Cable Cat6 (10-pack)", qty: 1, unitCost: 24.5 },
    { name: "Laptop RAM 16GB SODIMM", qty: 2, unitCost: 79.99 },
  ];
  for (let i = 0; i < allTickets.length; i++) {
    const tk = allTickets[i];
    const other = allTickets[(i + 1) % allTickets.length];
    const other2 = allTickets[(i + 3) % allTickets.length];
    await prisma.ticket.update({
      where: { id: tk.id },
      data: {
        customFields: {
          ticketConfigurations: [
            { id: `s-${tk.id.slice(0, 8)}-c1`, ...cfConfigs[i % cfConfigs.length], linkedAt: daysAgo(6 - (i % 5)) },
            { id: `s-${tk.id.slice(0, 8)}-c2`, ...cfConfigs[(i + 1) % cfConfigs.length], linkedAt: daysAgo(4 - (i % 3)) },
          ],
          ticketProducts: [
            { id: `s-${tk.id.slice(0, 8)}-p1`, ...cfProducts[i % cfProducts.length] },
            { id: `s-${tk.id.slice(0, 8)}-p2`, ...cfProducts[(i + 2) % cfProducts.length] },
          ],
          ticketLinks: [
            { id: `s-${tk.id.slice(0, 8)}-l1`, ticketId: other.id, ticketNumber: other.ticketNumber, title: other.title, rel: "related", linkedAt: daysAgo(5).toISOString() },
            { id: `s-${tk.id.slice(0, 8)}-l2`, ticketId: other2.id, ticketNumber: other2.ticketNumber, title: other2.title, rel: "related", linkedAt: daysAgo(2).toISOString() },
          ],
        } as any,
      },
    });
  }
  console.log("  ✓ Ticket tab data (configs, products, links, attachments) — 8 tickets");

  // Real ticket attachments (synced with the Attachments tab)
  await prisma.ticketAttachment.createMany({ data: [
    { ticketId: t1.id, filename: "network-diagram.pdf", mimeType: "application/pdf", size: 153600, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(3) },
    { ticketId: t1.id, filename: "error-log-export.txt", mimeType: "text/plain", size: 2048, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(1) },
    { ticketId: t2.id, filename: "screenshot-before-after.png", mimeType: "image/png", size: 512000, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(2) },
    { ticketId: t2.id, filename: "purchase-order.pdf", mimeType: "application/pdf", size: 88064, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(1) },
    { ticketId: t3.id, filename: "config-backup.json", mimeType: "application/json", size: 4096, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(4) },
    { ticketId: t3.id, filename: "meeting-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 24576, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(1) },
    { ticketId: t4.id, filename: "error-log-export.txt", mimeType: "text/plain", size: 10240, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(2) },
    { ticketId: t4.id, filename: "network-diagram.pdf", mimeType: "application/pdf", size: 153600, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(0.5) },
    { ticketId: t5.id, filename: "screenshot-before-after.png", mimeType: "image/png", size: 204800, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(3) },
    { ticketId: t5.id, filename: "purchase-order.pdf", mimeType: "application/pdf", size: 88064, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(1) },
    { ticketId: t6.id, filename: "config-backup.json", mimeType: "application/json", size: 4096, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(2) },
    { ticketId: t6.id, filename: "meeting-notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 24576, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(1) },
    { ticketId: t7.id, filename: "error-log-export.txt", mimeType: "text/plain", size: 6144, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(2) },
    { ticketId: t7.id, filename: "network-diagram.pdf", mimeType: "application/pdf", size: 153600, storagePath: "pending-upload", uploadedById: tech1.id, createdAt: daysAgo(1) },
    { ticketId: t8.id, filename: "screenshot-before-after.png", mimeType: "image/png", size: 307200, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(1) },
    { ticketId: t8.id, filename: "purchase-order.pdf", mimeType: "application/pdf", size: 88064, storagePath: "pending-upload", uploadedById: tech2.id, createdAt: daysAgo(0.5) },
  ] });
  console.log("  ✓ Created 16 ticket attachments");

  await prisma.expense.createMany({ data: [
    { ticketId: t1.id, companyId: acme.id, createdById: tech1.id, description: "On-site travel — client office", category: "travel", amount: 85.5, expenseDate: daysAgo(5) },
    { ticketId: t1.id, companyId: acme.id, createdById: tech1.id, description: "Replacement network switch", category: "hardware", amount: 249.99, expenseDate: daysAgo(2) },
    { ticketId: t2.id, companyId: globex.id, createdById: tech2.id, description: "Malware analysis tool subscription", category: "software", amount: 59.0, expenseDate: daysAgo(4) },
    { ticketId: t2.id, companyId: globex.id, createdById: tech2.id, description: "After-hours labor surcharge", category: "labor", amount: 175.0, expenseDate: daysAgo(1) },
    { ticketId: t3.id, companyId: initech.id, createdById: tech1.id, description: "Replacement toner cartridge", category: "parts", amount: 118.0, expenseDate: daysAgo(3) },
    { ticketId: t3.id, companyId: initech.id, createdById: tech1.id, description: "On-site travel — branch office", category: "travel", amount: 62.75, expenseDate: daysAgo(1) },
    { ticketId: t4.id, companyId: umbrell.id, createdById: tech2.id, description: "Malware analysis tool subscription", category: "software", amount: 59.0, expenseDate: daysAgo(4) },
    { ticketId: t4.id, companyId: umbrell.id, createdById: tech2.id, description: "Replacement network switch", category: "hardware", amount: 249.99, expenseDate: daysAgo(2) },
    { ticketId: t5.id, companyId: stark.id, createdById: tech1.id, description: "On-site travel — client office", category: "travel", amount: 85.5, expenseDate: daysAgo(5) },
    { ticketId: t5.id, companyId: stark.id, createdById: tech1.id, description: "USB-C docking station for onboarding", category: "hardware", amount: 189.0, expenseDate: daysAgo(1) },
    { ticketId: t6.id, companyId: acme.id, createdById: tech2.id, description: "Replacement toner cartridge", category: "parts", amount: 118.0, expenseDate: daysAgo(3) },
    { ticketId: t6.id, companyId: acme.id, createdById: tech2.id, description: "After-hours labor surcharge", category: "labor", amount: 175.0, expenseDate: daysAgo(1) },
    { ticketId: t7.id, companyId: initech.id, createdById: tech1.id, description: "Adobe license procurement fee", category: "software", amount: 42.5, expenseDate: daysAgo(2) },
    { ticketId: t7.id, companyId: initech.id, createdById: tech1.id, description: "Patch cable Cat6 (10-pack)", category: "parts", amount: 24.5, expenseDate: daysAgo(1) },
    { ticketId: t8.id, companyId: stark.id, createdById: tech2.id, description: "Security key hardware", category: "hardware", amount: 129.99, expenseDate: daysAgo(2) },
    { ticketId: t8.id, companyId: stark.id, createdById: tech2.id, description: "After-hours labor surcharge", category: "labor", amount: 175.0, expenseDate: daysAgo(0.5) },
  ] });
  console.log("  ✓ Created 16 ticket expenses (linked to Billing → Time & Expenses)");

  await prisma.scheduleEntry.createMany({ data: [
    { ticketId: t1.id, userId: tech1.id, title: "On-site visit", location: "Client office", startTime: daysAgo(-1), endTime: daysAgo(-0.9), status: "scheduled", color: "#3b82d6" },
    { ticketId: t2.id, userId: tech2.id, title: "Remote session with user", location: null, startTime: daysAgo(-2), endTime: daysAgo(-1.9), status: "scheduled", color: "#8b5cf6" },
    { ticketId: t3.id, userId: tech1.id, title: "Vendor conference call", location: "Teams", startTime: daysAgo(-1.5), endTime: daysAgo(-1.4), status: "scheduled", color: "#3b82d6" },
    { ticketId: t4.id, userId: tech2.id, title: "Backup verification review", location: null, startTime: daysAgo(-3), endTime: daysAgo(-2.9), status: "scheduled", color: "#8b5cf6" },
    { ticketId: t5.id, userId: tech1.id, title: "Change window maintenance", location: null, startTime: daysAgo(-4), endTime: daysAgo(-3.9), status: "scheduled", color: "#3b82d6" },
    { ticketId: t6.id, userId: tech2.id, title: "On-site visit", location: "Client office", startTime: daysAgo(-2.5), endTime: daysAgo(-2.4), status: "scheduled", color: "#8b5cf6" },
    { ticketId: t7.id, userId: tech1.id, title: "Remote session with user", location: null, startTime: daysAgo(-1.2), endTime: daysAgo(-1.1), status: "scheduled", color: "#3b82d6" },
    { ticketId: t8.id, userId: tech2.id, title: "On-site visit", location: "Client office", startTime: daysAgo(-0.8), endTime: daysAgo(-0.7), status: "scheduled", color: "#8b5cf6" },
  ] });
  console.log("  ✓ Created 8 ticket schedule entries");

  await prisma.ticketComment.createMany({ data: [
    { ticketId: t1.id, body: "Status: New → In Progress", authorId: tech1.id, isInternal: true, createdAt: daysAgo(6) },
    { ticketId: t2.id, body: "Priority: Medium → Critical", authorId: tech2.id, isInternal: true, createdAt: daysAgo(5) },
    { ticketId: t3.id, body: "Status: In Progress → Waiting On Client", authorId: tech1.id, isInternal: true, createdAt: daysAgo(4) },
    { ticketId: t4.id, body: "Status: In Progress → Resolved", authorId: tech2.id, isInternal: true, createdAt: daysAgo(1) },
    { ticketId: t5.id, body: "Due Date: (empty) → next business day", authorId: tech1.id, isInternal: true, createdAt: daysAgo(3) },
    { ticketId: t6.id, body: "Priority: Low → Medium", authorId: tech2.id, isInternal: true, createdAt: daysAgo(2) },
    { ticketId: t7.id, body: "Status: New → Pending Approval", authorId: tech1.id, isInternal: true, createdAt: daysAgo(2) },
    { ticketId: t8.id, body: "Assigned To: (empty) → assigned technician", authorId: tech2.id, isInternal: true, createdAt: daysAgo(1) },
  ] });
  console.log("  ✓ Created 8 History change-log comments");

  await prisma.auditLog.createMany({ data: [
    { action: "ticket:update", entity: "ticket", entityId: t1.id, changes: { status: "in_progress" } as any, userId: tech1.id, ipAddress: "127.0.0.1", createdAt: daysAgo(6) },
    { action: "ticket:create", entity: "ticket", entityId: t1.id, changes: { title: "created" } as any, userId: adminUser.id, ipAddress: "127.0.0.1", createdAt: daysAgo(7) },
    { action: "ticket:update", entity: "ticket", entityId: t2.id, changes: { priority: "critical" } as any, userId: tech2.id, ipAddress: "127.0.0.1", createdAt: daysAgo(5) },
    { action: "ticket:create", entity: "ticket", entityId: t2.id, changes: { title: "created" } as any, userId: manager.id, ipAddress: "127.0.0.1", createdAt: daysAgo(6) },
    { action: "ticket:update", entity: "ticket", entityId: t3.id, changes: { status: "waiting_on_client" } as any, userId: tech1.id, ipAddress: "127.0.0.1", createdAt: daysAgo(4) },
    { action: "ticket:update", entity: "ticket", entityId: t4.id, changes: { status: "resolved" } as any, userId: tech2.id, ipAddress: "127.0.0.1", createdAt: daysAgo(1) },
    { action: "ticket:update", entity: "ticket", entityId: t5.id, changes: { dueDate: "set" } as any, userId: tech1.id, ipAddress: "127.0.0.1", createdAt: daysAgo(3) },
    { action: "ticket:update", entity: "ticket", entityId: t6.id, changes: { priority: "medium" } as any, userId: tech2.id, ipAddress: "127.0.0.1", createdAt: daysAgo(2) },
    { action: "ticket:update", entity: "ticket", entityId: t7.id, changes: { status: "pending_approval" } as any, userId: tech1.id, ipAddress: "127.0.0.1", createdAt: daysAgo(2) },
    { action: "ticket:update", entity: "ticket", entityId: t8.id, changes: { assignedToId: "assigned" } as any, userId: tech2.id, ipAddress: "127.0.0.1", createdAt: daysAgo(1) },
  ] });
  console.log("  ✓ Created 10 ticket audit trail entries");

  // ── Projects ──
  await prisma.project.createMany({ data: [
    { name: "Acme SharePoint Migration", description: "Migrate legacy file shares to SharePoint Online — Phase 2", companyId: acme.id, status: "in_progress", priority: "high", startDate: daysAgo(30), endDate: daysAgo(-14), budget: 15000, managerId: manager.id },
    { name: "Globex Firewall Refresh", description: "Replace aging SonicWall appliances with Fortigate at 3 sites", companyId: globex.id, status: "planning", priority: "critical", budget: 35000, managerId: tech2.id },
    { name: "Stark DR Exercise", description: "Annual disaster recovery tabletop and live failover test", companyId: stark.id, status: "planning", priority: "medium", startDate: daysAgo(-21), endDate: daysAgo(-7), budget: 5000 },
  ] });
  console.log("  ✓ Created 3 projects");

  // ── Assets ──
  await prisma.asset.createMany({ data: [
    { name: "SRV-DC-01", assetTag: "ACME-DC01", type: "server", status: "active", model: "Dell PowerEdge R750", location: "Acme HQ - IDF 2", companyId: acme.id },
    { name: "FW-PRIMARY", assetTag: "GLOBEX-FW01", type: "firewall", status: "active", model: "SonicWall NSA 5700", location: "Globex Chicago - MDF", companyId: globex.id },
    { name: "SW-CORE-01", assetTag: "INITECH-SW01", type: "switch", status: "active", model: "Cisco Catalyst 9300", location: "Initech Austin - MDF", companyId: initech.id },
    { name: "LAP-MGR-03", assetTag: "UMB-LT03", type: "laptop", status: "maintenance", model: "Lenovo ThinkPad X1", location: "Umbrella Seattle - Floor 3", companyId: umbrell.id },
    { name: "AP-WING-A", assetTag: "STARK-AP01", type: "access_point", status: "active", model: "Aruba AP-535", location: "Stark SF - Wing A", companyId: stark.id },
  ] });
  console.log("  ✓ Created 5 assets");

  // ── Knowledge Base Articles ──
  await prisma.knowledgeBaseArticle.createMany({ data: [
    { title: "VPN Setup Guide for Remote Users", slug: "vpn-setup-guide", content: "# VPN Setup Guide\n\nFollow these steps to configure your VPN client.\n\n1. Download the client from company portal\n2. Enter your credentials\n3. Select the closest gateway\n4. Click Connect", excerpt: "Step-by-step guide for configuring the VPN client", status: "published", visibility: "public", authorId: tech1.id, tags: ["vpn", "remote", "setup"] },
    { title: "Common Email Issues and Troubleshooting", slug: "common-email-issues", content: "# Common Email Issues\n\n## Outbound Email Fails\n- Check Exchange connector settings\n- Verify smart host configuration\n- Test transport rules", excerpt: "Troubleshooting guide for common email delivery problems", status: "published", visibility: "internal", authorId: tech1.id, tags: ["email", "exchange", "troubleshooting"] },
    { title: "Phishing Awareness Training", slug: "phishing-awareness", content: "# Phishing Awareness\n\n## How to Spot Phishing\n- Check sender address carefully\n- Look for generic greetings\n- Don't click unexpected links\n- Report to IT immediately", excerpt: "Security awareness training for identifying phishing attempts", status: "published", visibility: "public", authorId: tech2.id, tags: ["security", "phishing", "training"] },
    { title: "New Hire Onboarding Checklist", slug: "new-hire-onboarding", content: "# New Hire Onboarding\n\n## Checklist\n1. Create user account\n2. Assign licenses\n3. Configure email\n4. Set up MFA\n5. Deploy workstation", excerpt: "Standard IT onboarding procedure for new employees", status: "draft", visibility: "internal", authorId: manager.id, tags: ["onboarding", "checklist"] },
  ] });
  console.log("  ✓ Created 4 KB articles");

  // ── Opportunities ──
  await prisma.opportunity.createMany({ data: [
    { name: "Acme — Security Assessment Upsell", companyId: acme.id, stage: "proposal", probability: 70, amount: 18000, expectedCloseDate: daysAgo(-14), assignedToId: manager.id },
    { name: "Globex — Managed SOC Service", companyId: globex.id, stage: "negotiation", probability: 50, amount: 45000, expectedCloseDate: daysAgo(-21), assignedToId: manager.id },
    { name: "NewCo — Full MSP Onboarding", companyId: initech.id, stage: "qualification", probability: 30, amount: 24000, assignedToId: manager.id },
  ] });
  console.log("  ✓ Created 3 opportunities");

  // ── Invoices ──
  await prisma.invoice.createMany({ data: [
    { invoiceNumber: "INV-2026-001", status: "paid", issueDate: daysAgo(25), dueDate: daysAgo(10), paidAt: daysAgo(12), subtotal: 2500, taxRate: 8.5, taxTotal: 212.50, total: 2712.50, companyId: acme.id },
    { invoiceNumber: "INV-2026-002", status: "sent", issueDate: daysAgo(5), dueDate: daysAgo(-25), subtotal: 8000, taxRate: 8.5, taxTotal: 680.00, total: 8680.00, companyId: globex.id },
    { invoiceNumber: "INV-2026-003", status: "overdue", issueDate: daysAgo(45), dueDate: daysAgo(15), subtotal: 3500, taxRate: 8.25, taxTotal: 288.75, total: 3788.75, companyId: initech.id },
    { invoiceNumber: "INV-2026-004", status: "draft", issueDate: daysAgo(2), dueDate: daysAgo(-28), subtotal: 12000, taxRate: 8.75, taxTotal: 1050.00, total: 13050.00, companyId: stark.id },
  ] });
  console.log("  ✓ Created 4 invoices");

  // ── Sample Integrations ──
  const ms365 = await prisma.integration.create({
    data: {
      kind: "microsoft365",
      name: "Contoso Microsoft 365",
      enabled: false,
      status: "disconnected",
      credentials: {
        tenantId: "contoso.onmicrosoft.com",
        clientId: "00000000-0000-0000-0000-000000000000",
      },
      settings: {
        syncUsers: true,
        syncContacts: true,
        syncLicenses: true,
        syncIntervalMinutes: 60,
      },
    },
  });

  await prisma.integration.create({
    data: {
      kind: "autotask",
      name: "AutoTask PSA Production",
      enabled: false,
      status: "disconnected",
      credentials: {
        username: "apiuser@company.com",
        integrationCode: "ABCDEF123456",
      },
      settings: {},
    },
  });

  await prisma.integration.create({
    data: {
      kind: "connectwise",
      name: "ConnectWise Manage",
      enabled: false,
      status: "disconnected",
      credentials: {
        companyId: "mycompany",
        publicKey: "xxx",
        privateKey: "xxx",
        clientId: "00000000-0000-0000-0000-000000000000",
        baseUrl: "https://api-na.myconnectwise.net",
      },
      settings: {},
    },
  });

  await prisma.integration.create({
    data: {
      kind: "quickbooks",
      name: "QuickBooks Online",
      enabled: false,
      status: "disconnected",
      credentials: {
        clientId: "QB123456",
        clientSecret: "xxx",
        realmId: "1234567890",
      },
      settings: {},
    },
  });

  // ── Sample M365 Sync Data ──
  await prisma.m365User.createMany({
    data: [
      {
        integrationId: ms365.id,
        azureObjectId: "user-001",
        userPrincipalName: "john.doe@contoso.com",
        displayName: "John Doe",
        givenName: "John",
        surname: "Doe",
        mail: "john.doe@contoso.com",
        jobTitle: "Software Engineer",
        department: "Engineering",
        accountEnabled: true,
        usageLocation: "US",
        raw: { id: "user-001" },
        lastSyncedAt: new Date(),
      },
      {
        integrationId: ms365.id,
        azureObjectId: "user-002",
        userPrincipalName: "jane.smith@contoso.com",
        displayName: "Jane Smith",
        givenName: "Jane",
        surname: "Smith",
        mail: "jane.smith@contoso.com",
        jobTitle: "Project Manager",
        department: "PMO",
        accountEnabled: true,
        usageLocation: "US",
        raw: { id: "user-002" },
        lastSyncedAt: new Date(),
      },
      {
        integrationId: ms365.id,
        azureObjectId: "user-003",
        userPrincipalName: "bob.wilson@contoso.com",
        displayName: "Bob Wilson",
        givenName: "Bob",
        surname: "Wilson",
        mail: "bob.wilson@contoso.com",
        jobTitle: "IT Administrator",
        department: "IT",
        accountEnabled: true,
        usageLocation: "US",
        raw: { id: "user-003" },
        lastSyncedAt: new Date(),
      },
    ],
  });

  await prisma.m365Subscription.createMany({
    data: [
      {
        integrationId: ms365.id,
        skuId: "sku-001",
        skuPartNumber: "O365_BUSINESS_PREMIUM",
        displayName: "Microsoft 365 Business Premium",
        enabled: 50,
        suspended: 0,
        assigned: 42,
        unit: "user",
        raw: { skuId: "sku-001" },
        lastSyncedAt: new Date(),
      },
      {
        integrationId: ms365.id,
        skuId: "sku-002",
        skuPartNumber: "O365_BUSINESS_STANDARD",
        displayName: "Microsoft 365 Business Standard",
        enabled: 25,
        suspended: 0,
        assigned: 20,
        unit: "user",
        raw: { skuId: "sku-002" },
        lastSyncedAt: new Date(),
      },
    ],
  });

  console.log("  ✓ Created 4 sample integrations with M365 sync data");

// ── DummyConnect — persistent sandbox simulator ─────────────────────
await prisma.integration.create({
  data: {
    kind: "dummy",
    name: "DummyConnect",
    enabled: true,
    status: "connected",
    credentials: {},
    settings: { simulatedKind: "microsoft365" },
  },
});
console.log("  ✓ Created DummyConnect simulator");

// ── Kumo: Asset Templates ───────────────────────────────────────────
const serverTpl = await prisma.kumoAssetTemplate.create({
  data: { name: "Server", description: "Physical or virtual server", icon: "server", color: "#3b82d6", isBuiltIn: true },
});
const wsTpl = await prisma.kumoAssetTemplate.create({
  data: { name: "Workstation", description: "Desktop or laptop", icon: "monitor", color: "#22c55e", isBuiltIn: true },
});
const netTpl = await prisma.kumoAssetTemplate.create({
  data: { name: "Network Device", description: "Switch, router, firewall, AP", icon: "router", color: "#f59e0b", isBuiltIn: true },
});
console.log("  ✓ Created 3 Kumo asset templates");

// ── Kumo: Template Fields ───────────────────────────────────────────
await prisma.kumoTemplateField.createMany({ data: [
  { templateId: serverTpl.id, key: "hostname", label: "Hostname", fieldType: "text", required: true, sortOrder: 0 },
  { templateId: serverTpl.id, key: "os", label: "Operating System", fieldType: "text", sortOrder: 1 },
  { templateId: serverTpl.id, key: "cpu", label: "CPU Cores", fieldType: "number", sortOrder: 2 },
  { templateId: serverTpl.id, key: "ram", label: "RAM (GB)", fieldType: "number", sortOrder: 3 },
  { templateId: serverTpl.id, key: "ip", label: "IP Address", fieldType: "text", sortOrder: 4 },
  { templateId: wsTpl.id, key: "hostname", label: "Hostname", fieldType: "text", required: true, sortOrder: 0 },
  { templateId: wsTpl.id, key: "os", label: "OS", fieldType: "text", sortOrder: 1 },
  { templateId: wsTpl.id, key: "serial", label: "Serial Number", fieldType: "text", sortOrder: 2 },
  { templateId: netTpl.id, key: "hostname", label: "Hostname", fieldType: "text", required: true, sortOrder: 0 },
  { templateId: netTpl.id, key: "deviceType", label: "Device Type", fieldType: "text", sortOrder: 1 },
  { templateId: netTpl.id, key: "mgmt_ip", label: "Management IP", fieldType: "text", sortOrder: 2 },
] });
console.log("  ✓ Created 11 Kumo template fields");

// ── Kumo: Flexible Assets ───────────────────────────────────────────
const kumoAsset1 = await prisma.kumoAsset.create({ data: { templateId: serverTpl.id, name: "SRV-DC-01", status: "active", companyId: acme.id, createdById: adminUser.id } });
const kumoAsset2 = await prisma.kumoAsset.create({ data: { templateId: serverTpl.id, name: "SRV-APP-02", status: "active", companyId: globex.id, createdById: tech1.id } });
const kumoAsset3 = await prisma.kumoAsset.create({ data: { templateId: wsTpl.id, name: "LAP-MGR-03", status: "active", companyId: umbrell.id, createdById: tech2.id } });
const kumoAsset4 = await prisma.kumoAsset.create({ data: { templateId: netTpl.id, name: "FW-PRIMARY", status: "active", companyId: globex.id, createdById: adminUser.id } });
const kumoAsset5 = await prisma.kumoAsset.create({ data: { templateId: wsTpl.id, name: "WS-ENG-07", status: "maintenance", companyId: stark.id, createdById: manager.id } });
console.log("  ✓ Created 5 Kumo assets");

// ── Kumo: Asset Field Values ────────────────────────────────────────
const hostField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: serverTpl.id, key: "hostname" } }))!;
const osField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: serverTpl.id, key: "os" } }))!;
const cpuField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: serverTpl.id, key: "cpu" } }))!;
const ramField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: serverTpl.id, key: "ram" } }))!;
const ipField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: serverTpl.id, key: "ip" } }))!;
const wsHostField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: wsTpl.id, key: "hostname" } }))!;
const wsOsField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: wsTpl.id, key: "os" } }))!;
const wsSerialField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: wsTpl.id, key: "serial" } }))!;
const netHostField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: netTpl.id, key: "hostname" } }))!;
const netTypeField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: netTpl.id, key: "deviceType" } }))!;
const netMgmtField = (await prisma.kumoTemplateField.findFirst({ where: { templateId: netTpl.id, key: "mgmt_ip" } }))!;

await prisma.kumoAssetFieldValue.createMany({ data: [
  { assetId: kumoAsset1.id, fieldId: hostField.id, valueText: "SRV-DC-01.acmecorp.local" },
  { assetId: kumoAsset1.id, fieldId: osField.id, valueText: "Windows Server 2022" },
  { assetId: kumoAsset1.id, fieldId: cpuField.id, valueNum: 8 },
  { assetId: kumoAsset1.id, fieldId: ramField.id, valueNum: 32 },
  { assetId: kumoAsset1.id, fieldId: ipField.id, valueText: "10.1.10.10" },
  { assetId: kumoAsset2.id, fieldId: hostField.id, valueText: "SRV-APP-02.globexind.local" },
  { assetId: kumoAsset2.id, fieldId: osField.id, valueText: "Ubuntu 24.04 LTS" },
  { assetId: kumoAsset2.id, fieldId: cpuField.id, valueNum: 16 },
  { assetId: kumoAsset2.id, fieldId: ramField.id, valueNum: 64 },
  { assetId: kumoAsset2.id, fieldId: ipField.id, valueText: "10.2.20.20" },
  { assetId: kumoAsset3.id, fieldId: wsHostField.id, valueText: "LAP-MGR-03" },
  { assetId: kumoAsset3.id, fieldId: wsOsField.id, valueText: "Windows 11 Pro" },
  { assetId: kumoAsset3.id, fieldId: wsSerialField.id, valueText: "SN-UMB-LT03-2025" },
  { assetId: kumoAsset4.id, fieldId: netHostField.id, valueText: "FW-PRIMARY" },
  { assetId: kumoAsset4.id, fieldId: netTypeField.id, valueText: "Firewall" },
  { assetId: kumoAsset4.id, fieldId: netMgmtField.id, valueText: "192.168.1.1" },
  { assetId: kumoAsset5.id, fieldId: wsHostField.id, valueText: "WS-ENG-07" },
  { assetId: kumoAsset5.id, fieldId: wsOsField.id, valueText: "Windows 11 Pro" },
  { assetId: kumoAsset5.id, fieldId: wsSerialField.id, valueText: "SN-STK-WS07-2025" },
] });
console.log("  ✓ Created Kumo asset field values");

// ── Kumo: Passwords (properly encrypted with AES-256-GCM) ──────────
const cryptoId = "550e8400-e29b-41d4-a716-446655440000";
const enc = (pw: string) => encrypt(pw);
const pwd1 = enc("AcmeDC@dmin2026!");
const pwd2 = enc("GlobexVPN#2026");
const pwd3 = enc("InitechWiFi!23");
const pwd4 = enc("Umbrella365$Admin");
const pwd5 = enc("StarkAWS!Root2026");
await prisma.kumoPassword.createMany({ data: [
  { label: "Acme Domain Admin", username: "admin@acmecorp.local", url: "https://acmecorp.com/admin", encryptedPassword: pwd1.ciphertext, encryptionKeyId: cryptoId, iv: pwd1.iv, authTag: pwd1.authTag, category: "admin", strength: "strong", companyId: acme.id, createdById: adminUser.id },
  { label: "Globex VPN Credential", username: "vpn@globexind.com", url: "https://vpn.globexind.com", encryptedPassword: pwd2.ciphertext, encryptionKeyId: cryptoId, iv: pwd2.iv, authTag: pwd2.authTag, category: "vpn", strength: "medium", companyId: globex.id, createdById: tech1.id },
  { label: "Initech Wi-Fi PSK", username: null, url: null, encryptedPassword: pwd3.ciphertext, encryptionKeyId: cryptoId, iv: pwd3.iv, authTag: pwd3.authTag, category: "wifi", strength: "weak", companyId: initech.id, createdById: tech2.id },
  { label: "Office 365 Global Admin", username: "admin@umbrellacorp.net", url: "https://admin.microsoft.com", encryptedPassword: pwd4.ciphertext, encryptionKeyId: cryptoId, iv: pwd4.iv, authTag: pwd4.authTag, category: "m365", strength: "very_strong", companyId: umbrell.id, createdById: tech2.id },
  { label: "Stark AWS Root", username: "root@starkent.com", url: "https://console.aws.amazon.com", encryptedPassword: pwd5.ciphertext, encryptionKeyId: cryptoId, iv: pwd5.iv, authTag: pwd5.authTag, category: "cloud", strength: "very_strong", companyId: stark.id, createdById: manager.id },
] });
console.log("  ✓ Created 5 Kumo passwords");

// ── Kumo: Folders ───────────────────────────────────────────────────
const folderGeneral = await prisma.kumoFolder.create({ data: { name: "General Documentation", slug: "general", description: "General-purpose documents", companyId: acme.id } });
const folderSec = await prisma.kumoFolder.create({ data: { name: "Security Policies", slug: "security-policies", description: "Security and compliance", companyId: acme.id, parentId: folderGeneral.id } });
const folderOps = await prisma.kumoFolder.create({ data: { name: "Operational Runbooks", slug: "runbooks", description: "Day-to-day operational procedures", companyId: globex.id } });
console.log("  ✓ Created 3 Kumo folders");

// ── Kumo: Documents ─────────────────────────────────────────────────
await prisma.kumoDocument.createMany({ data: [
  { folderId: folderGeneral.id, title: "Acme Network Topology Overview", slug: "acme-network-topology", currentContent: "# Network Topology\n\nAcme HQ uses a hub-and-spoke topology.", status: "published", visibility: "internal", companyId: acme.id, authorId: tech1.id, tags: ["network", "diagram"] },
  { folderId: folderSec.id, title: "Password Policy", slug: "password-policy", currentContent: "# Password Policy\n\nMinimum 12 characters, must include uppercase, lowercase, numbers, and symbols.", status: "published", visibility: "internal", companyId: acme.id, authorId: adminUser.id, tags: ["security", "policy"] },
  { folderId: folderSec.id, title: "Incident Response Plan", slug: "ir-plan", currentContent: "# Incident Response Plan\n\n1. Identify\n2. Contain\n3. Eradicate\n4. Recover\n5. Lessons Learned", status: "published", visibility: "internal", companyId: acme.id, authorId: tech2.id, tags: ["security", "ir"] },
  { folderId: folderOps.id, title: "Server Reboot Procedure", slug: "server-reboot", currentContent: "# Server Reboot Procedure\n\n1. Notify stakeholders\n2. Graceful shutdown\n3. Verify services post-boot", status: "draft", visibility: "internal", companyId: globex.id, authorId: tech1.id, tags: ["runbook", "servers"] },
] });
console.log("  ✓ Created 4 Kumo documents");

// ── Kumo: Domains ───────────────────────────────────────────────────
await prisma.kumoDomain.createMany({ data: [
  { domainName: "acmecorp.com", registrar: "GoDaddy", expiryDate: daysAgo(-180), autoRenew: true, dnsProvider: "Cloudflare", nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"], companyId: acme.id },
  { domainName: "globexind.com", registrar: "Namecheap", expiryDate: daysAgo(-90), autoRenew: true, dnsProvider: "AWS Route53", companyId: globex.id },
  { domainName: "initech.io", registrar: "Google Domains", expiryDate: daysAgo(-30), autoRenew: false, dnsProvider: "Google Cloud DNS", companyId: initech.id },
  { domainName: "starkent.com", registrar: "MarkMonitor", expiryDate: daysAgo(-365), autoRenew: true, dnsProvider: "Cloudflare", nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"], companyId: stark.id },
] });
console.log("  ✓ Created 4 Kumo domains");

// ── Kumo: Certificates ──────────────────────────────────────────────
await prisma.kumoCertificate.createMany({ data: [
  { name: "acmecorp.com Wildcard", domain: "*.acmecorp.com", issuer: "DigiCert", expiryDate: daysAgo(-120), validFrom: daysAgo(245), certificateType: "OV", autoRenew: true, companyId: acme.id },
  { name: "globexind.com", domain: "globexind.com", issuer: "Let's Encrypt", expiryDate: daysAgo(-60), validFrom: daysAgo(305), certificateType: "DV", autoRenew: true, companyId: globex.id },
  { name: "starkent.com Wildcard", domain: "*.starkent.com", issuer: "Sectigo", expiryDate: daysAgo(-250), validFrom: daysAgo(115), subjectAltNames: ["starkent.com", "*.starkent.com"], certificateType: "OV", autoRenew: true, companyId: stark.id },
] });
console.log("  ✓ Created 3 Kumo certificates");

// ── Kumo: Universal Links ───────────────────────────────────────────
const acmeAdminPwd = await prisma.kumoPassword.findFirst({ where: { label: "Acme Domain Admin" } });
const acmeDomain = await prisma.kumoDomain.findFirst({ where: { domainName: "acmecorp.com" } });
const netDoc = await prisma.kumoDocument.findFirst({ where: { slug: "acme-network-topology" } });
const globexDomain = await prisma.kumoDomain.findFirst({ where: { domainName: "globexind.com" } });
const globexCert = await prisma.kumoCertificate.findFirst({ where: { domain: "globexind.com" } });

if (acmeAdminPwd && acmeDomain && netDoc && globexDomain && globexCert) {
  await prisma.kumoLink.createMany({ data: [
    { sourceType: "password", sourceId: acmeAdminPwd.id, targetType: "domain", targetId: acmeDomain.id, relationship: "authenticates", label: "Domain Admin creds for acmecorp.com", createdById: adminUser.id },
    { sourceType: "asset", sourceId: kumoAsset1.id, targetType: "document", targetId: netDoc.id, relationship: "documented_by", label: "Network doc", createdById: tech1.id },
    { sourceType: "domain", sourceId: globexDomain.id, targetType: "certificate", targetId: globexCert.id, relationship: "secured_by", label: "TLS cert for globexind.com", createdById: tech1.id },
  ] });
  console.log("  ✓ Created 3 Kumo universal links");
}

// ── Kumo: Files ─────────────────────────────────────────────────────
await prisma.kumoFile.createMany({ data: [
  { filename: "acme-network-diagram.pdf", mimeType: "application/pdf", size: 245000, storagePath: "/files/acme/network-diagram.pdf", entityType: "client", entityId: acme.id, uploadedById: tech1.id },
  { filename: "globex-onboarding-checklist.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 18500, storagePath: "/files/globex/onboarding.xlsx", entityType: "client", entityId: globex.id, uploadedById: manager.id },
] });
console.log("  ✓ Created 2 Kumo files");

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   SEED COMPLETE                          ║");
  console.log("║   Login: admin@C7NTAX.com / admin        ║");
  console.log("╚══════════════════════════════════════════╝");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
