/**
 * Kumo Asset Types (flexible types) — opt-in seed and reversal.
 *
 *   pnpm --filter api db:types-on      create/refresh the standard type set
 *   pnpm --filter api db:types-off     remove or deactivate the standard types
 *
 * Add `-- --dry-run` to either command to print the plan without writing.
 *
 * The standard set mirrors the asset types an MSP documents in IT Glue
 * (Backup, Email, VPN, …) as Kumo asset templates — no new tables, and the
 * organization screen's type rail renders whatever templates are active.
 *
 * Reversal contract:
 *   · Only templates named in STANDARD_TYPES are ever touched. Anything a user
 *     created or renamed is left alone.
 *   · `off` deletes a seeded type outright when nothing uses it, and otherwise
 *     deactivates it so the assets it holds stay intact and readable.
 *   · `off` keeps the field definitions of a deactivated type, so `on` (or
 *     reactivating it in the UI) restores the type exactly as it was.
 *   · Because matching is by name, renaming a seeded type takes it out of this
 *     script's control — use the template admin UI for those.
 *
 * Note: the snapshot poller excludes kumoAssetTemplate/kumoTemplateField/
 * kumoAsset, so the seeded types are not overwritten by routine snapshots.
 * `db:reseed` (seed-from-snapshots) *would* overwrite them.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type FieldSpec = {
  key: string;
  label: string;
  fieldType?: "text" | "number" | "boolean" | "date" | "select" | "multi_select";
  options?: string[];
  placeholder?: string;
  helpText?: string;
};

type TypeSpec = {
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: FieldSpec[];
};

/** The 19 standard types. Icons are lucide names resolved by lib/kumoIcons.ts. */
export const STANDARD_TYPES: TypeSpec[] = [
  {
    name: "Networks", description: "Network topology, addressing and VLANs", icon: "Network", color: "#3b82d6",
    fields: [
      { key: "network_name", label: "Network name", placeholder: "Corp LAN" },
      { key: "subnet", label: "Subnet / CIDR", placeholder: "10.0.0.0/24" },
      { key: "gateway", label: "Gateway" },
      { key: "vlan_id", label: "VLAN ID", fieldType: "number" },
      { key: "dhcp_scope", label: "DHCP scope" },
    ],
  },
  {
    name: "Account Management", description: "Administrative and service accounts", icon: "UserCog", color: "#8b5cf6",
    fields: [
      { key: "system", label: "System", placeholder: "Microsoft 365" },
      { key: "account_type", label: "Account type", fieldType: "select", options: ["Admin", "Standard", "Service", "Shared"] },
      { key: "mfa_enabled", label: "MFA enabled", fieldType: "boolean" },
      { key: "owner", label: "Owner" },
      { key: "notes", label: "Notes", fieldType: "text" },
    ],
  },
  {
    name: "Active Directory", description: "Forests, domains, domain controllers and OUs", icon: "FolderTree", color: "#0ea5e9",
    fields: [
      { key: "domain", label: "Domain", placeholder: "corp.example.com" },
      { key: "forest_level", label: "Functional level" },
      { key: "dc_hostname", label: "Domain controller" },
      { key: "site", label: "AD site" },
      { key: "backup_schedule", label: "Backup schedule", helpText: "System state or full server backup" },
    ],
  },
  {
    name: "Applications", description: "Line-of-business applications", icon: "AppWindow", color: "#ec4899",
    fields: [
      { key: "vendor", label: "Vendor" },
      { key: "version", label: "Version" },
      { key: "licence_type", label: "Licence type", fieldType: "select", options: ["Per user", "Per device", "Subscription", "Perpetual", "Open source"] },
      { key: "users", label: "User count", fieldType: "number" },
      { key: "hosted", label: "Hosted / SaaS", fieldType: "boolean" },
      { key: "support_contact", label: "Support contact" },
    ],
  },
  {
    name: "Backup", description: "Backup jobs, retention and restore testing", icon: "DatabaseBackup", color: "#22c55e",
    fields: [
      { key: "product", label: "Product", placeholder: "Veeam" },
      { key: "targets", label: "Protected targets" },
      { key: "schedule", label: "Schedule", placeholder: "Daily 22:00" },
      { key: "retention", label: "Retention", placeholder: "30 days" },
      { key: "last_verified", label: "Last verified", fieldType: "date" },
      { key: "restore_tested", label: "Restore tested", fieldType: "boolean" },
    ],
  },
  {
    name: "Checklists", description: "Repeatable procedures and their last run", icon: "ClipboardList", color: "#f59e0b",
    fields: [
      { key: "category", label: "Category", fieldType: "select", options: ["Onboarding", "Offboarding", "Maintenance", "Security", "Audit", "Other"] },
      { key: "frequency", label: "Frequency", fieldType: "select", options: ["One-off", "Weekly", "Monthly", "Quarterly", "Annually"] },
      { key: "last_completed", label: "Last completed", fieldType: "date" },
      { key: "owner", label: "Owner" },
      { key: "steps", label: "Steps", fieldType: "text" },
    ],
  },
  {
    name: "Email", description: "Mail platforms, domains and filtering", icon: "Mail", color: "#14b8a6",
    fields: [
      { key: "platform", label: "Platform", fieldType: "select", options: ["Microsoft 365", "Google Workspace", "On-prem Exchange", "Other"] },
      { key: "domain", label: "Mail domain" },
      { key: "mailbox_count", label: "Mailboxes", fieldType: "number" },
      { key: "retention", label: "Retention" },
      { key: "spam_filter", label: "Spam filter" },
    ],
  },
  {
    name: "File Sharing", description: "File servers and collaboration platforms", icon: "FolderOpen", color: "#eab308",
    fields: [
      { key: "platform", label: "Platform", fieldType: "select", options: ["SharePoint", "OneDrive", "Google Drive", "Windows file server", "NAS", "Other"] },
      { key: "share_name", label: "Share name" },
      { key: "path", label: "Path or URL" },
      { key: "permissions", label: "Permissions" },
      { key: "size", label: "Size" },
    ],
  },
  {
    name: "Internet / WAN", description: "WAN circuits, providers and static addressing", icon: "Globe", color: "#06b6d4",
    fields: [
      { key: "provider", label: "Provider" },
      { key: "circuit_id", label: "Circuit ID" },
      { key: "bandwidth", label: "Bandwidth", placeholder: "500/500 Mbps" },
      { key: "static_ips", label: "Static IPs" },
      { key: "contract_end", label: "Contract end", fieldType: "date" },
    ],
  },
  {
    name: "LAN", description: "Switching, internal addressing and PoE", icon: "Cable", color: "#6366f1",
    fields: [
      { key: "switch_model", label: "Switch model" },
      { key: "ports", label: "Ports", fieldType: "number" },
      { key: "vlans", label: "VLANs" },
      { key: "poe", label: "PoE", fieldType: "boolean" },
      { key: "management_ip", label: "Management IP" },
    ],
  },
  {
    name: "Licensing", description: "Software licences, quantities and renewals", icon: "KeyRound", color: "#a855f7",
    fields: [
      { key: "product", label: "Product" },
      { key: "licence_type", label: "Licence type" },
      { key: "quantity", label: "Quantity", fieldType: "number" },
      { key: "renewal_date", label: "Renewal date", fieldType: "date" },
      { key: "vendor", label: "Vendor" },
    ],
  },
  {
    name: "Printing", description: "Printers, print servers and consumables", icon: "Printer", color: "#f97316",
    fields: [
      { key: "model", label: "Model" },
      { key: "ip_address", label: "IP address" },
      { key: "driver", label: "Driver" },
      { key: "print_server", label: "Print server" },
      { key: "toner_model", label: "Toner / consumable" },
    ],
  },
  {
    name: "Remote Access", description: "Remote access tools and their entry points", icon: "MonitorSmartphone", color: "#0891b2",
    fields: [
      { key: "tool", label: "Tool", placeholder: "ScreenConnect" },
      { key: "access_method", label: "Access method", fieldType: "select", options: ["Agent", "RDP gateway", "VPN", "Web portal", "Other"] },
      { key: "users", label: "Users" },
      { key: "mfa_enabled", label: "MFA enabled", fieldType: "boolean" },
      { key: "portal_url", label: "Portal URL" },
    ],
  },
  {
    name: "Sales & Finance", description: "Commercial and billing arrangements", icon: "Calculator", color: "#84cc16",
    fields: [
      { key: "account_owner", label: "Account owner" },
      { key: "billing_contact", label: "Billing contact" },
      { key: "billing_cycle", label: "Billing cycle", fieldType: "select", options: ["Monthly", "Quarterly", "Annually", "Per incident"] },
      { key: "payment_terms", label: "Payment terms" },
    ],
  },
  {
    name: "Security", description: "Security controls, providers and reviews", icon: "ShieldCheck", color: "#ef4444",
    fields: [
      { key: "control", label: "Control", placeholder: "Endpoint protection" },
      { key: "provider", label: "Provider" },
      { key: "last_review", label: "Last review", fieldType: "date" },
      { key: "findings", label: "Open findings", fieldType: "text" },
      { key: "owner", label: "Owner" },
    ],
  },
  {
    name: "Virtualization", description: "Hypervisors, clusters and guests", icon: "Layers", color: "#7c3aed",
    fields: [
      { key: "platform", label: "Platform", fieldType: "select", options: ["VMware", "Hyper-V", "Proxmox", "Xen", "KVM", "Other"] },
      { key: "host", label: "Host" },
      { key: "cluster", label: "Cluster" },
      { key: "version", label: "Version" },
      { key: "vm_count", label: "Guest count", fieldType: "number" },
    ],
  },
  {
    name: "Voice / PBX", description: "Telephony platforms, trunks and numbering", icon: "PhoneCall", color: "#d946ef",
    fields: [
      { key: "platform", label: "Platform", fieldType: "select", options: ["Teams Phone", "RingCentral", "3CX", "Cisco", "On-prem PBX", "Other"] },
      { key: "provider", label: "Provider" },
      { key: "extensions", label: "Extensions" },
      { key: "did_range", label: "DID range" },
      { key: "sip_trunk", label: "SIP trunk" },
    ],
  },
  {
    name: "VPN", description: "VPN tunnels, concentrators and clients", icon: "Router", color: "#0d9488",
    fields: [
      { key: "vendor", label: "Vendor" },
      { key: "endpoint", label: "Endpoint / FQDN" },
      { key: "peers", label: "Peers" },
      { key: "tunnel_subnet", label: "Tunnel subnet" },
      { key: "mfa_enabled", label: "MFA enabled", fieldType: "boolean" },
    ],
  },
  {
    name: "Wireless", description: "Wireless networks and controllers", icon: "Wifi", color: "#0284c7",
    fields: [
      { key: "ssid", label: "SSID" },
      { key: "security", label: "Security", fieldType: "select", options: ["WPA2-PSK", "WPA3-PSK", "WPA2-Enterprise", "WPA3-Enterprise", "Open"] },
      { key: "band", label: "Band", fieldType: "select", options: ["2.4 GHz", "5 GHz", "6 GHz", "Dual", "Tri"] },
      { key: "controller", label: "Controller" },
      { key: "guest_network", label: "Guest network", fieldType: "boolean" },
    ],
  },
];

