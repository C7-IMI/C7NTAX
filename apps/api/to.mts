import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const probes = await prisma.kumoAsset.findMany({ where: { name: { startsWith: "QA probe" } }, select: { id: true, name: true } });
  for (const p of probes) {
    await prisma.kumoAssetFieldValue.deleteMany({ where: { assetId: p.id } });
    await prisma.kumoAsset.delete({ where: { id: p.id } });
  }
  console.log(`deleted probe assets: ${probes.map((p) => p.name).join(", ") || "none"}`);
  console.log(`kumo assets now: ${await prisma.kumoAsset.count()}`);
}
main().finally(() => prisma.$disconnect());
