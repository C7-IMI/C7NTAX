import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   C7NTAX — Full Database Seed           ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // ── Clean existing data ──
  await prisma.syncedEntity.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.m365Subscription.deleteMany();
  await prisma.m365Group.deleteMany();
  await prisma.m365User.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.timeEntry.deleteMany();
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
  const adminRole = await prisma.role.create({ data: { name: "Admin", systemRole: "admin", isDefault: true, permissions: ["ticket:view","ticket:create","ticket:edit","ticket:delete","ticket:assign","ticket:close","ticket:view_all","board:view","board:manage","client:view","client:create","client:edit","client:delete","billing:view","billing:manage","invoice:create","invoice:send","user:manage","role:manage","system:config","integration:view","integration:manage","report:view","report:export"] } });
  const techRole = await prisma.role.create({ data: { name: "Technician", systemRole: "technician", permissions: ["ticket:view","ticket:create","ticket:edit","ticket:assign","ticket:close","board:view","client:view","integration:view","report:view"] } });
  const clientRole = await prisma.role.create({ data: { name: "Client Admin", systemRole: "client_admin", permissions: ["ticket:view","ticket:create","ticket:edit","board:view","client:view","billing:view"] } });
  const readOnlyRole = await prisma.role.create({ data: { name: "Read Only", systemRole: "read_only", permissions: ["ticket:view","board:view","client:view","report:view"] } });
  console.log("  ✓ Created 4 roles");

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
    { firstName: "David", lastName: "Chen", email: "david@acmecorp.com", companyId: acme.id, isPrimary: true },
    { firstName: "Emily", lastName: "Johnson", email: "emily@globexind.com", companyId: globex.id, isPrimary: true },
    { firstName: "Robert", lastName: "Miller", email: "robert@initech.io", companyId: initech.id, isPrimary: true },
    { firstName: "Alice", lastName: "Wong", email: "alice@umbrellacorp.net", companyId: umbrell.id, isPrimary: true },
    { firstName: "Tony", lastName: "Pepper", email: "tony@starkent.com", companyId: stark.id, isPrimary: true },
  ] });
  console.log("  ✓ Created 5 contacts");

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

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   SEED COMPLETE                          ║");
  console.log("║   Login: admin@C7NTAX.com / admin        ║");
  console.log("╚══════════════════════════════════════════╝");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
