/**
 * Sample Coverage Seeder — fills every part of the app that would otherwise be
 * empty, so clicking anywhere shows something real to react to.
 *
 * Usage:  npx tsx src/seed-sample-coverage.ts
 *
 * Idempotent by design: each block only runs when its collection (or, for
 * client-scoped data, that client's slice of it) has nothing in it. Run it,
 * then `npm run db:capture` so the snapshot — which is what `db:reseed` and the
 * sample-data toggle restore from — includes the new records.
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isSampleDataDisabled } from "./services/sampleDataState";

const prisma = new PrismaClient();

const DAY = 86_400_000;
const now = new Date();
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const apiRoot = path.basename(process.cwd()).toLowerCase() === "api"
  ? process.cwd()
  : path.resolve(process.cwd(), "apps", "api");
const attachmentRoot = path.resolve(process.env.TICKET_ATTACHMENT_DIR || path.join(apiRoot, "data", "ticket-attachments"));

let created = 0;
let skipped = 0;
const log = (message: string) => console.log(message);
const made = (label: string, count: number) => { created += count; log(`  ✓ ${label}: ${count} created`); };
const kept = (label: string, count: number) => { skipped += 1; log(`  · ${label}: already has ${count}`); };

/** Run `seed` only when `count` reports nothing yet. */
async function ensure(label: string, count: () => Promise<number>, seed: () => Promise<number>) {
  const existing = await count();
  if (existing > 0) { kept(label, existing); return; }
  try {
    made(label, await seed());
  } catch (e) {
    log(`  ✗ ${label}: ${(e as Error).message}`);
  }
}

/** Writes a real file so sample attachment downloads work, then records it. */
async function writeAttachmentFile(storagePath: string, content: string) {
  const filePath = path.join(attachmentRoot, storagePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { flag: "wx" }).catch(() => {});
}

