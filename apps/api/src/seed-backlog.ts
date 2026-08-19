/**
 * Backlog 2026-08-18 sample data — idempotent upserts for new feature tables.
 * Run once: npx tsx src/seed-backlog.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });

  // 1. Sample quote + line item
  const quote = await prisma.quote.upsert({
    where: { quoteNumber: "QT-SAMPLE-001" },
    update: {},
    create: {
      quoteNumber: "QT-SAMPLE-001",
      companyId: company?.id || "",
      title: "Sample Managed Services Quote",
      status: "draft",
      subtotal: 1500, taxRate: 0, taxTotal: 0, total: 1500,
      notes: "Sample quote created by the backlog seed (2026-08-18).",
      createdById: user?.id || null,
      lineItems: { create: [{ description: "Managed services block (10 hrs)", quantity: 10, unitPrice: 150, total: 1500, sortOrder: 1 }] },
    },
  });
  console.log(`[SeedBacklog] quote ${quote.quoteNumber} (id ${quote.id})`);

  // 2. Sample AI action (pending approval)
  const action = await prisma.aiAction.upsert({
    where: { id: "ai-action-sample-001" },
    update: {},
    create: {
      id: "ai-action-sample-001",
      entityType: "ticket",
      title: "Sample: close stale tickets",
      summary: "Proposed action to close 3 stale low-priority tickets.",
      riskTier: "medium",
      payload: { count: 3 },
      status: "pending",
      requestedById: user?.id || null,
      audit: { create: { event: "proposed", userId: user?.id || null, detail: "Seeded sample action" } },
    },
  });
  console.log(`[SeedBacklog] aiAction ${action.id}`);

  // 3. Sample uptime monitor (website kind)
  const svc = await prisma.serviceAlertService.upsert({
    where: { name: "Sample Website Monitor" },
    update: {},
    create: {
      name: "Sample Website Monitor",
      category: "uptime",
      monitorKind: "website",
      monitorUrl: "https://example.com",
      monitorConfig: { expectStatus: 200 },
      monitorEnabled: true,
      enabled: true,
      sortOrder: 900,
    },
  });
  console.log(`[SeedBacklog] monitor ${svc.id} (${svc.monitorKind})`);

  // 4. Sample alert webhook config
  const hook = await prisma.webhookConfig.upsert({
    where: { id: "webhook-sample-001" },
    update: {},
    create: {
      id: "webhook-sample-001",
      name: "Sample alert webhook",
      url: "https://example.com/hooks/alerts",
      secret: "sample-secret",
      events: ["alert.opened", "alert.resolved"],
      isActive: true,
    },
  });
  console.log(`[SeedBacklog] webhook ${hook.id}`);

  // 5. Sample push device
  const dev = await prisma.pushDevice.upsert({
    where: { token: "sample-push-token-001" },
    update: {},
    create: { token: "sample-push-token-001", platform: "web", userId: user?.id || null },
  });
  console.log(`[SeedBacklog] pushDevice ${dev.id}`);

  console.log("[SeedBacklog] done");
}

main().finally(() => prisma.$disconnect());
