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

/** Plausible value for a Kumo asset template field, matched on key then field type. */
function sampleFieldValue(key: string, fieldType: string, label: string, assetName: string, index: number, options?: unknown) {
  const option = Array.isArray(options) ? String(options[0]) : undefined;
  const host = assetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const text: Record<string, string> = {
    system: "Windows Server 2022 domain controller",
    account_type: "Service account",
    owner: "IT manager",
    domain: `${host}.local`,
    forest_level: "Windows Server 2016",
    dc_hostname: `${host}.local`,
    site: "Default-First-Site-Name",
    backup_schedule: "System state, nightly 02:00",
    vendor: "Microsoft",
    version: "2024.1",
    licence_type: "Subscription",
    support_contact: "Vendor support desk",
    product: "Veeam Backup & Replication 12.1",
    targets: "SRV-DC-01, SRV-FILE-01",
    schedule: "Nightly 22:00",
    retention: "30 days on disk, 12 months in cloud",
    platform: "Microsoft 365",
    spam_filter: "Exchange Online Protection",
    share_name: "Finance",
    path: "\\\\SRV-FILE-01\\Finance",
    permissions: "Finance group — modify · Domain Admins — full control",
    size: "420 GB",
    provider: "Telstra",
    circuit_id: "TEL-4482-01",
    bandwidth: "500/500 Mbps",
    static_ips: "203.0.113.24/29",
    switch_model: "Cisco Catalyst 9200-48P",
    vlans: "10 management · 20 data · 30 voice · 40 guest",
    management_ip: `10.20.${index % 12}.2`,
    hostname: `${host}.corp.local`,
    deviceType: "Access switch",
    mgmt_ip: `10.20.${index % 12}.2`,
    network_name: `CORP-DATA-${10 + (index % 20)}`,
    subnet: `10.20.${index % 12}.0/24`,
    gateway: `10.20.${index % 12}.1`,
    dhcp_scope: `10.20.${index % 12}.100 - 10.20.${index % 12}.200`,
    model: "HP LaserJet Enterprise M507",
    ip_address: `10.20.${index % 12}.40`,
    driver: "Universal Print Driver PCL 6",
    print_server: "SRV-PRINT-01",
    toner_model: "HP 89A",
    tool: "Remote Desktop Gateway",
    access_method: "VPN + RDP",
    users: "All staff",
    portal_url: `https://rdp.${host}.com`,
    account_owner: "IT manager",
    billing_contact: "Finance manager",
    billing_cycle: "Monthly in advance",
    payment_terms: "Net 30",
    control: "Microsoft Defender for Business",
    findings: "No critical findings. Two medium items were closed at the last review.",
    os: index % 3 === 0 ? "Windows 11 Enterprise 23H2" : "Windows Server 2022",
    ip: `10.20.${index % 12}.${20 + (index % 200)}`,
    serial: `SN-${100_000 + index * 137}`,
    peers: "Head office, Branch office",
    tunnel_subnet: "10.30.0.0/24",
    cluster: "CLUSTER-A",
    extensions: "100-140",
    did_range: "+1 555 010 0100 - 0140",
    sip_trunk: "SIP trunk — 2 channels",
    ssid: "Corp-WiFi",
    controller: "Cisco 9800-L",
    category: "Onboarding",
    frequency: "Monthly",
    notes: "Break-glass account. Use only with approval and log the change.",
    steps: "1. Confirm the change window\n2. Apply and verify\n3. Update this record",
    steps_detail: "1. Confirm the change window\n2. Apply and verify\n3. Update this record",
  };
  const numbers: Record<string, number> = {
    cpu: 16, ram: 64, ports: 48, quantity: 25, users: 28, vlan_id: 10 + (index % 20),
    mailbox_count: 65, vm_count: 12,
  };
  const booleans: Record<string, boolean> = {
    mfa_enabled: true, poe: true, hosted: index % 2 === 0, restore_tested: true, guest_network: true,
  };
  const dates: Record<string, Date> = {
    last_verified: daysAgo(4), contract_end: daysFromNow(214), renewal_date: daysFromNow(96),
    last_review: daysAgo(38), last_completed: daysAgo(9),
  };

  if (key in dates || fieldType === "date") return { valueDate: dates[key] ?? daysFromNow(120) };
  if (key in booleans || fieldType === "boolean") return { valueBool: booleans[key] ?? true };
  if (key in numbers || fieldType === "number") return { valueNum: numbers[key] ?? 1 };
  const value = text[key] ?? `${label} sample`;
  if (fieldType === "select" || fieldType === "multi_select" || fieldType === "json") return { valueJson: text[key] ?? option ?? label };
  return { valueText: text[key] ?? `${label} sample` };
}

