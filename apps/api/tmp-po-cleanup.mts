process.env.PORT = process.env.PORT || "4000";
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
const { prisma } = await import("./src/index");

const po = await prisma.purchaseOrder.findFirst({ where: { poNumber: "PO-1001" } });
if (!po) throw new Error("PO-1001 not found");

const created = await prisma.asset.findMany({ where: { purchaseOrder: "PO-1001" }, select: { id: true, assetTag: true } });
await prisma.pOLineItem.updateMany({ where: { poId: po.id }, data: { assetId: null } });
const removed = await prisma.asset.deleteMany({ where: { purchaseOrder: "PO-1001" } });
const restored = await prisma.purchaseOrder.update({
  where: { id: po.id },
  data: { status: "ordered", receivedAt: null, orderedAt: new Date("2026-08-19T12:00:00Z") },
});
const line = await prisma.pOLineItem.findFirst({ where: { poId: po.id }, select: { description: true, quantity: true, unitPrice: true, assetId: true } });
console.log("assets removed:", removed.count, "of", created.length);
console.log("po:", restored.poNumber, restored.status, "receivedAt:", restored.receivedAt, "notes:", JSON.stringify(restored.notes));
console.log("line:", JSON.stringify(line));
await prisma.$disconnect();
process.exit(0);