const STANDARD_NAMES = STANDARD_TYPES.map((t) => t.name);

async function enable(dryRun: boolean) {
  let created = 0, fieldsAdded = 0, kept = 0;
  for (const spec of STANDARD_TYPES) {
    const existing = await prisma.kumoAssetTemplate.findFirst({
      where: { name: spec.name },
      include: { _count: { select: { fields: true, assets: true } } },
    });

    if (!existing) {
      console.log(`  + ${spec.name} (${spec.fields.length} fields)`);
      if (!dryRun) {
        await prisma.kumoAssetTemplate.create({
          data: {
            name: spec.name,
            description: spec.description,
            icon: spec.icon,
            color: spec.color,
            isBuiltIn: false,
            isActive: true,
            fields: {
              create: spec.fields.map((f, i) => ({
                key: f.key, label: f.label, fieldType: f.fieldType || "text",
                options: f.options ?? undefined, placeholder: f.placeholder,
                helpText: f.helpText, sortOrder: i,
              })),
            },
          },
        });
      }
      created++;
      continue;
    }

    if (existing._count.fields === 0) {
      console.log(`  ~ ${spec.name} — exists, adding ${spec.fields.length} fields`);
      if (!dryRun) {
        await prisma.kumoTemplateField.createMany({
          data: spec.fields.map((f, i) => ({
            templateId: existing.id, key: f.key, label: f.label,
            fieldType: f.fieldType || "text", options: f.options ?? undefined,
            placeholder: f.placeholder, helpText: f.helpText, sortOrder: i,
          })),
        });
        if (!existing.isActive) {
          await prisma.kumoAssetTemplate.update({ where: { id: existing.id }, data: { isActive: true } });
        }
      }
      fieldsAdded++;
      continue;
    }

    console.log(`  = ${spec.name} — kept as it is (${existing._count.fields} fields, ${existing._count.assets} assets)`);
    if (!dryRun && !existing.isActive) {
      await prisma.kumoAssetTemplate.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    kept++;
  }
  console.log(`\n${dryRun ? "[dry run] " : ""}created ${created}, fields added to ${fieldsAdded}, kept ${kept}.`);
}

async function disable(dryRun: boolean) {
  const templates = await prisma.kumoAssetTemplate.findMany({
    where: { name: { in: STANDARD_NAMES } },
    include: { _count: { select: { assets: true } } },
  });

  if (templates.length === 0) {
    console.log("Nothing to remove — none of the standard types are present.");
    return;
  }

  let deleted = 0, deactivated = 0;
  for (const t of templates) {
    if (t._count.assets === 0) {
      console.log(`  - ${t.name} (deleted, no assets)`);
      if (!dryRun) {
        await prisma.kumoTemplateField.deleteMany({ where: { templateId: t.id } });
        await prisma.kumoAssetTemplate.delete({ where: { id: t.id } });
      }
      deleted++;
    } else {
      console.log(`  ! ${t.name} — deactivated, kept because ${t._count.assets} asset(s) use it`);
      if (!dryRun) {
        await prisma.kumoAssetTemplate.update({ where: { id: t.id }, data: { isActive: false } });
      }
      deactivated++;
    }
  }

  console.log(`\n${dryRun ? "[dry run] " : ""}deleted ${deleted}, deactivated ${deactivated}.`);
  if (deactivated > 0) {
    console.log("Deactivated types keep their fields and assets; db:types-on restores them.");
  }
  console.log("The type rail only lists active templates, so nothing it shows survives this.");
}

async function main() {
  const mode = (process.argv[2] || "").toLowerCase();
  const dryRun = process.argv.includes("--dry-run");
  if (mode !== "on" && mode !== "off") {
    console.error("Usage: tsx src/kumo-types-toggle.ts on|off [--dry-run]");
    process.exitCode = 1;
    return;
  }

  console.log(`Standard Kumo asset types — ${mode === "on" ? "ENABLE" : "DISABLE"}${dryRun ? " (dry run)" : ""}\n`);
  if (mode === "on") await enable(dryRun);
  else await disable(dryRun);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