/**
 * The records a type gets for one client, so each panel reads like a real
 * environment rather than "Server 1". Names carry the client, since a type panel
 * is already scoped to one.
 */
function typeAssetNames(typeName: string, clientName: string): string[] {
  const names: Record<string, string[]> = {
    "Account Management": [`${clientName} — domain admin account`, `${clientName} — backup service account`],
    "Active Directory": [`${clientName} DC01`, `${clientName} DC02`],
    Applications: [`${clientName} — finance package`, `${clientName} — practice management`],
    Backup: [`${clientName} — nightly backup job`, `${clientName} — Microsoft 365 backup`],
    Email: [`${clientName} — Microsoft 365 tenant`, `${clientName} — mail filtering`],
    "File Sharing": [`${clientName} — Finance share`, `${clientName} — Projects share`],
    "Internet / WAN": [`${clientName} — primary fibre circuit`, `${clientName} — 4G failover`],
    LAN: [`${clientName} — core switch`, `${clientName} — access switch`],
    Licensing: [`${clientName} — Microsoft 365 licences`, `${clientName} — endpoint protection licences`],
    "Network Device": [`${clientName} — edge firewall`, `${clientName} — core switch`],
    Networks: [`${clientName} — CORP-DATA VLAN`, `${clientName} — VOICE VLAN`],
    Printing: [`${clientName} — finance printer`, `${clientName} — reception printer`],
    "Remote Access": [`${clientName} — RD Gateway`, `${clientName} — support remote tool`],
    "Sales & Finance": [`${clientName} — managed services billing`, `${clientName} — hardware resale account`],
    Security: [`${clientName} — endpoint protection`, `${clientName} — email security`],
    Server: [`${clientName} — domain controller`, `${clientName} — file server`],
    VPN: [`${clientName} — head office tunnel`, `${clientName} — site-to-site tunnel`],
    Virtualization: [`${clientName} — production cluster`, `${clientName} — backup host`],
    "Voice / PBX": [`${clientName} — phone system`, `${clientName} — SIP trunk`],
    Wireless: [`${clientName} — corporate SSID`, `${clientName} — guest SSID`],
    Workstation: [`${clientName} — reception desktop`, `${clientName} — design laptop`],
  };
  return names[typeName] ?? [`${clientName} — ${typeName.toLowerCase()} 1`, `${clientName} — ${typeName.toLowerCase()} 2`];
}

/** How many records each asset type gets per client. */
const ASSETS_PER_TYPE = 2;

/** Types promoted out of the type list into Core Assets (they own a section). */
const promotedTypeSlugs = new Set(["checklists"]);

/**
 * The three original types also carry a legacy detail row that the
 * Configurations screen reads, so a new record of those types needs one too.
 */
