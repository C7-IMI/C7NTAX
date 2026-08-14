// Restore missing audit logs into the live DB from the reconstructed
// snapshot union (apps/api/src/snapshots/audit-logs.json).
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  const file = path.join(__dirname, "snapshots", "audit-logs.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>[];

  const before = await prisma.auditLog.count();
  const del = await prisma.auditLog.deleteMany();
  const created = await prisma.auditLog.createMany({ data: rows as any, skipDuplicates: true });

  const after = await prisma.auditLog.count();
  const latest = await prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" } });
  const earliest = await prisma.auditLog.findFirst({ orderBy: { createdAt: "asc" } });

  console.log(`before: ${before} | deleted: ${del.count} | inserted: ${created.count} | after: ${after}`);
  console.log(`range: ${earliest?.createdAt.toISOString()} -> ${latest?.createdAt.toISOString()}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
