/**
 * Product catalog seed (PLAN-019's feature work).
 *
 * Two jobs, both idempotent:
 *
 *  1. **Backfill the `product:*` permissions onto the default roles.** The API computes a
 *     user's permissions from the role row stored in the database (falling back to
 *     `ROLE_PERMISSIONS` only when that row is empty), so a new permission in the shared enum
 *     does nothing for an existing install until the role rows are updated. Same pattern as
 *     `seed-service-alerts.ts` used for the Service Alert permissions.
 *
 *  2. **Seed a starter catalog**, only when the table is empty, so the page is not a blank
 *     form on first run. These are ordinary MSP items with realistic prices — they are meant
 *     to be edited, renamed or deleted, not treated as a curated list.
 */
import { PrismaClient } from "@prisma/client";
import { Permission, ROLE_PERMISSIONS, SystemRole } from "@C7NTAX/shared";

const prisma = new PrismaClient();

interface StarterProduct {
  sku: string;
  name: string;
  description: string;
  productType: string;
  category: string;
  subcategory?: string;
  manufacturer?: string;
  unit: string;
  costPrice: number;
  sellPrice: number;
  billingPeriod?: string;
  taxable?: boolean;
  trackStock?: boolean;
  stockOnHand?: number;
  reorderPoint?: number;
  reorderQuantity?: number;
  warrantyMonths?: number;
}

const STARTER_CATALOG: StarterProduct[] = [
  {
    sku: "HW-LAPTOP-14",
    name: "Business laptop, 14\" (16 GB / 512 GB)",
    description: "Standard managed laptop: 14-inch, 16 GB RAM, 512 GB NVMe, 3-year on-site warranty. Imaged and enrolled before delivery.",
    productType: "hardware", category: "Endpoints", subcategory: "Laptops", manufacturer: "Dell",
    unit: "each", costPrice: 950, sellPrice: 1250, trackStock: true, stockOnHand: 3, reorderPoint: 2, reorderQuantity: 5, warrantyMonths: 36,
  },
  {
    sku: "HW-DOCK-USB-C",
    name: "USB-C docking station",
    description: "Dual-display USB-C dock with power delivery, for desk-based users and hot-desking.",
    productType: "hardware", category: "Endpoints", subcategory: "Accessories",
    unit: "each", costPrice: 145, sellPrice: 210, trackStock: true, stockOnHand: 8, reorderPoint: 3, reorderQuantity: 10, warrantyMonths: 24,
  },
  {
    sku: "SW-M365-BP",
    name: "Microsoft 365 Business Premium",
    description: "Per-user subscription: Office apps, Exchange Online, Teams, Intune and Defender for Business.",
    productType: "subscription", category: "Microsoft 365", subcategory: "Licences", manufacturer: "Microsoft",
    unit: "user", costPrice: 18.10, sellPrice: 22.50, billingPeriod: "monthly",
  },
  {
    sku: "SW-EDR-SEAT",
    name: "Managed endpoint detection & response",
    description: "Per-endpoint EDR seat with alert triage by the service desk. Includes monthly reporting.",
    productType: "service", category: "Security", subcategory: "Managed services",
    unit: "month", costPrice: 6.50, sellPrice: 12.00, billingPeriod: "monthly",
  },
  {
    sku: "SVC-ONBOARD-USER",
    name: "New user onboarding",
    description: "Account, mailbox, licence allocation, device setup, MFA enrolment and a handover call.",
    productType: "service", category: "Professional services", subcategory: "Onboarding",
    unit: "each", costPrice: 0, sellPrice: 180, billingPeriod: "none",
  },
  {
    sku: "SVC-LABOUR-STD",
    name: "Standard labour",
    description: "Remote support and project time during business hours.",
    productType: "service", category: "Labour", unit: "hour",
    costPrice: 0, sellPrice: 150, taxable: true,
  },
  {
    sku: "LIC-BACKUP-SEAT",
    name: "Cloud backup, per workstation",
    description: "Per-workstation cloud backup with 30-day retention and monthly test restores.",
    productType: "license", category: "Backup", unit: "month",
    costPrice: 4.20, sellPrice: 9.00, billingPeriod: "monthly",
  },
  {
    sku: "BND-NEW-STARTER",
    name: "New starter bundle",
    description: "Laptop, dock, Microsoft 365 licence and onboarding — the standard package for a new employee.",
    productType: "bundle", category: "Bundles", unit: "each",
    costPrice: 1113.10, sellPrice: 1650, billingPeriod: "none",
  },
];

async function backfillPermissions(): Promise<void> {
  const roles = await prisma.role.findMany({ select: { id: true, name: true, systemRole: true, permissions: true } });
  let updated = 0;
  for (const role of roles) {
    const desired = ROLE_PERMISSIONS[role.systemRole as SystemRole] || [];
    // Only the catalog permissions are merged here: this script must not quietly grant a role
    // something a later change removed.
    const wanted = desired.filter(p => p.startsWith("product:"));
    if (wanted.length === 0) continue;
    const merged = Array.from(new Set([...role.permissions, ...wanted]));
    if (merged.length === role.permissions.length) continue;
    await prisma.role.update({ where: { id: role.id }, data: { permissions: merged } });
    updated++;
    console.log(`  ✓ ${role.name} + ${merged.length - role.permissions.length} product permission(s)`);
  }
  console.log(`  ✓ ${updated} role(s) updated`);
}

async function seedCatalog(): Promise<void> {
  const existing = await prisma.product.count();
  if (existing > 0) {
    console.log(`  • catalog already has ${existing} product(s) — starter items not added`);
    return;
  }
  for (const item of STARTER_CATALOG) {
    await prisma.product.create({
      data: {
        sku: item.sku,
        name: item.name,
        description: item.description,
        productType: item.productType,
        category: item.category,
        subcategory: item.subcategory ?? null,
        manufacturer: item.manufacturer ?? null,
        unit: item.unit,
        costPrice: item.costPrice,
        sellPrice: item.sellPrice,
        billingPeriod: item.billingPeriod ?? "none",
        taxable: item.taxable ?? true,
        trackStock: item.trackStock ?? false,
        stockOnHand: item.stockOnHand ?? 0,
        reorderPoint: item.reorderPoint ?? null,
        reorderQuantity: item.reorderQuantity ?? null,
        warrantyMonths: item.warrantyMonths ?? null,
      },
    });
  }
  console.log(`  ✓ ${STARTER_CATALOG.length} starter products added (edit or delete them freely)`);
}

async function main(): Promise<void> {
  console.log("Product catalog seed");
  console.log("  catalog permissions:");
  await backfillPermissions();
  console.log("  starter catalog:");
  await seedCatalog();
  const missing = await prisma.product.count({ where: { sku: { in: STARTER_CATALOG.map(p => p.sku) } } });
  console.log(`  ✓ ${missing}/${STARTER_CATALOG.length} starter SKUs present`);
  console.log(`  ✓ permissions on the enum: ${[Permission.ProductView, Permission.ProductManage].join(", ")}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