async function legacyConfigRows(typeName: string, assetId: string, client: { id: string; name: string }, index: number) {
  const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const short = client.name.split(" ")[0]!.toLowerCase();
  try {
    if (typeName === "Server") {
      await prisma.kumoServer.create({
        data: {
          kumoAssetId: assetId,
          hostname: `srv-${short}-0${index + 1}`,
          fqdn: `srv-0${index + 1}.${slug}.local`,
          operatingSystem: "Windows Server 2022",
          osVersion: "21H2",
          cpuCores: 16,
          ramGb: 64,
          storageGb: 2048,
          ipAddress: `10.20.30.1${index + 1}`,
          macAddress: "00-15-5D-31-2A-11",
          virtualization: "VMware",
          lastPatchedAt: daysAgo(12),
        },
      });
    } else if (typeName === "Workstation") {
      await prisma.kumoWorkstation.create({
        data: {
          kumoAssetId: assetId,
          hostname: `WS-${short.toUpperCase()}-0${index + 14}`,
          operatingSystem: "Windows 11 Pro 23H2",
          serialNumber: `PF3XK9${index}L`.toUpperCase(),
          lastCheckInAt: daysAgo(1),
        },
      });
    } else if (typeName === "Network Device") {
      await prisma.kumoNetworkDevice.create({
        data: {
          kumoAssetId: assetId,
          deviceType: index === 0 ? "Firewall" : "Switch",
          managementIp: `10.20.30.${index + 1}`,
          macAddress: "00-15-5D-31-2A-01",
          firmwareVersion: "7.4.3",
          portCount: index === 0 ? 8 : 48,
          serialNumber: `FGT60F000000000${index + 1}`,
          rackPosition: `U${index + 1}`,
        },
      });
    }
  } catch { /* the record already has its detail row */ }
}

