/**
 * Seed sample tickets so every Service Board badge is populated.
 *
 * Adds varied ticket samples per board (statuses, priorities, ages) so the
 * Boards page badges — New, Workable, On Hold, Waiting, Escalated, open count,
 * stale 3/7/30-day, Avg Age — are all non-zero with varied numbers.
 *
 * Idempotent: each board has a target ticket count; if the board already has
 * at least that many tickets, nothing is added. Existing tickets are never
 * touched. Ticket numbers use the board ticketCode prefix (INF-/MSP-/NOC-/INT-)
 * so the board-filtered ticket lists keep working.
 *
 * Usage: npx tsx src/seed-ticket-samples.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

interface TicketSpec {
  status: string;
  priority: string;
  source: string;
  title: string;
  daysAgo?: number; // sets createdAt/updatedAt for stale badges
}

interface BoardPlan {
  target: number;
  tickets: TicketSpec[];
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const TITLES: Record<string, string[]> = {
  MSP: [
    "New user onboarding for marketing team",
    "Laptop setup and domain join",
    "Outlook profile corruption on sales laptop",
    "VPN connection drops on home office machine",
    "Printer not scanning to email",
    "Password reset locked out of account",
    "Software install — Adobe Creative Cloud",
    "Mobile device enrollment in Intune",
    "File share permission request",
    "Email delivery delays to external domain",
    "Workstation blue screen after patch",
    "Office 365 license assignment",
    "VoIP desk phone not provisioning",
    "Slow performance on accounting PC",
    "MFA enrollment for new hire",
    "OneDrive sync failure",
    "Remote desktop cannot reach server",
    "Wi-Fi connectivity issue in conference room",
    "Monitor flickering after driver update",
    "Access card reader offline",
    "Backup job failing on file server",
    "SharePoint site access denied",
    "Antivirus quarantine false positive",
    "New user onboarding for finance team",
  ],
  INF: [
    "Hyper-V host high CPU alert",
    "DC replication latency warning",
    "Disk space critical on file server",
    "SSL certificate expiring on portal",
    "DNS resolution failures for internal host",
    "SQL server transaction log full",
    "Router firmware upgrade scheduled",
    "Firewall rule change request",
    "Storage volume nearing capacity",
    "Load balancer health check failing",
    "Active Directory sync errors",
    "Terminal server session hangs",
    "ESXi host memory alert",
    "Network switch port flapping",
    "Backup infrastructure drive failure",
    "VPN concentrator throughput degradation",
    "DHCP scope exhausted on guest VLAN",
    "SAN controller battery warning",
    "Proxy server cache errors",
    "Domain controller time drift",
  ],
  NOC: [
    "Server down — ping monitor alert",
    "Website response time above threshold",
    "Disk utilization 92% on DB server",
    "Service restart loop detected",
    "CPU sustained at 100% on app node",
    "Nightly backup window exceeded",
    "Memory leak observed on web farm",
    "SSL handshake failures increasing",
    "API gateway 5xx error spike",
    "Database connection pool exhausted",
    "Load average critical on batch node",
    "Certificate validation warning",
    "Log volume anomaly detected",
    "Cluster node heartbeat missed",
    "NTP offset beyond tolerance",
    "IDS signature update failed",
    "Storage IO latency alert",
    "Queue depth exceeded threshold",
    "UPS on battery power notification",
    "Temperature sensor out of range",
  ],
  INT: [
    "Threat hunt: suspicious PowerShell activity",
    "Phishing campaign targeting finance team",
    "Vulnerability scan findings triage",
    "EDR alert: credential dumping attempt",
    "Dark web mention of client domain",
    "Intelligence report: new ransomware variant",
    "Log review: anomalous login patterns",
    "Indicators of compromise enrichment",
    "Supply chain risk assessment",
    "Zero-day advisory impact analysis",
    "Account takeover investigation",
    "Malware sample detonation report",
    "Email gateway policy tuning",
    "Threat actor TTP mapping",
    "Insider threat baseline deviation",
    "Certificate abuse monitoring",
    "Brand impersonation domain registered",
    "Credential stuffing attempt blocked",
    "SOC playbook update — ransomware",
    "Intel feed integration validation",
  ],
};

// Status/priority/source distribution per board — varied per board and badge.
let titleCursor: Record<string, number> = {};

const PLANS: Record<string, BoardPlan> = {
  "MSP Service Desk": {
    target: 25,
    tickets: [
      ...specs("MSP", "new", ["low", "low", "medium", "medium", "high", "high"], ["portal", "email", "portal", "email", "phone", "portal"]),
      ...specs("MSP", "in_progress", ["medium", "medium", "medium", "high", "high", "critical", "critical"], ["portal", "email", "portal", "email", "phone", "portal", "email"]),
      ...specs("MSP", "on_hold", ["medium", "medium", "low"], ["portal", "email", "portal"]),
      ...specs("MSP", "waiting_on_client", ["medium", "medium", "low"], ["email", "email", "portal"]),
      ...specs("MSP", "waiting_on_third_party", ["medium", "high"], ["email", "email"]),
      ...specs("MSP", "resolved", ["medium", "low"], ["portal", "portal"]),
      ...specs("MSP", "closed", ["medium"], ["portal"]),
    ],
  },
  "Infrastructure Service Desk": {
    target: 25,
    tickets: [
      ...specs("INF", "new", ["low", "low", "medium", "medium", "high"], ["monitor", "portal", "email", "monitor", "portal"]),
      ...specs("INF", "in_progress", ["medium", "medium", "medium", "medium", "high", "high", "critical", "critical"], ["monitor", "portal", "email", "monitor", "portal", "email", "monitor", "portal"]),
      ...specs("INF", "on_hold", ["medium", "low"], ["portal", "email"]),
      ...specs("INF", "waiting_on_client", ["medium", "high"], ["email", "email"]),
      ...specs("INF", "waiting_on_third_party", ["medium"], ["email"]),
      ...specs("INF", "resolved", ["medium"], ["monitor"]),
      ...specs("INF", "closed", ["low"], ["portal"]),
    ],
  },
  "NOC Alerts": {
    target: 23,
    tickets: [
      ...specs("NOC", "new", ["low", "low", "medium", "medium"], ["monitor", "monitor", "monitor", "email"]),
      ...specs("NOC", "in_progress", ["medium", "medium", "medium", "high", "high", "critical"], ["monitor", "monitor", "email", "monitor", "monitor", "monitor"]),
      ...specs("NOC", "on_hold", ["medium"], ["email"]),
      ...specs("NOC", "waiting_on_client", ["medium", "high"], ["email", "email"]),
      ...specs("NOC", "waiting_on_third_party", ["medium"], ["email"]),
      ...specs("NOC", "pending_approval", ["medium", "low"], ["portal", "portal"]),
      ...specs("NOC", "resolved", ["high", "medium", "medium"], ["monitor", "monitor", "monitor"]),
      ...specs("NOC", "closed", ["medium", "low"], ["monitor", "portal"]),
    ],
  },
  "Intelligence Service Desk": {
    target: 23,
    tickets: [
      ...specs("INT", "new", ["low", "low", "medium", "medium", "medium"], ["portal", "email", "portal", "email", "portal"]),
      ...specs("INT", "in_progress", ["medium", "medium", "medium", "high", "critical"], ["portal", "email", "portal", "email", "portal"]),
      ...specs("INT", "on_hold", ["medium", "low"], ["portal", "email"]),
      ...specs("INT", "waiting_on_client", ["medium", "medium", "high"], ["email", "email", "portal"]),
      ...specs("INT", "waiting_on_third_party", ["medium", "low"], ["email", "email"]),
      ...specs("INT", "pending_approval", ["medium"], ["portal"]),
      ...specs("INT", "resolved", ["high", "medium", "medium"], ["portal", "portal", "email"]),
      ...specs("INT", "closed", ["medium", "low"], ["portal", "portal"]),
    ],
  },
};

// Stale-ticket age schedule per board (daysAgo for a few open tickets) so the
// 3/7/30-day stale badges populate with varied, hierarchical counts.
const STALE_SCHEDULE: Record<string, number[]> = {
  "MSP Service Desk": [5, 5, 12, 35],
  "Infrastructure Service Desk": [5, 12, 40],
  "NOC Alerts": [4, 9, 31],
  "Intelligence Service Desk": [6, 15, 45],
};

function nextTitle(code: string): string {
  const pool = TITLES[code]!;
  const idx = titleCursor[code] ?? 0;
  titleCursor[code] = idx + 1;
  return pool[idx % pool.length]!;
}

function specs(code: string, status: string, priorities: string[], sources: string[]): TicketSpec[] {
  return priorities.map((priority, i) => ({
    status,
    priority,
    source: sources[i % sources.length]!,
    title: nextTitle(code),
  }));
}

async function main() {
  const boards = await prisma.serviceBoard.findMany({
    where: { isActive: true },
    include: { _count: { select: { tickets: true } } },
    orderBy: { name: "asc" },
  });
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const contacts = await prisma.contact.findMany({ select: { id: true, companyId: true } });
  const admin = users.find((u) => u.id === "8c30a256") ?? users[0];

  const contactsByCompany = new Map<string, string[]>();
  for (const c of contacts) {
    const list = contactsByCompany.get(c.companyId) ?? [];
    list.push(c.id);
    contactsByCompany.set(c.companyId, list);
  }

  let totalAdded = 0;

  for (const board of boards) {
    const plan = PLANS[board.name];
    if (!plan) {
      console.log(`⊘ ${board.name}: no plan, skipping`);
      continue;
    }
    const current = board._count.tickets;
    if (current >= plan.target) {
      console.log(`⊘ ${board.name}: already has ${current} tickets (target ${plan.target}), skipping`);
      continue;
    }

    const staleDays = STALE_SCHEDULE[board.name] ?? [];
    let staleIdx = 0;
    const seqStart = 2001 + current;
    const specsList = plan.tickets.slice(0, plan.target - current);
    const now = Date.now();
    const data: Prisma.TicketCreateManyInput[] = specsList.map((s, i) => {
      const company = companies[i % companies.length]!;
      const companyContacts = contactsByCompany.get(company.id) ?? [];
      // Every sample ticket gets a contact: prefer one from its company,
      // otherwise fall back to any contact so no ticket is contactless.
      const contactId = companyContacts[i % Math.max(companyContacts.length, 1) % 1000] ?? contacts[0]?.id ?? null;
      // stale tickets get old createdAt/updatedAt; fresh ones are 1–48h old.
      // New tickets are excluded from staleness so old "New" badges don't look odd.
      const isStale = !["resolved", "closed", "new"].includes(s.status) && staleIdx < staleDays.length;
      const daysAgo = isStale ? staleDays[staleIdx++] : 0;
      const ageMs = isStale ? daysAgo! * DAY : Math.floor(1 + Math.random() * 47) * HOUR;
      const ts = new Date(now - ageMs);
      return {
        ticketNumber: `${board.ticketCode}-${seqStart + i}`,
        title: s.title,
        description: `Sample ${s.status.replace(/_/g, " ")} ticket for ${board.name} (seeded by seed-ticket-samples).`,
        status: s.status,
        priority: s.priority,
        source: s.source,
        boardId: board.id,
        companyId: company.id,
        contactId: contactId,
        assignedToId: users[i % users.length]!.id,
        createdById: admin!.id,
        createdAt: ts,
        updatedAt: ts,
        isOverdue: false,
      };
    });

    await prisma.ticket.createMany({ data });
    totalAdded += data.length;
    console.log(`✓ ${board.name}: +${data.length} tickets (total ${current + data.length})`);
  }

  console.log(`\nDone. Added ${totalAdded} sample tickets across ${boards.length} boards.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
