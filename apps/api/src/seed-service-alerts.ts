/**
 * FI-060 — Service Alerts seed
 *
 * Creates the default monitored services (Microsoft 365, Azure, AWS,
 * GitHub, Google Workspace, Comcast/Xfinity, Verizon, Spectrum) plus a
 * couple of representative alerts so the dashboard/banner are populated
 * on first run. Also backfills the new ServiceAlert permissions onto
 * existing default roles.
 */
import { PrismaClient } from "@prisma/client";
import { Permission, ROLE_PERMISSIONS, SystemRole } from "@C7NTAX/shared";

const prisma = new PrismaClient();

const SERVICES = [
  {
    name: "Microsoft 365",
    category: "cloud",
    description: "Exchange Online, Teams, SharePoint, OneDrive and Entra ID.",
    statusPageUrl: "https://status.cloud.microsoft",
    downDetectorUrl: "https://downdetector.com/status/microsoft-365/",
    rssUrl: "https://status.cloud.microsoft/rss",
    sortOrder: 10,
  },
  {
    name: "Azure",
    category: "cloud",
    description: "Azure infrastructure, compute, storage and networking services.",
    statusPageUrl: "https://azure.status.microsoft/en-us/status",
    downDetectorUrl: "https://downdetector.com/status/azure/",
    rssUrl: "https://azure.status.microsoft/en-us/status/feed/",
    sortOrder: 20,
  },
  {
    name: "AWS",
    category: "cloud",
    description: "Amazon Web Services global infrastructure and regions.",
    statusPageUrl: "https://health.aws.amazon.com/health/status",
    downDetectorUrl: "https://downdetector.com/status/aws-amazon-web-services/",
    rssUrl: "https://status.aws.amazon.com/rss/all.rss",
    sortOrder: 30,
  },
  {
    name: "GitHub",
    category: "cloud",
    description: "GitHub.com, Actions, Packages and Pages.",
    statusPageUrl: "https://www.githubstatus.com",
    downDetectorUrl: "https://downdetector.com/status/github/",
    rssUrl: "https://www.githubstatus.com/history.rss",
    sortOrder: 40,
  },
  {
    name: "Google Workspace",
    category: "collaboration",
    description: "Gmail, Google Drive, Calendar, Meet and Docs.",
    statusPageUrl: "https://www.google.com/appsstatus/dashboard/",
    downDetectorUrl: "https://downdetector.com/status/gmail/",
    rssUrl: "https://www.google.com/appsstatus/rss/en",
    sortOrder: 50,
  },
  {
    name: "Comcast Xfinity",
    category: "isp",
    description: "Comcast / Xfinity internet and business services.",
    statusPageUrl: "https://www.xfinity.com/support/status",
    downDetectorUrl: "https://downdetector.com/status/comcast-xfinity/",
    rssUrl: null,
    sortOrder: 60,
  },
  {
    name: "Verizon",
    category: "isp",
    description: "Verizon Fios and wireless connectivity.",
    statusPageUrl: null,
    downDetectorUrl: "https://downdetector.com/status/verizon/",
    rssUrl: null,
    sortOrder: 70,
  },
  {
    name: "Spectrum",
    category: "isp",
    description: "Charter Spectrum internet and business services.",
    statusPageUrl: "https://www.spectrum.net/support/internet/service-status",
    downDetectorUrl: "https://downdetector.com/status/spectrum/",
    rssUrl: null,
    sortOrder: 80,
  },
];

async function main() {
  console.log("[Seed] Service Alerts seed...\n");

  // ── 1. Backfill ServiceAlert permissions onto existing default roles ──
  const roleNames: Array<{ name: string; systemRole: SystemRole }> = [
    { name: "Admin", systemRole: SystemRole.Admin },
    { name: "Manager", systemRole: SystemRole.Manager },
    { name: "Technician", systemRole: SystemRole.Technician },
    { name: "Dispatcher", systemRole: SystemRole.Dispatcher },
    { name: "Billing Manager", systemRole: SystemRole.BillingManager },
    { name: "Client Admin", systemRole: SystemRole.ClientAdmin },
    { name: "Client User", systemRole: SystemRole.ClientUser },
    { name: "Read Only", systemRole: SystemRole.ReadOnly },
  ];
  for (const def of roleNames) {
    const desired = ROLE_PERMISSIONS[def.systemRole] || [];
    const existing = await prisma.role.findUnique({ where: { name: def.name } });
    if (!existing) continue;
    const merged = Array.from(new Set([...existing.permissions, ...desired.filter((p) => p.startsWith("servicealert:"))]));
    if (merged.length !== existing.permissions.length) {
      await prisma.role.update({ where: { id: existing.id }, data: { permissions: merged } });
      console.log(`  ✓ Updated ${def.name} permissions (+service alerts)`);
    }
  }

  // ── 2. Upsert monitored services ──
  for (const svc of SERVICES) {
    await prisma.serviceAlertService.upsert({
      where: { name: svc.name },
      create: svc,
      update: { ...svc, name: undefined } as any,
    });
  }
  console.log(`  ✓ Upserted ${SERVICES.length} monitored services`);

  // ── 3. Representative alerts (only when no active alerts exist) ──
  const activeCount = await prisma.serviceAlert.count({ where: { status: "active" } });
  if (activeCount === 0) {
    const m365 = await prisma.serviceAlertService.findUnique({ where: { name: "Microsoft 365" } });
    const comcast = await prisma.serviceAlertService.findUnique({ where: { name: "Comcast Xfinity" } });
    const github = await prisma.serviceAlertService.findUnique({ where: { name: "GitHub" } });
    if (m365) {
      await prisma.serviceAlert.create({
        data: {
          serviceId: m365.id,
          title: "Possible Service Interruption has been reported for Microsoft 365",
          description: "Users may be unable to access Exchange Online and Teams. Microsoft is investigating degraded service availability.",
          severity: "outage",
          status: "active",
          source: "rss",
          sourceUrl: "https://status.cloud.microsoft",
          detectedAt: new Date(Date.now() - 45 * 60 * 1000),
        },
      });
    }
    if (comcast) {
      await prisma.serviceAlert.create({
        data: {
          serviceId: comcast.id,
          title: "Comcast Xfinity — intermittent connectivity reported",
          description: "Reports of intermittent internet connectivity across multiple regions. No official statement yet.",
          severity: "degraded",
          status: "active",
          source: "downdetector",
          sourceUrl: "https://downdetector.com/status/comcast-xfinity/",
          detectedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
      });
    }
    if (github) {
      await prisma.serviceAlert.create({
        data: {
          serviceId: github.id,
          title: "GitHub Actions — degraded performance",
          description: "GitHub Actions runners experienced degraded performance.",
          severity: "degraded",
          status: "resolved",
          source: "rss",
          sourceUrl: "https://www.githubstatus.com",
          detectedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
          resolvedAt: new Date(Date.now() - 22 * 60 * 60 * 1000),
        },
      });
    }
    console.log("  ✓ Created representative alerts (2 active, 1 resolved)");
  } else {
    console.log("  ✓ Active alerts already exist — skipping representative alerts");
  }

  console.log("\n[Seed] Service Alerts done.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