/** Adds only the rows whose `key` value is not in the table yet, so re-runs never duplicate. */
async function addMissing(label: string, delegateName: string, rows: Array<Record<string, unknown>>, key: string) {
  const delegate = (prisma as { [k: string]: any })[delegateName];
  const existing: Array<Record<string, unknown>> = await delegate.findMany({ select: { [key]: true } });
  const have = new Set(existing.map((row) => row[key]));
  const missing = rows.filter((row) => !have.has(row[key]));
  if (!missing.length) {
    kept(label, existing.length);
    return;
  }
  try {
    await delegate.createMany({ data: missing });
    made(label, missing.length);
  } catch (e) {
    log(`  ✗ ${label}: ${(e as Error).message}`);
  }
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

  // The global asset types and their fields — what every client gets documented.
  const assetTypeTemplates = await prisma.kumoAssetTemplate.findMany({
    where: { isActive: true, companyId: null },
    orderBy: { name: "asc" },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });

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
          // 1–5 scale, matching the schedule skills API default of 1.
          level: [1, 3, 5][index % 3]!,
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
        payload: JSON.stringify({ service: "Microsoft 365", status: "down", detectedAt: daysAgo(1).toISOString() }),
        status: "delivered",
        attempts: 1,
      },
      {
        webhookId: hook.id,
        event: hook.events[1] ?? "service_alert.resolved",
        payload: JSON.stringify({ service: "Cloudflare", status: "resolved", durationMinutes: 42 }),
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
          nameservers: ["ada.ns.cloudflare.com", "rob.ns.cloudflare.com"],
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
          subjectAltNames: [`${slug}.com`, `www.${slug}.com`, `mail.${slug}.com`],
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

    // Every asset type, documented for this client. The loop is driven by the
    // type templates, so a type added later is covered without touching this.
    const typedAssets = assetTypeTemplates.filter((t) => !promotedTypeSlugs.has(t.name.trim().toLowerCase()));
    for (const tpl of typedAssets) {
      // Rename records left by the first pass, which used "Client Type".
      await prisma.kumoAsset.updateMany({
        where: { companyId: client.id, templateId: tpl.id, name: `${client.name} ${tpl.name}` },
        data: { name: typeAssetNames(tpl.name, client.name)[0]! },
      });
      const existing = await prisma.kumoAsset.count({ where: { companyId: client.id, templateId: tpl.id } });
      if (existing >= ASSETS_PER_TYPE) continue;
      const names = typeAssetNames(tpl.name, client.name).slice(existing);
      for (const [index, name] of names.entries()) {
        const asset = await prisma.kumoAsset.create({
          data: { templateId: tpl.id, name, status: "active", companyId: client.id, createdById: primary.id, tags: ["sample"] },
        });
        const fields = tpl.fields.filter((f) => !f.isSensitive);
        if (fields.length) {
          await prisma.kumoAssetFieldValue.createMany({
            data: fields.map((f) => ({
              assetId: asset.id,
              fieldId: f.id,
              ...sampleFieldValue(f.key, f.fieldType, f.label, name, existing + index, f.options),
            })),
          });
        }
        await legacyConfigRows(tpl.name, asset.id, client, existing + index);
      }
    }
    log(`${clientTrain} ✓ ${typedAssets.length} asset type${typedAssets.length === 1 ? "" : "s"}`);

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
        { name: `${client.name} — firewall`, type: "firewall", manufacturer: "Fortinet", model: "FortiGate 60F", serialNumber: `FG60F-${slug.slice(0, 4).toUpperCase()}-01`, assetTag: `${slug.slice(0, 3).toUpperCase()}-FW-01` },
        { name: `${client.name} — conference room laptop`, type: "laptop", manufacturer: "Lenovo", model: "ThinkPad T14 Gen 4", serialNumber: `PF-${slug.slice(0, 4).toUpperCase()}-77`, assetTag: `${slug.slice(0, 3).toUpperCase()}-LT-77` },
      ].slice(0, 2 - assetCount);
      for (const [index, spec] of wanted.entries()) {
        const asset = await prisma.asset.create({
          data: {
            ...spec,
            status: "active",
            category: spec.type === "laptop" ? "Endpoint" : "Infrastructure",
            vendor: "Insight",
            purchaseDate: daysAgo(180),
            purchasePrice: spec.type === "laptop" ? 1850 : 1250,
            warrantyExpiry: daysFromNow(550),
            location: "Head office",
            companyId: client.id,
            ipAddress: spec.type === "firewall" ? "10.20.30.1" : undefined,
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

  // ── Organization notes ─────────────────────────────────────────────
  // The Kumo organization Overview card reads these; without them it shows
  // "No notes yet" for every client.
  log("\nOrganization and asset detail coverage:");

  // Assets seeded earlier used display-cased types that the asset type map and
  // filters do not recognise, so they render as raw text.
  for (const [from, to] of [["Network", "network"], ["Laptop", "laptop"], ["Server", "server"], ["Firewall", "firewall"], ["Switch", "switch"], ["Access Point", "access_point"]] as const) {
    await prisma.asset.updateMany({ where: { type: from }, data: { type: to } });
  }

  const companiesMissingNotes = await prisma.company.findMany({
    where: { OR: [{ notes: null }, { notes: "" }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (companiesMissingNotes.length) {
    const noteTemplates = [
      "Change requests go through the Friday change call — book after-hours work at least 48 hours ahead. Primary contact is the IT manager.",
      "Hybrid Microsoft 365 tenant with two on-premises domain controllers. Backups are verified monthly and the last restore test passed.",
      "Finance closes the month on the first working day. Avoid disruptive changes in the last two days of the month.",
      "Two sites joined by an IPSec tunnel over business fibre; the 4G link is failover only, so keep large transfers inside business hours.",
      "Annual security review in January. They expect MFA everywhere and a written summary of any access changes.",
    ];
    for (const [index, company] of companiesMissingNotes.entries()) {
      await prisma.company.update({ where: { id: company.id }, data: { notes: noteTemplates[index % noteTemplates.length]! } });
    }
    made("organization notes", companiesMissingNotes.length);
  } else {
    kept("organization notes", await prisma.company.count());
  }

  // ── Kumo asset field values ────────────────────────────────────────
  // Assets created without values render every template field as "—".
  const assetsMissingFieldValues = await prisma.kumoAsset.findMany({
    where: { fieldValues: { none: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, templateId: true },
  });
  if (assetsMissingFieldValues.length) {
    const templateIds = [...new Set(assetsMissingFieldValues.map((asset) => asset.templateId))];
    const fields = await prisma.kumoTemplateField.findMany({
      where: { templateId: { in: templateIds }, isSensitive: false },
      orderBy: { sortOrder: "asc" },
    });
    let rows = 0;
    for (const [index, asset] of assetsMissingFieldValues.entries()) {
      const own = fields.filter((field) => field.templateId === asset.templateId);
      if (!own.length) continue;
      await prisma.kumoAssetFieldValue.createMany({
        data: own.map((field) => ({
          assetId: asset.id,
          fieldId: field.id,
          ...sampleFieldValue(field.key, field.fieldType, field.label, asset.name, index),
        })),
      });
      rows += own.length;
    }
    made("kumo asset field values", rows);
  } else {
    kept("kumo asset field values", await prisma.kumoAssetFieldValue.count());
  }

  // ── Ticket enrichment ──────────────────────────────────────────────
  log("\nTicket activity:");
  const tickets = await prisma.ticket.findMany({
    orderBy: { createdAt: "desc" },
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
    const comments = await prisma.ticketComment.findMany({ where: { ticketId: ticket.id }, select: { id: true, body: true } });
    const timeCount = await prisma.timeEntry.count({ where: { ticketId: ticket.id } });
    if (comments.length === 0) {
      const base = daysAgo(1 + (index % 12));
      await prisma.ticketComment.createMany({
        data: [
          { ticketId: ticket.id, authorId: primary.id, body: techMessages[index % techMessages.length]!, isInternal: false, createdAt: base },
          { ticketId: ticket.id, authorId: primary.id, body: `Internal note: ${techMessages[(index + 1) % techMessages.length]!}`, isInternal: true, createdAt: new Date(base.getTime() + 3_600_000) },
          { ticketId: ticket.id, authorId: primary.id, body: customerMessages[index % customerMessages.length]!, isInternal: false, isEmail: true, fromEmail: `helpdesk@c7ntax.com`, createdAt: new Date(base.getTime() + 7_200_000) },
        ],
      });
      enrichedTickets += 1;
    }
    // The History tab filters comments shaped "Field: old → new"; generated by
    // the app on a field change, so sample tickets need some too.
    if (!comments.some((comment) => / → /.test(comment.body))) {
      await prisma.ticketComment.createMany({
        data: [
          { ticketId: ticket.id, authorId: primary.id, body: "Status: New → In Progress", isInternal: true, createdAt: daysAgo(4 + (index % 9)) },
          { ticketId: ticket.id, authorId: primary.id, body: "Priority: Medium → High", isInternal: true, createdAt: daysAgo(3 + (index % 9)) },
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
      const neighbour = tickets[index + 1]!;
      await prisma.ticketSimilarity.create({
        data: { ticketId: ticket.id, similarTicketId: neighbour.id, score: 0.78, method: "embeddings" },
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

  // Attachments — real files on disk so the download works. Added to the most
  // recent tickets that have none, so opening a ticket from the top of the list
  // shows something in the Attachments tab.
  const attachmentFiles = [
    { filename: "error-message.png", mimeType: "image/png", content: "sample image placeholder" },
    { filename: "network-scan.txt", mimeType: "text/plain", content: "Host\tPort\tState\n10.20.30.1\t443\topen\n10.20.30.11\t3389\topen\n" },
    { filename: "vendor-quote.pdf", mimeType: "application/pdf", content: "%PDF-1.4 sample quotation" },
    { filename: "backup-report.csv", mimeType: "text/csv", content: "job,status,duration\nNightly,Success,00:42:11\nWeekly,Success,01:20:03\n" },
    { filename: "firewall-config.txt", mimeType: "text/plain", content: "config system global\n    set hostname FGT60F\nend\n" },
    { filename: "onboarding-notes.md", mimeType: "text/markdown", content: "# Onboarding\n\n- MFA enforced\n- Backups verified\n" },
    { filename: "event-log-export.csv", mimeType: "text/csv", content: "time,level,source,message\n09:12,Error,Disk,Volume shadow copy failed\n" },
    { filename: "site-photo.jpg", mimeType: "image/jpeg", content: "sample photo placeholder" },
  ];
  const attachedTicketIds = new Set(
    (await prisma.ticketAttachment.findMany({ select: { ticketId: true } })).map((row) => row.ticketId),
  );
  const attachmentTargets = tickets.filter((ticket, index) => index % 4 === 0 && !attachedTicketIds.has(ticket.id));
  if (attachmentTargets.length) {
    let added = 0;
    for (const [index, ticket] of attachmentTargets.entries()) {
      const file = attachmentFiles[index % attachmentFiles.length]!;
      const storagePath = `${ticket.id}/${randomUUID()}`;
      await writeAttachmentFile(storagePath, file.content);
      await prisma.ticketAttachment.create({
        data: { ticketId: ticket.id, filename: file.filename, mimeType: file.mimeType, size: Buffer.byteLength(file.content), storagePath, uploadedById: primary.id },
      });
      added += 1;
    }
    made("ticket attachments", added);
  } else {
    kept("ticket attachments", await prisma.ticketAttachment.count());
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
      { name: "Ticket volume by client", description: "Tickets per client, rolled up by client.", type: "custom", config: { source: "tickets", columns: ["ticketNumber", "title", "status", "client"], groupBy: "client", limit: 500 } },
      { name: "Technician utilisation", description: "Billable hours, throughput and utilization per technician.", type: "utilization", config: {} },
      { name: "Agreement profitability", description: "Revenue against cost per service agreement, with margin.", type: "contract", config: {} },
    ];
    await prisma.report.createMany({ data: rows.map((row) => ({ ...row, isSystem: false, createdById: primary.id })) });
    return rows.length;
  }).then(async () => {
    const report = await prisma.report.findFirst({ select: { id: true } });
    if (report && (await prisma.reportSchedule.count()) === 0) {
      await prisma.reportSchedule.create({
        data: { reportId: report.id, frequency: "weekly", dayOfWeek: 1, timeOfDay: "07:00", recipients: ["service@example.com", "ops@example.com"], format: "pdf", isActive: true, lastSentAt: daysAgo(6) },
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

  await ensure("chat sessions", async () => (await prisma.chatSession.count()) >= 2 ? 2 : 0, async () => {
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

  await ensure("AI actions", async () => (await prisma.aiAction.count()) >= 3 ? 3 : 0, async () => {
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
  await addMissing("vendors", "vendor", [
    { name: "Ingram Micro", contactName: "Sales desk", email: "orders@example-vendor.com", phone: "+1 (800) 456-8000", paymentTerms: "Net 30", website: "https://example-vendor.com", isActive: true, notes: "Hardware and licences. Free next-day on stock items." },
    { name: "Pax8", contactName: "Cloud desk", email: "cloud@example-vendor2.com", paymentTerms: "Net 15", isActive: true, notes: "Microsoft 365 and security licensing." },
  ], "name");

  const year = new Date().getFullYear();
  /** Finds the next unused `PREFIX-year-NNNN` document number for a table. */
  const freeNumber = async (delegateName: string, field: string, prefix: string, base: number) => {
    const rows: Array<Record<string, unknown>> = await (prisma as { [k: string]: any })[delegateName].findMany({ select: { [field]: true } });
    const taken = new Set(rows.map((row) => row[field]));
    let n = base;
    while (taken.has(`${prefix}-${year}-${n}`)) n += 1;
    return `${prefix}-${year}-${n}`;
  };

  const vendor = await prisma.vendor.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (vendor && (await prisma.purchaseOrder.count()) < 2) {
    await prisma.purchaseOrder.create({
      data: {
        poNumber: await freeNumber("purchaseOrder", "poNumber", "PO", 1042),
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
      },
    });
    log("  ✓ purchase order");
  }

  const clientIds = clients.map((c) => c.id);
  if ((await prisma.quote.count()) < 3 && clientIds.length) {
    await prisma.quote.create({
      data: {
        quoteNumber: await freeNumber("quote", "quoteNumber", "QT", 2087),
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

  if (clientIds.length) {
    await addMissing("opportunities", "opportunity", [
      { name: "MFA rollout for all staff", companyId: clientIds[2 % clientIds.length]!, stage: "proposal", probability: 65, amount: 14500, currency: "USD", expectedCloseDate: daysFromNow(21), assignedToId: people[1]?.id ?? primary.id, notes: "Security review flagged this as the next step after the phishing wave." },
      { name: "Teams telephony trial", companyId: clientIds[0]!, stage: "prospect", probability: 15, amount: 7800, currency: "USD", expectedCloseDate: daysFromNow(96), assignedToId: people[2]?.id ?? primary.id, notes: "Came up on the last quarterly review — no budget confirmed yet." },
      { name: "Server hardware refresh", companyId: clientIds[0]!, stage: "qualified", probability: 35, amount: 22600, currency: "USD", expectedCloseDate: daysFromNow(74), assignedToId: primary.id, notes: "Four hosts are out of warranty in the spring." },
      { name: "Backup service upgrade", companyId: clientIds[1 % clientIds.length]!, stage: "won", probability: 100, amount: 9600, currency: "USD", expectedCloseDate: daysAgo(18), closedAt: daysAgo(16), wonReason: "Best fit on recovery time and price.", assignedToId: primary.id, notes: "Signed for three years of immutable cloud backup." },
      { name: "Legacy phone system replacement", companyId: clientIds[2 % clientIds.length]!, stage: "lost", probability: 0, amount: 31000, currency: "USD", expectedCloseDate: daysAgo(30), closedAt: daysAgo(28), lostReason: "Incumbent matched the price on hardware they already owned.", assignedToId: people[1]?.id ?? primary.id, notes: "Lost on price — revisit at renewal." },
    ], "name");

    // "qualification" is not a pipeline stage, so those deals never render on
    // the board — normalise the legacy value to "qualified".
    await prisma.opportunity.updateMany({ where: { stage: "qualification" }, data: { stage: "qualified" } });
  }

  if (clientIds.length) {
    await addMissing("contracts", "contract", [
      {
        name: "Managed services agreement",
        contractNumber: `CT-${year}-3011`,
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
    ], "name");
  }

  await addMissing("expenses", "expense", [
    { description: "Parking at the client site", amount: 18.5, category: "travel", expenseDate: daysAgo(9), companyId: clientIds[0], createdById: primary.id },
    { description: "Replacement patch leads", amount: 42.75, category: "hardware", expenseDate: daysAgo(5), companyId: clientIds[0], createdById: primary.id },
  ], "description");

  await addMissing("PTO requests", "ptoRequest", [
    { userId: people[2]?.id ?? primary.id, type: "vacation", status: "pending", startDate: daysFromNow(24), endDate: daysFromNow(28), hours: 40, reason: "Family holiday" },
    { userId: people[1]?.id ?? primary.id, type: "sick", status: "approved", startDate: daysAgo(12), endDate: daysAgo(12), hours: 8, reason: "Flu" },
  ], "reason");

  await addMissing("holidays", "holiday", [
    { name: "Thanksgiving", date: new Date(now.getFullYear(), 10, 26), recurring: true, country: "United States" },
    { name: "Christmas Day", date: new Date(now.getFullYear(), 11, 25), recurring: true, country: "United States" },
  ], "name");

  if (tickets.length) {
    await addMissing("schedule entries", "scheduleEntry", [
      { userId: people[0]!.id, title: "On-site visit — switch cutover", description: "Out-of-hours cutover window.", startTime: daysFromNow(2), endTime: new Date(daysFromNow(2).getTime() + 3 * 3_600_000), status: "scheduled", location: "Client site", travelTime: 30, ticketId: tickets[0]!.id },
      { userId: people[1]?.id ?? primary.id, title: "Remote support block", description: "Held for ticket work.", startTime: daysFromNow(1), endTime: new Date(daysFromNow(1).getTime() + 4 * 3_600_000), status: "scheduled", location: "Remote", color: "#7c3aed" },
    ], "title");
  }

  // ── Summary ───────────────────────────────────────────────────────
  log(`\nSeeding complete: ${created} record groups created, ${skipped} already populated.`);
  log("Run `npm run db:capture` so the snapshot and its delta journal include this data.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
