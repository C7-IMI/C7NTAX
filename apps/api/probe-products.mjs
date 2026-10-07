/**
 * Product catalog (Administration → Product Catalog).
 *
 * What is under test:
 *   1. **Cost and margin are commercial data.** `product:manage` sees them, and so does the
 *      finance role (`billing:manage`) that prices purchase orders — but only `product:manage`
 *      may change a cost price, and a viewer gets the sell price and nothing else.
 *   2. **A product in use is deactivated, not deleted.** The delete route refuses and names the
 *      record that holds it.
 *   3. **The catalog is one source of prices.** A quote line, a purchase-order line and an invoice
 *      line all keep the `productId` they came from.
 *   4. Recurring prices are reported as what they are worth in a year, and stock is only counted
 *      for things flagged as stocked.
 *
 * Requires the API with the catalog seeded (`npx tsx src/seed-product-catalog.ts`) and
 * `BILLING_FROM_TICKETS_ENABLED` not set to "false".
 *
 * Run from apps/api:  node probe-products.mjs
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token };
}

async function main() {
  const stamp = Date.now();

  const admin = await signIn("persona.admin@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  const readonly = await signIn("persona.readonly@c7ntax.local");
  const clientAdmin = await signIn("persona.clientadmin@c7ntax.local");
  check(!!admin.token && !!tech.token && !!readonly.token && !!clientAdmin.token, "the four personas signed in");

  const adminUser = await prisma.user.findUnique({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const board = await prisma.serviceBoard.findFirst({ where: { isActive: true }, select: { id: true } });
  const vendor = await prisma.vendor.create({ data: { name: `Catalog Probe Vendor ${stamp}` }, select: { id: true, name: true } });

  // An editor who may maintain the catalog but not see or set cost — the case the permission
  // split exists for, and one no seeded role covers.
  const editorRole = await prisma.role.create({
    data: {
      name: `Catalog Probe Editor ${stamp}`,
      systemRole: "manager",
      permissions: ["product:view", "product:create", "product:edit"],
    },
    select: { id: true },
  });
  const editorEmail = `catalog.editor.${stamp}@c7ntax.local`;
  const editorUser = await prisma.user.create({
    data: {
      email: editorEmail, firstName: "Catalog", lastName: "Editor", isActive: true, emailVerified: true,
      mustChangePassword: false, mfaEnabled: false, roleId: editorRole.id, passwordHash: bcrypt.hashSync(PW, 10),
    },
    select: { id: true },
  });
  const editor = await signIn(editorEmail);
  check(editor.status === 200 && !!editor.token, `the cost-blind editor signed in (${editor.status})`);

  console.log("\nthe seeded catalog is readable and priced");
  const list = await call("GET", "/api/products?limit=500", { token: admin.token });
  check(list.status === 200, `the catalog answers (${list.status})`);
  check((list.data?.data || []).length >= 8, `with the starter items in it (${(list.data?.data || []).length})`);
  check(list.data?.total === (list.data?.data || []).length, `and a total that matches (${list.data?.total})`);
  check((list.data?.data || []).some(p => p.sku === "HW-LAPTOP-14"), "including the laptop at its SKU");
  const names = (list.data?.data || []).map(p => p.name);
  check(names.join("|") === [...names].sort((a, b) => a.localeCompare(b)).join("|"), "sorted by name");

  console.log("\ncost and margin belong to the people who manage the catalog");
  const adminLaptop = (list.data?.data || []).find(p => p.sku === "HW-LAPTOP-14");
  check(adminLaptop?.costPrice === 950, `an administrator sees cost (${adminLaptop?.costPrice})`);
  check(adminLaptop?.margin === 300 && adminLaptop?.marginPercent === 24, `and the margin it implies (${adminLaptop?.margin} / ${adminLaptop?.marginPercent}%)`);
  const techList = await call("GET", "/api/products?limit=500", { token: tech.token });
  const techLaptop = (techList.data?.data || []).find(p => p.sku === "HW-LAPTOP-14");
  check(techList.status === 200, `a technician can read the catalog (${techList.status})`);
  check(techLaptop?.sellPrice === 1250, `and sees the sell price (${techLaptop?.sellPrice})`);
  check(techLaptop?.costPrice === undefined, "but not the cost");
  check(techLaptop?.margin === undefined && techLaptop?.marginPercent === undefined, "and not the margin");
  const readonlyList = await call("GET", "/api/products?limit=5", { token: readonly.token });
  check(readonlyList.status === 200, `read-only can read the catalog (${readonlyList.status})`);
  check((readonlyList.data?.data || []).every(p => p.costPrice === undefined), "without cost either");
  const editorList = await call("GET", "/api/products?limit=5", { token: editor.token });
  check(editorList.status === 200 && (editorList.data?.data || []).every(p => p.costPrice === undefined), "an editor without product:manage also sees no cost");

  // Finance buys at cost, so `billing:manage` sees it too — but that is a read: the editor above
  // is the only role that may change a cost price, and it needs `product:manage` for that.
  const financeRole = await prisma.role.create({
    data: {
      name: `Catalog Probe Finance ${stamp}`,
      systemRole: "billing_manager",
      permissions: ["billing:view", "billing:manage", "invoice:create", "invoice:send", "product:view"],
    },
    select: { id: true },
  });
  const financeEmail = `catalog.finance.${stamp}@c7ntax.local`;
  const financeUser = await prisma.user.create({
    data: {
      email: financeEmail, firstName: "Catalog", lastName: "Finance", isActive: true, emailVerified: true,
      mustChangePassword: false, mfaEnabled: false, roleId: financeRole.id, passwordHash: bcrypt.hashSync(PW, 10),
    },
    select: { id: true },
  });
  const finance = await signIn(financeEmail);
  const financeList = await call("GET", "/api/products?limit=500", { token: finance.token });
  const financeLaptop = (financeList.data?.data || []).find(p => p.sku === "HW-LAPTOP-14");
  check(finance.status === 200 && financeLaptop?.costPrice === 950, `billing:manage sees cost for procurement (${financeLaptop?.costPrice})`);
  check(financeLaptop?.margin === 300, "and the margin that implies, since a PO is priced at cost");
  check((await call("PATCH", `/api/products/${financeLaptop?.id}`, { token: finance.token, body: { costPrice: 1 } })).status === 403, "but cannot change a cost price");

  console.log("\nthe catalog is a permission, not a page");
  const clientAdminList = await call("GET", "/api/products?limit=5", { token: clientAdmin.token });
  check(clientAdminList.status === 403, `a client contact cannot read the internal catalog (${clientAdminList.status})`);
  check((await call("POST", "/api/products", { token: tech.token, body: { name: "Nope" } })).status === 403, "a technician cannot create one");
  check((await call("POST", "/api/products", { token: readonly.token, body: { name: "Nope" } })).status === 403, "read-only cannot create one");
  check((await call("PATCH", `/api/products/${adminLaptop?.id}`, { token: tech.token, body: { sellPrice: 1 } })).status === 403, "a technician cannot edit one");
  check((await call("DELETE", `/api/products/${adminLaptop?.id}`, { token: tech.token })).status === 403, "or delete one");

  console.log("\ncreating an item");
  const created = await call("POST", "/api/products", {
    token: admin.token,
    body: { name: `Probe Firewall ${stamp}`, category: "Networking", productType: "hardware", costPrice: 400, sellPrice: 700, unit: "each", vendorId: vendor.id, trackStock: true, stockOnHand: 1, reorderPoint: 2, warrantyMonths: 12 },
  });
  check(created.status === 201, `the item is created (${created.status})`);
  const item = created.data;
  check(/^[A-Z0-9][A-Z0-9._-]+$/.test(item?.sku || ""), `a SKU was derived from the name (${item?.sku})`);
  check(item?.productType === "hardware" && item?.unit === "each" && item?.billingPeriod === "none", "type, unit and period defaulted");
  check(item?.taxable === true && item?.isActive === true, "and it is taxable and active by default");
  check(item?.belowReorderPoint === true, `stock below the reorder point is flagged (${item?.stockOnHand} <= ${item?.reorderPoint})`);
  const explicitSku = await call("POST", "/api/products", { token: admin.token, body: { name: `Probe Switch ${stamp}`, sku: `sw-probe-${stamp}`, sellPrice: 300 } });
  check(explicitSku.status === 201 && explicitSku.data?.sku === `SW-PROBE-${stamp}`, `a supplied SKU is upper-cased (${explicitSku.data?.sku})`);
  const recurring = await call("POST", "/api/products", { token: admin.token, body: { name: `Probe Seat ${stamp}`, productType: "subscription", billingPeriod: "monthly", sellPrice: 10, costPrice: 6 } });
  check(recurring.data?.annualValue === 120, `a monthly price reports its annual worth (${recurring.data?.annualValue})`);
  check(recurring.data?.margin === 4, `and its margin (${recurring.data?.margin})`);

  console.log("\nwhat it refuses");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "  " } })).status === 400, "a blank name is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Bad type", productType: "sandwich" } })).status === 400, "an unknown type is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Bad unit", unit: "bucket" } })).status === 400, "an unknown unit is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Bad period", billingPeriod: "fortnightly" } })).status === 400, "an unknown billing period is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Negative", sellPrice: -5 } })).status === 400, "a negative price is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Subscription", productType: "subscription", billingPeriod: "none" } })).status === 400, "a subscription without a period is refused");
  check((await call("POST", "/api/products", { token: admin.token, body: { name: "Bad vendor", vendorId: "00000000-0000-0000-0000-000000000000" } })).status === 400, "an unknown vendor is refused");
  const clash = await call("POST", "/api/products", { token: admin.token, body: { name: "Clash", sku: item.sku } });
  check(clash.status === 409 && /already used/i.test(clash.data?.error?.message || ""), `a duplicate SKU is refused and names the holder (${clash.data?.error?.message?.slice(0, 40)})`);
  check((await call("GET", "/api/products/00000000-0000-0000-0000-000000000000", { token: admin.token })).status === 404, "an unknown product is a 404");
  const editorCostChange = await call("PATCH", `/api/products/${item.id}`, { token: editor.token, body: { costPrice: 1 } });
  check(editorCostChange.status === 403, `an editor without product:manage cannot change a cost price (${editorCostChange.status})`);
  const editorNameChange = await call("PATCH", `/api/products/${item.id}`, { token: editor.token, body: { description: "Edited by an editor" } });
  check(editorNameChange.status === 200 && editorNameChange.data?.description === "Edited by an editor", `but may edit the rest of the record (${editorNameChange.status})`);

  console.log("\nfilters the page offers");
  const filters = await call("GET", "/api/products/filters", { token: admin.token });
  check(filters.status === 200, `the filter list answers (${filters.status})`);
  check((filters.data?.productTypes || []).includes("bundle"), "with the product types");
  check((filters.data?.units || []).includes("hour"), "the units");
  check((filters.data?.categories || []).includes("Networking"), `and the categories actually in use (${(filters.data?.categories || []).slice(0, 3).join(", ")})`);
  const typeTotal = Object.values(filters.data?.countsByType || {}).reduce((s, n) => s + Number(n), 0);
  check(typeTotal === filters.data?.countsByType ? false : typeTotal >= 8, `and a count per type (${typeTotal})`);
  check((filters.data?.lowStock || 0) >= 1, `plus how many items are below their reorder point (${filters.data?.lowStock})`);
  const lowStock = await call("GET", "/api/products?lowStock=true", { token: admin.token });
  check(lowStock.status === 200 && (lowStock.data?.data || []).every(p => p.belowReorderPoint), `the low-stock filter returns only those (${(lowStock.data?.data || []).length})`);
  const byType = await call("GET", "/api/products?type=service", { token: admin.token });
  check((byType.data?.data || []).every(p => p.productType === "service"), `filtering by type works (${(byType.data?.data || []).length} services)`);
  const bySearch = await call("GET", `/api/products?search=${encodeURIComponent(`Probe Firewall ${stamp}`)}`, { token: admin.token });
  check((bySearch.data?.data || []).length === 1 && bySearch.data?.data?.[0]?.id === item.id, `searching by name finds exactly it (${(bySearch.data?.data || []).length})`);
  const bySku = await call("GET", `/api/products?search=${explicitSku.data?.sku}`, { token: admin.token });
  check((bySku.data?.data || []).some(p => p.id === explicitSku.data?.id), "searching by SKU finds it too");
  const inactive = await call("PATCH", `/api/products/${explicitSku.data?.id}`, { token: admin.token, body: { isActive: false } });
  check(inactive.data?.isActive === false, "an item can be deactivated");
  check((await call("GET", "/api/products?active=true", { token: admin.token })).data?.data.every(p => p.isActive), "and the active filter honours it");
  check((await call("GET", "/api/products?active=false", { token: admin.token })).data?.data.some(p => p.id === explicitSku.data?.id), "as does the inactive one");

  console.log("\nstock is only counted for stocked items");
  check((await call("POST", `/api/products/${explicitSku.data?.id}/stock`, { token: admin.token, body: { delta: 1 } })).status === 400, "adjusting an item that is not stock-tracked is refused");
  const restocked = await call("POST", `/api/products/${item.id}/stock`, { token: admin.token, body: { delta: 4, reason: "Delivery" } });
  check(restocked.status === 200 && restocked.data?.stockOnHand === 5, `stock can be received (${restocked.data?.stockOnHand})`);
  check(restocked.data?.belowReorderPoint === false, "which clears the low-stock flag");
  const issued = await call("POST", `/api/products/${item.id}/stock`, { token: admin.token, body: { delta: -5 } });
  check(issued.status === 200 && issued.data?.stockOnHand === 0 && issued.data?.belowReorderPoint === true, `and issued again (${issued.data?.stockOnHand})`);
  check((await call("POST", `/api/products/${item.id}/stock`, { token: admin.token, body: { delta: -1 } })).status === 400, "taking out more than is on hand is refused");
  check((await call("POST", `/api/products/${item.id}/stock`, { token: admin.token, body: { delta: 0 } })).status === 400, "an adjustment of nothing is refused");
  check((await call("POST", `/api/products/${item.id}/stock`, { token: editor.token, body: { delta: 1 } })).status === 403, "and moving stock needs product:manage");

  console.log("\nduplicating an item for a variation");
  const dupe = await call("POST", `/api/products/${item.id}/duplicate`, { token: admin.token });
  check(dupe.status === 201 && /\(copy\)$/.test(dupe.data?.name || ""), `a copy is made (${dupe.data?.name})`);
  check(dupe.data?.sku !== item.sku, `with its own SKU (${dupe.data?.sku})`);
  check(dupe.data?.costPrice === 400 && dupe.data?.stockOnHand === 0, "carrying the prices but not the stock");
  check((await call("DELETE", `/api/products/${dupe.data?.id}`, { token: admin.token })).status === 200, "and an unused copy can be deleted");

  console.log("\nan item in use is deactivated, never deleted");
  const client = await prisma.company.create({ data: { name: `Catalog Probe Client ${stamp}`, companyType: "Client" }, select: { id: true } });
  const quote = await call("POST", "/api/quotes", {
    token: admin.token,
    body: { companyId: client.id, title: "Catalog probe quote", lineItems: [{ description: item.name, quantity: 2, unitPrice: item.sellPrice, productId: item.id }] },
  });
  check(quote.status === 201, `a quote line can come from the catalog (${quote.status})`);
  check(quote.data?.lineItems?.[0]?.productId === item.id, "and remembers which product it was");
  const usage = await call("GET", `/api/products/${item.id}`, { token: admin.token });
  check(usage.data?.usage?.quoteLines === 1, `the product reports where it is used (${usage.data?.usage?.quoteLines} quote line)`);
  const guarded = await call("DELETE", `/api/products/${item.id}`, { token: admin.token });
  check(guarded.status === 409, `deleting it is refused (${guarded.status})`);
  check(/quote line/i.test(guarded.data?.error?.message || ""), `naming the record that holds it (${guarded.data?.error?.message})`);
  const po = await call("POST", "/api/procurement/orders", {
    token: admin.token,
    body: { vendorId: vendor.id, lineItems: [{ description: item.name, quantity: 1, unitPrice: item.costPrice, productId: item.id }] },
  });
  check(po.status === 201 && po.data?.lineItems?.[0]?.productId === item.id, `a purchase-order line keeps the product too (${po.status})`);

  console.log("\nproducts sold on a ticket are billed as their own invoice lines");
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: `CAT-${stamp}`, title: "Catalog probe ticket", boardId: board.id, companyId: client.id,
      createdById: adminUser.id, status: "open", source: "portal",
      customFields: { ticketProducts: [{ productId: item.id, sku: item.sku, name: item.name, qty: 2, unitCost: 700 }] },
    },
    select: { id: true, ticketNumber: true },
  });
  await prisma.serviceAgreement.create({ data: { name: `Catalog probe agreement ${stamp}`, companyId: client.id, agreementType: "spot", hourlyRate: 100, billingAmount: 100, startDate: new Date() } });
  const preview = await call("GET", `/api/billing/invoices/unbilled/${client.id}`, { token: admin.token });
  check(preview.status === 200, `the unbilled preview answers (${preview.status})`);
  check(preview.data?.products?.length === 1 && preview.data?.products?.[0]?.sku === item.sku, `showing the product waiting to be billed (${preview.data?.products?.[0]?.sku})`);
  check(preview.data?.amount === 1400, `and what it is worth (${preview.data?.amount})`);
  const generated = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: admin.token, body: { companyId: client.id } });
  check(generated.status === 201, `an invoice is raised (${generated.status})`);
  check(generated.data?.productsIncluded === 1, `reporting the product it billed (${generated.data?.productsIncluded})`);
  const productLine = (generated.data?.invoice?.lineItems || []).find(li => li.productId === item.id);
  check(!!productLine, "with the line pointing back at the product");
  check(productLine?.description === `${item.name} (${item.sku})`, `described by name and SKU (${productLine?.description})`);
  check(productLine?.quantity === 2 && productLine?.total === 1400, `at the agreed price (${productLine?.quantity} x ${productLine?.unitPrice})`);
  const secondRun = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: admin.token, body: { companyId: client.id } });
  check(secondRun.status === 400, `the same hardware is not billed twice (${secondRun.status})`);

  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { companyId: client.id } } }).catch(() => {});
  await prisma.invoice.deleteMany({ where: { companyId: client.id } });
  await prisma.pOLineItem.deleteMany({ where: { poId: po.data?.id } });
  await prisma.purchaseOrder.deleteMany({ where: { id: po.data?.id } });
  await prisma.quoteLineItem.deleteMany({ where: { quoteId: quote.data?.id } });
  await prisma.quote.deleteMany({ where: { id: quote.data?.id } });
  await prisma.ticketComment.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.ticket.deleteMany({ where: { id: ticket.id } });
  await prisma.serviceAgreement.deleteMany({ where: { companyId: client.id } });
  await prisma.company.delete({ where: { id: client.id } });
  await prisma.product.deleteMany({ where: { id: { in: [item.id, explicitSku.data?.id, recurring.data?.id].filter(Boolean) } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: [adminUser.id, editorUser.id, financeUser.id] } } });
  await prisma.user.delete({ where: { id: editorUser.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: financeUser.id } }).catch(() => {});
  await prisma.role.delete({ where: { id: editorRole.id } }).catch(() => {});
  await prisma.role.delete({ where: { id: financeRole.id } }).catch(() => {});
  await prisma.vendor.delete({ where: { id: vendor.id } }).catch(() => {});
  await prisma.$disconnect();
  console.log("  note  probe products, quote, purchase order, invoice, ticket, client, editor role, finance role and vendor removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
