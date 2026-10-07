/**
 * Probe: the invoice renderer escapes hostile line-item, payment and client text.
 * Seeds the hostile rows with Prisma (test setup), then reads the PDF over HTTP.
 * Run from apps/api so @prisma/client resolves:  node <this file>
 */
import { PrismaClient } from "@prisma/client";
const API = "http://127.0.0.1:4000/api";
const prisma = new PrismaClient();
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ""}`); }
}

const login = await fetch(`${API}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@C7NTAX.com", password: "admin" }),
}).then(r => r.json());
const token = login.token;
check("admin signed in", !!token);

const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
const invoice = await prisma.invoice.create({
  data: {
    invoiceNumber: `<b>INV-${Date.now().toString().slice(-6)}</b>`,
    companyId: company.id,
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 86400000),
    subtotal: 10, taxTotal: 0, total: 10,
    lineItems: {
      create: [{
        description: `<img src=x onerror=alert(1)><script>alert(2)</script>`,
        quantity: 1, unitPrice: 10, total: 10,
      }],
    },
    payments: {
      create: [{
        amount: 1,
        method: `"><svg onload=alert(3)>`,
        reference: `<iframe src=javascript:alert(4)>`,
        processedAt: new Date(),
      }],
    },
  },
});
console.log(`seeded invoice ${invoice.id} for ${company.name}`);

const res = await fetch(`${API}/billing/invoices/${invoice.id}/pdf`, { headers: { authorization: `Bearer ${token}` } });
const body = await res.text();
check("the PDF route still answers with HTML", res.status === 200 && /<!DOCTYPE html>/i.test(body), res.status);
check("line-item HTML is escaped", body.includes("&lt;img src=x onerror=alert(1)&gt;") && !body.includes("<img src=x onerror=alert(1)>"));
check("line-item <script> is escaped", body.includes("&lt;script&gt;alert(2)&lt;/script&gt;") && !body.includes("<script>alert(2)</script>"));
check("payment method SVG is escaped", body.includes("&lt;svg onload=alert(3)&gt;") && !body.includes("<svg onload=alert(3)>"));
check("payment reference iframe is escaped", body.includes("&lt;iframe src=javascript:alert(4)&gt;") && !body.includes("<iframe src=javascript:alert(4)>"));
check("invoice number is escaped", body.includes("&lt;b&gt;INV-"));
check("the invoice still renders its real content", /Subtotal/.test(body) && /Total/.test(body) && body.includes("Bill To"));

await prisma.invoice.delete({ where: { id: invoice.id } });
console.log("cleaned up the seeded invoice");
await prisma.$disconnect();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (failures.length) console.log("failed: " + failures.join(" | "));
process.exit(fail ? 1 : 0);