async function main() {
  if (isSampleDataDisabled()) {
    log("Sample data is disabled — seeding skipped (re-enable it first).");
    return;
  }

  log("Seeding sample coverage for empty areas...\n");

  const [companies, users, boards, services, templates] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true, companyType: true } }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, role: { select: { systemRole: true } } } }),
    prisma.serviceBoard.findMany({ select: { id: true, name: true } }),
    prisma.serviceAlertService.findMany({ select: { id: true, name: true, category: true } }),
    prisma.kumoAssetTemplate.findMany({ select: { id: true, name: true } }),
  ]);

  if (!companies.length || !users.length || !boards.length) {
    log("No companies/users/boards to anchor sample data to — nothing to do.");
    return;
  }

  const clients = companies.filter((c) => c.companyType === "Client" || c.companyType === "Prospect");
  const people = users.filter((u) => u.role?.systemRole !== "END_USER");
  const primary = people[0]!;
  const templateId = (name: string) => templates.find((t) => t.name.toLowerCase() === name.toLowerCase())?.id;
  const boardId = boards[0]!.id;

  // ── Money and reference data ───────────────────────────────────────
  await ensure("currencies", () => prisma.currency.count(), async () => {
    const rows = [
      { code: "USD", name: "US Dollar", symbol: "$", decimalPlaces: 2 },
      { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
      { code: "GBP", name: "Pound Sterling", symbol: "£", decimalPlaces: 2 },
      { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimalPlaces: 2 },
      { code: "AUD", name: "Australian Dollar", symbol: "A$", decimalPlaces: 2 },
    ];
    await prisma.currency.createMany({ data: rows });
    return rows.length;
  });

  await ensure("exchange rates", () => prisma.exchangeRate.count(), async () => {
    const rates = [
      { fromCurrency: "EUR", toCurrency: "USD", rate: 1.08 },
      { fromCurrency: "GBP", toCurrency: "USD", rate: 1.27 },
      { fromCurrency: "CAD", toCurrency: "USD", rate: 0.74 },
      { fromCurrency: "AUD", toCurrency: "USD", rate: 0.66 },
      { fromCurrency: "USD", toCurrency: "EUR", rate: 0.93 },
    ];
    await prisma.exchangeRate.createMany({ data: rates });
    return rates.length;
  });

  await ensure("ticket categories", () => prisma.ticketCategory.count(), async () => {
    const names = ["Hardware", "Software", "Network", "Security", "Access & Identity", "Email", "Backup", "Other"];
    await prisma.ticketCategory.createMany({ data: boards.flatMap((board) => names.map((name) => ({ name, boardId: board.id }))) });
    return boards.length * names.length;
  });

  await ensure("technician skills", () => prisma.technicianSkill.count(), async () => {
    const skills = ["Windows Server", "Microsoft 365", "Networking", "Firewalls", "Microsoft Entra ID", "Backup & Recovery", "Virtualisation"];
    await prisma.technicianSkill.createMany({
      data: people.flatMap((person, personIndex) =>
        skills.slice(personIndex % 3, (personIndex % 3) + 3).map((skill, index) => ({
          userId: person.id,
          skill,
          level: ["Beginner", "Intermediate", "Expert"][index % 3]!,
        })),
      ),
    });
    return people.length * 3;
  });

  await ensure("retention policies", () => prisma.retentionPolicy.count(), async () => {
    const policies = [
      { entity: "ticket", retentionDays: 2555, archiveAction: "archive" },
      { entity: "auditLog", retentionDays: 1095, archiveAction: "archive" },
      { entity: "chatMessage", retentionDays: 730, archiveAction: "delete" },
      { entity: "kumoPasswordAccessLog", retentionDays: 365, archiveAction: "delete" },
      { entity: "invoice", retentionDays: 3650, archiveAction: "archive" },
    ];
    await prisma.retentionPolicy.createMany({ data: policies.map((p) => ({ ...p, isActive: true })) });
    return policies.length;
  });

  await ensure("field permissions", () => prisma.fieldPermission.count(), async () => {
    const rules = [
      { entity: "Asset", field: "purchasePrice", roleName: "Technician", canRead: true, canWrite: false },
      { entity: "Invoice", field: "total", roleName: "Technician", canRead: true, canWrite: false },
      { entity: "Contact", field: "notes", roleName: "Dispatcher", canRead: true, canWrite: true },
      { entity: "Ticket", field: "customFields", roleName: "Dispatcher", canRead: true, canWrite: false },
    ];
    await prisma.fieldPermission.createMany({ data: rules });
    return rules.length;
  });

  // ── Integrations and connectors ────────────────────────────────────
  await ensure("email connectors", () => prisma.emailConnector.count(), async () => {
    const rows = boards.slice(0, 2).map((board, index) => ({
      boardId: board.id,
      host: index === 0 ? "outlook.office365.com" : "imap.gmail.com",
      port: 993,
      secure: true,
      user: index === 0 ? "servicedesk@example.com" : "support@example.com",
      passwordEncrypted: "sample-encrypted-placeholder",
      folder: "INBOX",
      transport: "imap",
      pollIntervalSec: 120,
      enabled: false,
    }));
    await prisma.emailConnector.createMany({ data: rows });
    return rows.length;
  });

  await ensure("webhook configs", () => prisma.webhookConfig.count(), async () => {
    const rows = [
      { name: "Service alert bridge", url: "https://hooks.example.com/c7ntax/alerts", secret: "sample-webhook-secret", events: ["service_alert.raised", "service_alert.resolved"], isActive: true },
      { name: "Ticket escalations", url: "https://hooks.example.com/c7ntax/tickets", secret: "sample-webhook-secret-2", events: ["ticket.created", "ticket.sla_breached"], isActive: true },
    ];
    await prisma.webhookConfig.createMany({ data: rows });
    return rows.length;
  });

  await ensure("alert webhook deliveries", () => prisma.alertWebhookDelivery.count(), async () => {
    const hooks = await prisma.webhookConfig.findMany({ select: { id: true, events: true } });
    if (!hooks.length) return 0;
    const rows = hooks.flatMap((hook, hookIndex) => [
      {
        webhookId: hook.id,
        event: hook.events[0] ?? "service_alert.raised",
        payload: { service: "Microsoft 365", status: "down", detectedAt: daysAgo(1).toISOString() },
        status: "delivered",
        attempts: 1,
      },
      {
        webhookId: hook.id,
        event: hook.events[1] ?? "service_alert.resolved",
        payload: { service: "Cloudflare", status: "resolved", durationMinutes: 42 },
        status: hookIndex === 0 ? "failed" : "delivered",
        attempts: hookIndex === 0 ? 3 : 1,
      },
    ]);
    await prisma.alertWebhookDelivery.createMany({ data: rows });
    return rows.length;
  });

  await ensure("AI provider configs", () => prisma.aiProviderConfig.count(), async () => {
    await prisma.aiProviderConfig.create({
      data: {
        name: "C7NTAX assistant",
        provider: "openai",
        isActive: true,
        isDefault: true,
        apiEndpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        maxTokens: 1024,
        temperature: 0.2,
      },
    });
    return 1;
  });

  await ensure("calendar sync configs", () => prisma.calendarSyncConfig.count(), async () => {
    const rows = people.slice(0, 2).map((person, index) => ({
      userId: person.id,
      provider: index === 0 ? "microsoft" : "google",
      accessToken: "sample-access-token",
      refreshToken: "sample-refresh-token",
      tokenExpiry: daysFromNow(45),
      calendarId: "primary",
      syncScheduleEntries: true,
      syncPto: true,
      isActive: true,
    }));
    await prisma.calendarSyncConfig.createMany({ data: rows });
    return rows.length;
  });

  await ensure("SSO config", () => prisma.ssoConfig.count(), async () => {
    await prisma.ssoConfig.create({
      data: {
        name: "Microsoft Entra ID",
        provider: "azure-ad",
        isActive: false,
        domains: ["example.com"],
        config: { tenantId: "sample-tenant", clientId: "sample-client", scopes: ["openid", "profile", "email"] },
      },
    });
    return 1;
  });

  await ensure("bulk operations", () => prisma.bulkOperation.count(), async () => {
    const rows = [
      { type: "status_change", entity: "ticket", status: "completed", totalCount: 24, successCount: 24, failureCount: 0, startedAt: daysAgo(6), completedAt: daysAgo(6) },
      { type: "assign", entity: "ticket", status: "completed", totalCount: 12, successCount: 11, failureCount: 1, errors: [{ id: "unknown", message: "Ticket already closed" }], startedAt: daysAgo(3), completedAt: daysAgo(3) },
      { type: "export", entity: "asset", status: "completed", totalCount: 5, successCount: 5, failureCount: 0, startedAt: daysAgo(1), completedAt: daysAgo(1) },
    ];
    await prisma.bulkOperation.createMany({ data: rows.map((row) => ({ ...row, createdById: primary.id })) });
    return rows.length;
  });

  // ── Per-client coverage ────────────────────────────────────────────
  log("\nPer-client coverage:");

  for (const client of clients) {
    const clientTrain = `  [${client.name}]`;

    // Domains and certificates
    const domainCount = await prisma.kumoDomain.count({ where: { companyId: client.id } });
    if (domainCount === 0) {
      const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      await prisma.kumoDomain.create({
        data: {
          domainName: `${slug}.com`,
          registrar: "GoDaddy",
          expiryDate: daysFromNow(240),
          autoRenew: true,
          dnsProvider: "Cloudflare",
          nameservers: "ada.ns.cloudflare.com, rob.ns.cloudflare.com",
          notes: "Primary domain. DNS hosted with Cloudflare.",
          companyId: client.id,
        },
      });
      log(`${clientTrain} ✓ domain`);
    }

    const certCount = await prisma.kumoCertificate.count({ where: { companyId: client.id } });
    if (certCount === 0) {
      const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      await prisma.kumoCertificate.create({
        data: {
          name: `*.${slug}.com`,
          domain: `*.${slug}.com`,
          issuer: "DigiCert",
          expiryDate: daysFromNow(75),
          validFrom: daysAgo(290),
          subjectAltNames: `${slug}.com, www.${slug}.com, mail.${slug}.com`,
          autoRenew: true,
          notes: "Wildcard certificate covering the main web and mail hosts.",
          companyId: client.id,
        },
      });
      log(`${clientTrain} ✓ certificate`);
    }

    // Contacts — every client should have a few people to pick from
    const contactCount = await prisma.contact.count({ where: { companyId: client.id } });
    if (contactCount < 2) {
      const extras = [
        { firstName: "Priya", lastName: "Raman", title: "IT Manager", department: "IT" },
        { firstName: "Daniel", lastName: "Okoro", title: "Operations Lead", department: "Operations" },
      ].slice(0, 2 - contactCount);
      const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      for (const person of extras) {
        await prisma.contact.create({
          data: {
            ...person,
            email: `${person.firstName.toLowerCase()}.${person.lastName.toLowerCase()}@${slug}.com`,
            phone: "+1 (555) 010-0100",
            mobile: "+1 (555) 010-0142",
            isPrimary: false,
            companyId: client.id,
          },
        });
      }
      log(`${clientTrain} ✓ ${extras.length} contact${extras.length === 1 ? "" : "s"}`);
    }

    // Kumo configurations: server, workstation and network device
    const seedConfig = async (templateName: string, make: (assetId: string) => Promise<void>) => {
      const template = templateId(templateName);
      if (!template) return;
      const existing = await prisma.kumoAsset.count({ where: { companyId: client.id, templateId: template } });
      if (existing > 0) return;
      const asset = await prisma.kumoAsset.create({
        data: {
          templateId: template,
          name: `${client.name} ${templateName}`,
          status: "active",
          companyId: client.id,
          createdById: primary.id,
          tags: ["sample"],
        },
      });
      await make(asset.id);
      log(`${clientTrain} ✓ ${templateName.toLowerCase()}`);
    };

    await seedConfig("Server", (assetId) =>
      prisma.kumoServer.create({
        data: {
          kumoAssetId: assetId,
          hostname: `srv-${client.name.split(" ")[0]!.toLowerCase()}-01`,
          fqdn: `srv-01.${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.local`,
          operatingSystem: "Windows Server 2022",
          osVersion: "21H2",
          cpuCores: 16,
          ramGb: 64,
          storageGb: 2048,
          ipAddress: "10.20.30.11",
          macAddress: "00-15-5D-31-2A-11",
          virtualization: "VMware",
          lastPatchedAt: daysAgo(12),
        },
      }).then(() => undefined));

    await seedConfig("Workstation", (assetId) =>
      prisma.kumoWorkstation.create({
        data: {
          kumoAssetId: assetId,
          hostname: `WS-${client.name.split(" ")[0]!.toUpperCase()}-014`,
          operatingSystem: "Windows 11 Pro 23H2",
          serialNumber: "PF3XK92L",
          lastCheckInAt: daysAgo(1),
        },
      }).then(() => undefined));

    await seedConfig("Network Device", (assetId) =>
      prisma.kumoNetworkDevice.create({
        data: {
          kumoAssetId: assetId,
          deviceType: "Firewall",
          managementIp: "10.20.30.1",
          macAddress: "00-15-5D-31-2A-01",
          firmwareVersion: "7.4.3",
          portCount: 8,
          serialNumber: "FGT60F0000000001",
          rackPosition: "U1",
        },
      }).then(() => undefined));

    // Passwords
    const passwordCount = await prisma.kumoPassword.count({ where: { companyId: client.id } });
    if (passwordCount === 0) {
      await prisma.kumoPassword.create({
        data: {
          label: `${client.name} domain administrator`,
          username: "administrator",
          url: `https://srv-01.${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.local`,
          encryptedPassword: "sample-encrypted-value",
          encryptionKeyId: "sample-key",
          iv: "sample-iv",
          authTag: "sample-tag",
          category: "Server",
          strength: "Strong",
          notes: "Break-glass account. Use only with approval.",
          companyId: client.id,
          createdById: primary.id,
          isActive: true,
        },
      });
      log(`${clientTrain} ✓ password`);
    }

    // Documents with revisions
    const docCount = await prisma.kumoDocument.count({ where: { companyId: client.id } });
    if (docCount === 0) {
      const document = await prisma.kumoDocument.create({
        data: {
          title: `${client.name} — environment overview`,
          slug: `${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-environment-overview`,
          currentContent: "<h2>Environment</h2><p>Windows Server 2022 file and print server, Microsoft 365 for mail, Cloudflare for DNS, Duo for MFA.</p><ul><li>Firewall: FortiGate 60F</li><li>Backups: nightly to cloud, 30-day retention</li></ul>",
          currentVersion: 2,
          status: "published",
          visibility: "internal",
          companyId: client.id,
          authorId: primary.id,
          lastEditorId: primary.id,
          viewCount: 24,
        },
      });
      await prisma.kumoDocumentRevision.createMany({
        data: [
          { documentId: document.id, version: 1, content: "<p>Initial notes from onboarding.</p>", authorId: primary.id, changeLog: "Initial draft" },
          { documentId: document.id, version: 2, content: document.currentContent, authorId: primary.id, changeLog: "Added backups and MFA" },
        ],
      });
      log(`${clientTrain} ✓ document + 2 revisions`);
    }

    // Assets and assignments
    const assetCount = await prisma.asset.count({ where: { companyId: client.id } });
    if (assetCount < 2) {
      const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const wanted = [
        { name: `${client.name} — firewall`, type: "Network", manufacturer: "Fortinet", model: "FortiGate 60F", serialNumber: `FG60F-${slug.slice(0, 4).toUpperCase()}-01`, assetTag: `${slug.slice(0, 3).toUpperCase()}-FW-01` },
        { name: `${client.name} — conference room laptop`, type: "Laptop", manufacturer: "Lenovo", model: "ThinkPad T14 Gen 4", serialNumber: `PF-${slug.slice(0, 4).toUpperCase()}-77`, assetTag: `${slug.slice(0, 3).toUpperCase()}-LT-77` },
      ].slice(0, 2 - assetCount);
      for (const [index, spec] of wanted.entries()) {
        const asset = await prisma.asset.create({
          data: {
            ...spec,
            status: "active",
            category: spec.type === "Laptop" ? "Endpoint" : "Infrastructure",
            vendor: "Insight",
            purchaseDate: daysAgo(180),
            purchasePrice: spec.type === "Laptop" ? 1850 : 1250,
            warrantyExpiry: daysFromNow(550),
            location: "Head office",
            companyId: client.id,
            ipAddress: spec.type === "Network" ? "10.20.30.1" : undefined,
            notes: "Recorded from the onboarding audit.",
          },
        });
        // A checkout history so the asset's assignment panel has content
        await prisma.assetAssignment.create({
          data: {
            assetId: asset.id,
            assignedToId: index === 0 ? null : people[0]!.id,
            checkedOutAt: daysAgo(60 - index * 10),
            notes: index === 0 ? "Mounted in the comms cabinet" : "Issued to the client's IT manager",
          },
        });
      }
      log(`${clientTrain} ✓ ${wanted.length} asset${wanted.length === 1 ? "" : "s"} + assignments`);
    }

    // Invoices with line items
    const invoiceCount = await prisma.invoice.count({ where: { companyId: client.id } });
    if (invoiceCount === 0) {
      const agreement = await prisma.serviceAgreement.findFirst({ where: { companyId: client.id }, select: { id: true, billingAmount: true, billingPeriod: true } });
      const subs = 2400;
      const labour = 850;
      const total = subs + labour;
      await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-${new Date().getFullYear()}-${String(1000 + clients.indexOf(client) * 7).slice(0, 4)}`,
          status: "sent",
          issueDate: daysAgo(10),
          dueDate: daysFromNow(20),
          subtotal: total,
          taxRate: 8.25,
          taxTotal: Math.round(total * 0.0825 * 100) / 100,
          total: Math.round(total * 1.0825 * 100) / 100,
          currency: "USD",
          notes: "Monthly managed services and project time.",
          companyId: client.id,
          agreementId: agreement?.id,
          nextFollowUpAt: daysFromNow(20),
          lineItems: {
            create: [
              { description: `${agreement ? "Managed services" : "Support"} — ${new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`, quantity: 1, unitPrice: subs, total: subs },
              { description: "Remote support — project work", quantity: 5, unitPrice: 170, total: labour },
              { description: "Backup storage (500 GB)", quantity: 1, unitPrice: 75, total: 75 },
            ],
          },
        },
      });
      log(`${clientTrain} ✓ invoice + 3 line items`);
    }

    // Checklists
    const checklistCount = await prisma.checklist.count({ where: { companyId: client.id } });
    if (checklistCount === 0) {
      const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const definitions = [
        {
          name: "New PC Setup List",
          description: "<p>Run before handing a laptop to a new starter.</p><ul><li>Record the asset tag</li><li>Confirm MFA enrolment</li></ul>",
          tasks: [
            { title: "Install the standard application set", done: true },
            { title: "Join to Microsoft Entra ID", done: true },
            { title: "Install the VPN client and import the profile", done: false },
            { title: "Confirm Microsoft 365 licensing in the client portal", done: false },
            { title: "Hand over to the user and record the asset tag", done: false },
          ],
        },
        {
          name: `${client.name} — monthly health check`,
          description: `<p>Monthly checks for ${client.name}. Anything failing becomes a ticket.</p>`,
          tasks: [
            { title: "Backups completed and restorable", done: true },
            { title: "Antivirus definitions up to date", done: true },
            { title: "Server disk usage below 80%", done: true },
            { title: "Patches applied and rebooted", done: false },
            { title: "Certificate expiries reviewed", done: false },
            { title: "Record findings in the client document", done: false },
          ],
        },
      ];
      for (const [index, definition] of definitions.entries()) {
        await prisma.checklist.create({
          data: {
            name: definition.name,
            description: definition.description,
            companyId: client.id,
            createdById: primary.id,
            assignedToId: people[(index + 1) % people.length]!.id,
            dueDate: daysFromNow(7 + index * 7),
            tasks: {
              create: definition.tasks.map((task, position) => ({
                title: task.title,
                position,
                assignedToId: task.done ? primary.id : people[(index + 2) % people.length]!.id,
                dueDate: daysFromNow(3 + position),
                completedAt: task.done ? daysAgo(2) : null,
                completedById: task.done ? primary.id : null,
              })),
            },
          },
        });
      }
      void slug;
      log(`${clientTrain} ✓ 2 checklists with tasks`);
    }

    // A project with phases, tasks and a dependency
    const projectCount = await prisma.project.count({ where: { companyId: client.id } });
    if (projectCount === 0) {
      const project = await prisma.project.create({
        data: {
          name: `${client.name} — network refresh`,
          description: "Replace the ageing switch stack and move the site to the new VLAN plan.",
          companyId: client.id,
          status: "active",
          priority: "high",
          startDate: daysAgo(21),
          endDate: daysFromNow(35),
          budget: 18500,
          budgetSpent: 7200,
          currency: "USD",
          managerId: people[1]?.id ?? primary.id,
        },
      });
      const discovery = await prisma.projectPhase.create({ data: { projectId: project.id, name: "Discovery", description: "Audit the existing network.", sortOrder: 0, status: "completed", startDate: daysAgo(21), endDate: daysAgo(14) } });
      const build = await prisma.projectPhase.create({ data: { projectId: project.id, name: "Build", description: "Order, rack and configure the new stack.", sortOrder: 1, status: "active", startDate: daysAgo(12), endDate: daysFromNow(14) } });
      await prisma.projectPhase.create({ data: { projectId: project.id, name: "Cutover", description: "Move the site over out of hours.", sortOrder: 2, status: "planned", startDate: daysFromNow(15), endDate: daysFromNow(35) } });
      const taskA = await prisma.projectTask.create({ data: { phaseId: discovery.id, name: "Document the switch stack and VLANs", sortOrder: 0, status: "done", estimatedHours: 6, actualHours: 5.5, assignedToId: primary.id, startDate: daysAgo(20), endDate: daysAgo(16) } });
      const taskB = await prisma.projectTask.create({ data: { phaseId: build.id, name: "Order replacement switches", sortOrder: 0, status: "done", estimatedHours: 2, actualHours: 2, assignedToId: people[1]?.id ?? primary.id, startDate: daysAgo(12), endDate: daysAgo(10) } });
      const taskC = await prisma.projectTask.create({ data: { phaseId: build.id, name: "Rack and configure the new stack", sortOrder: 1, status: "in_progress", estimatedHours: 12, actualHours: 4, assignedToId: primary.id, startDate: daysAgo(4), endDate: daysFromNow(6) } });
      const taskD = await prisma.projectTask.create({ data: { phaseId: build.id, name: "Validate the new VLAN plan", sortOrder: 2, status: "todo", estimatedHours: 8, assignedToId: people[2]?.id ?? primary.id, startDate: daysFromNow(1), endDate: daysFromNow(10) } });
      await prisma.projectTaskDependency.createMany({
        data: [
          { taskId: taskB.id, dependsOnId: taskA.id },
          { taskId: taskC.id, dependsOnId: taskB.id },
          { taskId: taskD.id, dependsOnId: taskC.id },
        ],
      });
      log(`${clientTrain} ✓ project with 3 phases, 4 tasks, 3 dependencies`);
    }
  }

  // ── Ticket enrichment ──────────────────────────────────────────────
  log("\nTicket activity:");
  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { id: true, companyId: true, contactId: true, ticketNumber: true, title: true, assignedToId: true, boardId: true },
  });
  const customerMessages = [
    "Thanks — one of our people hit this again this morning. Same error message as before.",
    "Any update on this? It is starting to affect the accounts team.",
    "Confirmed the change worked. Everything is behaving now, thank you.",
  ];
  const techMessages = [
    "Picked this up and reproduced it on the test tenant. Investigating the policy that applies to the affected users.",
    "Root cause found: an outdated conditional access policy was still scoped to the old group. Applying the fix now.",
    "Fix deployed and verified on two machines. Monitoring for the rest of the day before closing.",
  ];
  let enrichedTickets = 0;
  for (const [index, ticket] of tickets.entries()) {
    const commentCount = await prisma.ticketComment.count({ where: { ticketId: ticket.id } });
    const timeCount = await prisma.timeEntry.count({ where: { ticketId: ticket.id } });
    if (commentCount === 0) {
      await prisma.ticketComment.createMany({
        data: [
          { ticketId: ticket.id, authorId: ticket.contactId ? primary.id : primary.id, body: techMessages[index % techMessages.length]!, isInternal: false },
          { ticketId: ticket.id, authorId: primary.id, body: `Internal note: ${techMessages[(index + 1) % techMessages.length]!}`, isInternal: true },
          { ticketId: ticket.id, authorId: primary.id, body: customerMessages[index % customerMessages.length]!, isInternal: false },
        ],
      });
      enrichedTickets += 1;
    }
    if (timeCount === 0) {
      await prisma.timeEntry.createMany({
        data: [
          { ticketId: ticket.id, userId: ticket.assignedToId ?? people[0]!.id, minutes: 45, billable: true, noCharge: false, rate: 170, date: daysAgo(index % 9 + 1), description: "Investigating the reported issue", workType: "Remote", workRole: "Engineer" },
          { ticketId: ticket.id, userId: people[1]?.id ?? primary.id, minutes: 30, billable: true, noCharge: false, rate: 170, date: daysAgo(index % 5 + 1), description: "Remote session with the user", workType: "Remote", workRole: "Technician" },
        ],
      });
      enrichedTickets += 1;
    }
    // A nearby ticket and a CC contact, so the similarity panel and the new
    // contacts card have something real to show.
    const similar = await prisma.ticketSimilarity.count({ where: { ticketId: ticket.id } });
    if (similar === 0 && tickets[index + 1]) {
      await prisma.ticketSimilarity.create({
        data: { ticketId: ticket.id, similarTicketId: tickets[index + 1].id, score: 0.78, method: "embeddings" },
      });
    }
    if (ticket.contactId) {
      const others = await prisma.contact.findMany({ where: { companyId: ticket.companyId, id: { not: ticket.contactId } }, take: 2, select: { id: true } });
      for (const [position, other] of others.entries()) {
        await prisma.ticketContact.upsert({
          where: { ticketId_contactId: { ticketId: ticket.id, contactId: other.id } },
          create: { ticketId: ticket.id, contactId: other.id, role: position === 0 ? "cc" : "additional", notifyOnNote: true },
          update: {},
        });
      }
    }
  }
  if (enrichedTickets) made("tickets given notes and time", enrichedTickets);

  // Attachments — real files on disk so the download works
  const attachmentCount = await prisma.ticketAttachment.count();
  if (attachmentCount < 6) {
    const files = [
      { filename: "error-message.png", mimeType: "image/png", content: "sample image placeholder" },
      { filename: "network-scan.txt", mimeType: "text/plain", content: "Host\tPort\tState\n10.20.30.1\t443\topen\n10.20.30.11\t3389\topen\n" },
      { filename: "vendor-quote.pdf", mimeType: "application/pdf", content: "%PDF-1.4 sample quotation" },
      { filename: "backup-report.csv", mimeType: "text/csv", content: "job,status,duration\nNightly,Success,00:42:11\nWeekly,Success,01:20:03\n" },
      { filename: "firewall-config.txt", mimeType: "text/plain", content: "config system global\n    set hostname FGT60F\nend\n" },
      { filename: "onboarding-notes.md", mimeType: "text/markdown", content: "# Onboarding\n\n- MFA enforced\n- Backups verified\n" },
    ];
    let added = 0;
    for (const [index, file] of files.entries()) {
      const ticket = tickets[index % tickets.length]!;
      const storagePath = `${ticket.id}/${randomUUID()}`;
      await writeAttachmentFile(storagePath, file.content);
      await prisma.ticketAttachment.create({
        data: { ticketId: ticket.id, filename: file.filename, mimeType: file.mimeType, size: Buffer.byteLength(file.content), storagePath, uploadedById: primary.id },
      });
      added += 1;
    }
    made("ticket attachments", added);
  }

  // ── Knowledge base ─────────────────────────────────────────────────
  log("\nKnowledge base:");
  const kbCategory = await prisma.kBCategory.findFirst({ select: { id: true } });
  const articles = [
    {
      title: "Connect to the VPN from a Windows laptop",
      excerpt: "The steps a user follows to get onto the VPN, including the profile import.",
      tags: ["vpn", "remote", "how-to"],
      content: "<h2>Before you start</h2><p>You will need your company email address and the phone you use for MFA.</p><ol><li>Open the Cisco AnyConnect client.</li><li>Enter <strong>vpn.example.com</strong> and select Connect.</li><li>Approve the Duo prompt on your phone.</li></ol><p>If the profile is missing, re-import the XML file from the IT portal.</p>",
    },
    {
      title: "Microsoft 365: add a shared mailbox to Outlook",
      excerpt: "How to attach a shared mailbox so the team can send from it.",
      tags: ["microsoft-365", "outlook", "email"],
      content: "<h2>Add the mailbox</h2><p>In Outlook on the web, right-click your name and choose Add shared folder. Enter the mailbox address and select Add.</p><p>To send as the mailbox, use the From dropdown when composing.</p>",
    },
    {
      title: "Restore a file from last night's backup",
      excerpt: "Self-service restore requests, and when to raise a ticket instead.",
      tags: ["backup", "restore", "process"],
      content: "<h2>What you can do yourself</h2><p>Files deleted in the last 30 days can be restored from the recycle bin in your file browser.</p><h2>When to ask us</h2><p>Anything older, or a whole folder that has gone missing — raise a ticket and we will restore it from the nightly backup.</p>",
    },
    {
      title: "What to do when you get a suspicious email",
      excerpt: "Reporting phishing, and what happens next.",
      tags: ["phishing", "security", "process"],
      content: "<h2>Do not click</h2><p>Do not open attachments or follow links. Report the message using the Report Phishing button.</p><p>Our team reviews every report and will get back to you if action is needed on your account.</p>",
    },
  ];
  for (const article of articles) {
    const exists = await prisma.knowledgeBaseArticle.findFirst({ where: { title: article.title }, select: { id: true } });
    if (exists) continue;
    const document = await prisma.knowledgeBaseArticle.create({
      data: {
        title: article.title,
        slug: article.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        content: article.content,
        excerpt: article.excerpt,
        status: "published",
        visibility: "internal",
        categoryId: kbCategory?.id,
        authorId: primary.id,
        viewCount: 40 + articles.indexOf(article) * 17,
        helpfulCount: 12 + articles.indexOf(article),
        notHelpfulCount: articles.indexOf(article) % 2,
        tags: article.tags,
      },
    });
    await prisma.kBArticleVersion.createMany({
      data: [
        { articleId: document.id, version: 1, content: "<p>Initial draft.</p>", authorId: primary.id, changeNote: "Created" },
        { articleId: document.id, version: 2, content: article.content, authorId: primary.id, changeNote: "Added screenshots and the escalation path" },
      ],
    });
    const storagePath = `${document.id}/${randomUUID()}`;
    await writeAttachmentFile(storagePath, "sample article attachment");
    await prisma.kBArticleAttachment.create({
      data: { articleId: document.id, filename: "screenshot.png", mimeType: "image/png", size: 24, storagePath, uploadedById: primary.id },
    });
    const linkable = tickets[articles.indexOf(article) % tickets.length];
    if (linkable) {
      await prisma.kBArticleTicket.create({ data: { articleId: document.id, ticketId: linkable.id, linkedById: primary.id } });
    }
    log(`  ✓ article: ${article.title}`);
  }

  // ── Reporting, workflows, chat and AI surfaces ─────────────────────
  log("\nReporting and other surfaces:");
  await ensure("reports", () => prisma.report.count(), async () => {
    const rows = [
      { name: "Ticket volume by client", description: "Tickets opened per client per week, with SLA breach counts.", type: "tickets", config: { groupBy: "company", period: "week" } },
      { name: "Technician utilisation", description: "Billable hours against available hours per technician.", type: "time", config: { groupBy: "user", period: "month" } },
      { name: "Recurring revenue by agreement", description: "Monthly recurring value per service agreement.", type: "billing", config: { groupBy: "agreement", period: "month" } },
    ];
    await prisma.report.createMany({ data: rows.map((row) => ({ ...row, isSystem: false, createdById: primary.id })) });
    return rows.length;
  }).then(async () => {
    const report = await prisma.report.findFirst({ select: { id: true } });
    if (report && (await prisma.reportSchedule.count()) === 0) {
      await prisma.reportSchedule.create({
        data: { reportId: report.id, frequency: "weekly", dayOfWeek: 1, timeOfDay: "07:00", recipients: "service@example.com", format: "pdf", isActive: true, lastSentAt: daysAgo(6) },
      });
      log("  ✓ report schedule");
    }
  });

  await ensure("workflow rules", () => prisma.workflowRule.count(), async () => {
    const rows = [
      { name: "Escalate critical tickets", description: "Notify the on-call engineer when a critical ticket is raised.", entity: "ticket", trigger: "on_create", conditions: { priority: "critical" }, isActive: true, priority: 1 },
      { name: "Nudge waiting tickets", description: "Follow up when a ticket has been waiting on the client for three days.", entity: "ticket", trigger: "on_schedule", conditions: { status: "waiting_on_client", daysWaiting: 3 }, isActive: true, priority: 2 },
      { name: "Chase expiring warranties", description: "Raise a task when an asset warranty expires within 30 days.", entity: "asset", trigger: "on_schedule", conditions: { warrantyExpiryDays: 30 }, isActive: false, priority: 3 },
    ];
    await prisma.workflowRule.createMany({ data: rows });
    return rows.length;
  });

  await ensure("chat sessions", () => prisma.chatSession.count() >= 2 ? Promise.resolve(2) : Promise.resolve(0), async () => {
    const client = clients[0]!;
    const session = await prisma.chatSession.create({
      data: { status: "closed", companyId: client.id, guestName: "Marcus Bell", guestEmail: `marcus.bell@${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`, assignedToId: primary.id, startedAt: daysAgo(2), closedAt: daysAgo(2) },
    });
    await prisma.chatMessage.createMany({
      data: [
        { sessionId: session.id, senderType: "guest", content: "Hi — our finance printer has gone offline again.", contentType: "text", isRead: true },
        { sessionId: session.id, senderType: "agent", senderId: primary.id, content: "Thanks for flagging it, I can see the printer dropping off the network. I've raised a ticket and I'm looking now.", contentType: "text", isRead: true },
        { sessionId: session.id, senderType: "guest", content: "Perfect, thank you.", contentType: "text", isRead: true },
      ],
    });
    return 1;
  });

  await ensure("detected patterns", () => prisma.detectedPattern.count(), async () => {
    const rows = [
      { name: "Repeated VPN disconnects", category: "network", entityType: "ticket", description: "Six tickets in the last fortnight mention the VPN dropping for the same client.", severity: "high", entityIds: tickets.slice(0, 3).map((t) => t.id), metrics: { tickets: 6, windowDays: 14 }, status: "open" },
      { name: "Phishing wave targeting finance", category: "security", entityType: "ticket", description: "Invoice-themed phishing reported by three clients in two days.", severity: "critical", entityIds: tickets.slice(3, 6).map((t) => t.id), metrics: { tickets: 3, windowDays: 2 }, status: "open" },
      { name: "Backup job overruns", category: "backup", entityType: "asset", description: "Nightly jobs on two servers are now finishing after the business day starts.", severity: "medium", metrics: { assets: 2, averageOverrunMinutes: 48 }, status: "acknowledged" },
    ];
    await prisma.detectedPattern.createMany({ data: rows });
    return rows.length;
  });

  await ensure("AI actions", () => prisma.aiAction.count() >= 3 ? Promise.resolve(3) : Promise.resolve(0), async () => {
    const rows = [
      { entityType: "ticket", title: "Close as resolved", summary: "The user confirmed the fix. Suggest closing and asking for a review.", riskTier: "low", status: "suggested" },
      { entityType: "ticket", title: "Escalate to the network team", summary: "Three related outages this week point at the switch stack.", riskTier: "medium", status: "suggested" },
      { entityType: "invoice", title: "Chase overdue invoice", summary: "Invoice is 12 days past due and the client usually pays on time.", riskTier: "medium", status: "approved" },
    ];
    for (const row of rows) {
      await prisma.aiAction.create({ data: { ...row, entityId: tickets[Math.floor(Math.random() * tickets.length)]?.id, requestedById: primary.id } });
    }
    return rows.length;
  });

  await ensure("inference cache", () => prisma.inferenceCache.count(), async () => {
    const provider = await prisma.aiProviderConfig.findFirst({ select: { id: true } });
    if (!provider) return 0;
    const rows = tickets.slice(0, 5).map((ticket, index) => ({
      ticketId: ticket.id,
      providerId: provider.id,
      requestType: ["summary", "suggested_reply", "classification"][index % 3]!,
      requestHash: `sample-hash-${index}`,
      response: { text: "Sample cached response used to populate the AI panel." },
      tokensUsed: 320 + index * 40,
      costEstimate: 0.0007 * (index + 1),
      latencyMs: 780 + index * 65,
      hitCount: index,
      expiresAt: daysFromNow(20),
    }));
    await prisma.inferenceCache.createMany({ data: rows });
    return rows.length;
  });

  // ── Sales, procurement and scheduling extras ───────────────────────
  log("\nSales, procurement and scheduling:");
  await ensure("vendors", () => prisma.vendor.count() >= 3 ? Promise.resolve(3) : Promise.resolve(0), async () => {
    const rows = [
      { name: "Ingram Micro", contactName: "Sales desk", email: "orders@example-vendor.com", phone: "+1 (800) 456-8000", paymentTerms: "Net 30", website: "https://example-vendor.com", isActive: true, notes: "Hardware and licences. Free next-day on stock items." },
      { name: "Pax8", contactName: "Cloud desk", email: "cloud@example-vendor2.com", paymentTerms: "Net 15", isActive: true, notes: "Microsoft 365 and security licensing." },
    ];
    await prisma.vendor.createMany({ data: rows });
    return rows.length;
  });

  const vendor = await prisma.vendor.findFirst({ select: { id: true } });
  if (vendor && (await prisma.purchaseOrder.count()) < 2) {
    await prisma.purchaseOrder.create({
      data: {
        poNumber: `PO-${new Date().getFullYear()}-1042`,
        vendorId: vendor.id,
        status: "received",
        subtotal: 3200,
        taxTotal: 264,
        total: 3464,
        currency: "USD",
        orderedAt: daysAgo(24),
        expectedAt: daysAgo(18),
        receivedAt: daysAgo(17),
        approvedById: primary.id,
        createdById: primary.id,
        notes: "Replacement switches for the network refresh project.",
        lineItems: { create: [{ description: "24-port managed switch", quantity: 2, unitCost: 1600 }] },
      },
    });
    log("  ✓ purchase order + line item");
  }

  const clientIds = clients.map((c) => c.id);
  if ((await prisma.quote.count()) < 3 && clientIds.length) {
    await prisma.quote.create({
      data: {
        quoteNumber: `QT-${new Date().getFullYear()}-2087`,
        companyId: clientIds[1 % clientIds.length]!,
        title: "Endpoint protection renewal",
        status: "sent",
        subtotal: 4800,
        taxRate: 8.25,
        taxTotal: 396,
        total: 5196,
        notes: "Valid for 30 days.",
        createdById: primary.id,
        lineItems: { create: [
          { description: "Endpoint protection — 60 seats, annual", quantity: 60, unitPrice: 72, total: 4320 },
          { description: "Onboarding and policy tuning", quantity: 1, unitPrice: 480, total: 480 },
        ] },
      },
    });
    log("  ✓ quote + 2 line items");
  }

  if ((await prisma.opportunity.count()) < 4 && clientIds.length) {
    await prisma.opportunity.create({
      data: {
        name: "MFA rollout for all staff",
        companyId: clientIds[2 % clientIds.length]!,
        stage: "proposal",
        probability: 65,
        amount: 14500,
        currency: "USD",
        expectedCloseDate: daysFromNow(21),
        assignedToId: people[1]?.id ?? primary.id,
        notes: "Security review flagged this as the next step after the phishing wave.",
      },
    });
    log("  ✓ opportunity");
  }

  if ((await prisma.contract.count()) < 2 && clientIds.length) {
    await prisma.contract.create({
      data: {
        name: "Managed services agreement",
        contractNumber: `CT-${new Date().getFullYear()}-3011`,
        companyId: clientIds[3 % clientIds.length]!,
        type: "managed_services",
        status: "active",
        startDate: daysAgo(200),
        endDate: daysFromNow(165),
        renewalDate: daysFromNow(135),
        autoRenew: true,
        value: 28800,
        currency: "USD",
        billingPeriod: "monthly",
        notes: "Includes unlimited remote support during business hours.",
      },
    });
    log("  ✓ contract");
  }

  if ((await prisma.expense.count()) < 4) {
    const rows = [
      { description: "Parking at the client site", amount: 18.5, category: "travel", expenseDate: daysAgo(9) },
      { description: "Replacement patch leads", amount: 42.75, category: "hardware", expenseDate: daysAgo(5) },
    ];
    await prisma.expense.createMany({ data: rows.map((row) => ({ ...row, companyId: clientIds[0], createdById: primary.id })) });
    log("  ✓ expenses");
  }

  if ((await prisma.ptoRequest.count()) < 4) {
    await prisma.ptoRequest.create({
      data: { userId: people[2]?.id ?? primary.id, type: "vacation", status: "pending", startDate: daysFromNow(24), endDate: daysFromNow(28), hours: 40, reason: "Family holiday" },
    });
    log("  ✓ PTO request");
  }

  if ((await prisma.holiday.count()) < 4) {
    await prisma.holiday.createMany({
      data: [
        { name: "Thanksgiving", date: new Date(now.getFullYear(), 10, 26), recurring: true, country: "United States" },
        { name: "Christmas Day", date: new Date(now.getFullYear(), 11, 25), recurring: true, country: "United States" },
      ],
    });
    log("  ✓ holidays");
  }

  if ((await prisma.scheduleEntry.count()) < 5 && tickets.length) {
    await prisma.scheduleEntry.createMany({
      data: [
        { userId: people[0]!.id, title: "On-site visit — switch cutover", description: "Out-of-hours cutover window.", startTime: daysFromNow(2), endTime: new Date(daysFromNow(2).getTime() + 3 * 3_600_000), status: "scheduled", location: "Client site", travelTime: 30, ticketId: tickets[0]!.id },
        { userId: people[1]?.id ?? primary.id, title: "Remote support block", description: "Held for ticket work.", startTime: daysFromNow(1), endTime: new Date(daysFromNow(1).getTime() + 4 * 3_600_000), status: "scheduled", location: "Remote", color: "#7c3aed" },
      ],
    });
    log("  ✓ schedule entries");
  }

  // ── Summary ───────────────────────────────────────────────────────
  log(`\nSeeding complete: ${created} record groups created, ${skipped} already populated.`);
  log("Run `npm run db:capture` so the snapshot and its delta journal include this data.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
