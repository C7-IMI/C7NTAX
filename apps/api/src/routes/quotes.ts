import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission, InvoiceStatus } from "@C7NTAX/shared";
import { configFlag } from "../services/appSettings";
import { companyWhere, canAccessCompany } from "../middleware/companyScope";
import { routeParam } from "../middleware/routeParams";
import { escapeHtml } from "../services/emailHtml";
import { brandForDocument } from "../services/brand";
import {
  currencySymbol, daysBetween, formatDate, inkRule, letterhead, metaGrid, metaLine, money, note,
  paginate, paragraph, rateLabel, renderDocument, runHead, section, signatureLines,
  statusMark, tableBlock, totalsBlock,
  type DocTableRow, type DocumentBlock, type DocumentPage, type DocumentStatusTone,
} from "../services/documentHtml";

// Backlog item 1 — Quotes & service catalog. Additive, gated by QUOTES_ENABLED.
export const quotesRouter = Router();

quotesRouter.use((_req, res, next) => {
  if (!configFlag("billing", "quotes")) return res.status(404).json({ error: "Quotes disabled" });
  next();
});
quotesRouter.use(authenticate);

quotesRouter.get("/", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, status } = req.query as Record<string, string>;
    // A company-scoped account sees its own quotes and nothing else, whatever it asks for — the
    // filter below is the caller's *choice*, and this is the floor under it. Internal staff get {}
    // and are unaffected.
    const where: Record<string, unknown> = { ...companyWhere(req.user) };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    const quotes = await prisma.quote.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
      include: { company: { select: { id: true, name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    res.json({ data: quotes });
  } catch (e) { next(e); }
});

quotesRouter.post("/", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, title, contactId, notes, taxRate = 0, lineItems = [] } = req.body;
    if (!companyId || !title) throw new AppError("companyId and title required");
    // A scoped account may only quote for its own company, whatever the body says.
    if (!canAccessCompany(req.user, companyId)) throw new AppError("You can only create quotes for your own company", 403);
    if (!Array.isArray(lineItems) || lineItems.length === 0) throw new AppError("at least one line item required");
    const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}`;
    const items = lineItems.map((li: { description?: string; quantity?: number; unitPrice?: number; productId?: string }, i: number) => {
      const quantity = Number(li.quantity || 1), unitPrice = Number(li.unitPrice || 0);
      return { description: String(li.description || ""), quantity, unitPrice, total: +(quantity * unitPrice).toFixed(2), sortOrder: i, productId: li.productId ? String(li.productId) : null };
    });
    const subtotal = +items.reduce((s, li) => s + li.total, 0).toFixed(2);
    const taxTotal = +(subtotal * (Number(taxRate) || 0)).toFixed(2);
    const quote = await prisma.quote.create({
      data: {
        quoteNumber, companyId, title, contactId: contactId || null, notes: notes || null,
        taxRate: Number(taxRate) || 0, subtotal, taxTotal, total: +(subtotal + taxTotal).toFixed(2),
        status: "draft", createdById: req.user!.userId, lineItems: { create: items },
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(quote);
  } catch (e) { next(e); }
});

quotesRouter.patch("/:id/status", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["draft", "sent", "accepted", "rejected"];
    const status = String(req.body.status || "");
    if (!allowed.includes(status)) throw new AppError("invalid status");
    const existing = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { companyId: true } });
    // 404 rather than 403: an id that exists but is not yours should not be distinguishable from an
    // id that does not exist.
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Quote not found", 404);
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status } });
    res.json(quote);
  } catch (e) { next(e); }
});

quotesRouter.post("/:id/convert", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } });
    if (!quote || !canAccessCompany(req.user, quote.companyId)) throw new AppError("Quote not found", 404);
    if (quote.status === "converted") throw new AppError("Quote already converted");
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber, companyId: quote.companyId, issueDate: new Date(), dueDate,
        subtotal: quote.subtotal, taxRate: quote.taxRate, taxTotal: quote.taxTotal, total: quote.total,
        status: InvoiceStatus.Draft, quoteStatus: "converted", notes: quote.notes,
        lineItems: { create: quote.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })) },
      },
      include: { lineItems: true },
    });
    await prisma.quote.update({ where: { id: quote.id }, data: { status: "converted" } });
    res.status(201).json(invoice);
  } catch (e) { next(e); }
});

// ── The quote, drawn as a proposal ─────────────────────────────────

/**
 * A quote with the lines a document draws, in the order the screen shows them.
 *
 * The client, the contact and the person who prepared it are looked up separately because `Quote` keeps
 * `companyId`, `contactId` and `createdById` as plain strings — the company has a relation, the other two
 * do not.
 */
function quoteForDocument(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, company: true },
  });
}
type QuoteForDocument = NonNullable<Awaited<ReturnType<typeof quoteForDocument>>>;

/** The default length a price holds, used only when the quote's own note does not say. */
const QUOTE_DEFAULT_VALIDITY_DAYS = 30;

/**
 * How long the price holds, and where that answer came from.
 *
 * `Quote` has no expiry column, which is the finding the approved mockup records: the sentence "Valid
 * for 30 days." lives in `notes`, where a document should not have to parse it. When it is there it is
 * honoured, and the document says so; when it is not, the fallback is 30 days from the day the quote was
 * prepared and the document says *that*. A date presented as a record when it is a convention is a
 * promise nobody made.
 */
function quoteValidity(quote: { notes: string | null; createdAt: Date }): { until: Date; sub: string } {
  const stated = quote.notes?.match(/valid\s+for\s+(\d+)\s*days?/i);
  const days = stated ? Number(stated[1]) : QUOTE_DEFAULT_VALIDITY_DAYS;
  const until = new Date(quote.createdAt);
  until.setDate(until.getDate() + days);
  return {
    until,
    sub: stated ? `${days} days, from the quote's own note` : `${days} days from the day this quote was prepared`,
  };
}

/** The word and the mark a proposal wears, which is never the word an invoice wears. */
function quoteStatusLabel(status: string): { label: string; tone: DocumentStatusTone } {
  switch (status) {
    case "accepted": return { label: "Accepted", tone: "paid" };
    case "converted": return { label: "Converted to an invoice", tone: "paid" };
    case "rejected": return { label: "Declined", tone: "plain" };
    case "sent": return { label: "Awaiting your answer", tone: "plain" };
    case "draft": return { label: "Draft", tone: "draft" };
    default: return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "plain" };
  }
}

/**
 * The quote, drawn as a proposal.
 *
 * A quote answers different questions from an invoice and is shaped differently on purpose: it leads with
 * what is proposed in words before it shows a price, states the day the price stops being true, and ends
 * with three ways to answer — accept, ask, or book — instead of one. The one thing it deliberately shares
 * with the invoice is the money grid, because that is where a reader looks for the number.
 */
async function renderQuoteDocument(quote: QuoteForDocument): Promise<string> {
  const brand = await brandForDocument("quote", quote.companyId);
  const size = brand.presentation.pageSize;
  const generatedAt = new Date();
  const company = quote.company;
  const currency = company?.currency ?? "USD";
  const symbol = currencySymbol(currency);

  const [contact, prepared] = await Promise.all([
    quote.contactId ? prisma.contact.findUnique({ where: { id: quote.contactId } }) : null,
    quote.createdById ? prisma.user.findUnique({ where: { id: quote.createdById }, select: { firstName: true, lastName: true, email: true } }) : null,
  ]);

  const subtotal = +quote.subtotal.toFixed(2);
  const taxTotal = +quote.taxTotal.toFixed(2);
  const total = +quote.total.toFixed(2);
  const validity = quoteValidity(quote);
  const status = quoteStatusLabel(quote.status);
  const taxShown = taxTotal !== 0 || quote.taxRate !== 0;
  const jurisdiction = company ? [company.billingCountry || company.country || "", company.billingState || company.state || ""].filter(Boolean).join(" \u00b7 ") : "";
  const location = company ? [company.billingCity || company.city || "", company.billingState || company.state || ""].filter(Boolean).join(", ") : "";
  const lineItems: DocTableRow[] = quote.lineItems.map((line) => ({
    cells: [line.description, Number.isInteger(line.quantity) ? String(line.quantity) : String(+line.quantity.toFixed(2)), `${symbol}${money(line.unitPrice)}`, `${symbol}${money(line.total)}`],
  }));

  // The proposal's own sentence, when the notes carry one that is not the validity clause.
  const prose = quote.notes?.trim() && !/^valid\s+for\s+\d+\s+days?\.?$/i.test(quote.notes.trim()) ? quote.notes.trim() : null;

  const totalsRows: { key: string; value: string; strong?: boolean; rule?: boolean }[] = [
    { key: "Subtotal", value: `${symbol}${money(subtotal)}` },
  ];
  if (taxShown) {
    totalsRows.push({ key: ["Sales tax", rateLabel(quote.taxRate), jurisdiction].filter(Boolean).join(" \u00b7 "), value: `${symbol}${money(taxTotal)}` });
  }
  totalsRows.push({ key: "Total if accepted", value: `${symbol}${money(total)}`, rule: true, strong: true });

  const qrLabel = quote.quoteNumber;
  const answer = [
    { label: "Accept", body: "Reply to the email this came with, and we will record your acceptance", reference: `Quote ref ${qrLabel}` },
    { label: "Ask a question", body: prepared?.email ? `${prepared.firstName} ${prepared.lastName} \u00b7 ${prepared.email}` : brand.contactLine ?? brand.company },
    { label: "Book the work", body: `Contact us quoting ${qrLabel}` },
  ];

  /**
   * Three ways to answer, in a pay block because that is the block that pairs a reference with the ways
   * to settle something — and a proposal's "settle" is "tell us which way you want to go".
   */
  const answerBlock: DocumentBlock = {
    kind: "html",
    mm: 63,
    html: `<div class="dh-pay"><div><h2>Three ways to answer</h2><dl class="dh-pay__ways">${answer
      .map((way) => `<div class="dh-pay__way"><dt>${escapeHtml(way.label)}</dt><dd>${escapeHtml(way.body)}${way.reference ? `<span class="dh-refs dh-mono">${escapeHtml(way.reference)}</span>` : ""}</dd></div>`)
      .join("")}</dl></div><div class="dh-pay__next"><h2>Then what</h2><p class="dh-body" style="margin-top:2mm;">${escapeHtml(`The price above holds until ${formatDate(validity.until)}. After that we will re-quote, because the pricing it is built from is set for the year.`)}</p><div class="dh-portal"><div class="dh-label">Accept, or ask a question</div><div class="dh-url dh-mono">${escapeHtml(prepared?.email ?? brand.contactLine ?? brand.company)}</div></div><p class="dh-small dh-muted" style="margin-top:2.5mm;">Nothing is charged until you accept. If the answer is no, tell us and we will leave it there.</p></div></div>`,
  };

  const pageOne: DocumentBlock[] = [
    letterhead(brand, "Quotation", statusMark(status.label, status.tone)),
    metaGrid([
      { label: "Prepared for", value: company?.name ?? "Client", sub: location || null },
      { label: "Quote", value: quote.quoteNumber, mono: true },
      { label: "Prepared", value: formatDate(quote.createdAt), sub: prepared ? `by ${prepared.firstName} ${prepared.lastName}` : null },
      { label: "Price holds until", value: formatDate(validity.until), sub: validity.sub },
    ]),
    inkRule(),
    metaLine([
      contact ? `Attention <b>${escapeHtml(`${contact.firstName} ${contact.lastName}`)}${contact.title ? `, ${escapeHtml(contact.title)}` : ""}</b> \u00b7 <span class="dh-mono">${escapeHtml(contact.email)}</span>` : null,
      prepared ? `prepared by <b>${escapeHtml(`${prepared.firstName} ${prepared.lastName}`)}</b> \u00b7 <span class="dh-mono">${escapeHtml(prepared.email)}</span>` : null,
    ].filter(Boolean).join(" \u00b7 ")),
    section(quote.title),
    ...(prose ? [paragraph(prose)] : []),
    section("What is proposed", "Itemised"),
    tableBlock({
      columns: [
        { label: "Description" },
        { label: "Qty", align: "right", width: "16mm" },
        { label: "Unit price", align: "right", width: "26mm" },
        { label: "Amount", align: "right", width: "30mm" },
      ],
      rows: lineItems.length > 0 ? lineItems : [{ cells: ["This quote records no line items.", "", "", ""] }],
    }),
    totalsBlock(
      totalsRows,
      "A quotation, not an invoice: nothing is charged until it is accepted.",
    ),
    section("What happens if you say yes"),
    metaGrid([
      { label: "1 \u00b7 Accept", value: "Reply, or accept from the link below", sub: "Nothing is booked until you say so" },
      { label: "2 \u00b7 We confirm", value: "A service order and a start date", sub: "Within one working day" },
      { label: "3 \u00b7 Billing", value: "An invoice when the work starts", sub: "On the terms agreed for the account" },
    ], 3),
    section("Accept, ask, or book"),
    answerBlock,
    ...(quote.status === "draft" ? [note("This quote is a draft and has not been sent. A draft is not an offer.")] : []),
    signatureLines([
      `Accepted for ${company?.name ?? "the client"} \u2014 name, position, date`,
      `${brand.company} \u2014 date`,
    ]),
  ];

  // The whole proposal flows through one paginator: the price and the steps are the summary, and the
  // acceptance follows them. A section heading carries the room for the block it introduces, so the
  // "accept, ask, or book" heading never ends a sheet with its answer overleaf — and a short quote stays
  // on one sheet instead of being forced onto a second.
  const pages: DocumentPage[] = paginate(pageOne, size);
  return renderDocument({
    brand,
    size,
    title: `Quotation ${quote.quoteNumber}`,
    pages,
    continuationHead: (page, total) => runHead(quote.quoteNumber, company?.name ?? "Client", "Quotation", page, total),
    terms: "Quotation \u2014 not an invoice. Confidential; prepared for the client named above.",
    generatedAt,
  });
}

/** The quote drawn as a proposal, so a quote can leave the product at all. */
quotesRouter.get("/:id/pdf", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const quote = await quoteForDocument(routeParam(req, "id"));
    if (!quote || !canAccessCompany(req.user, quote.companyId)) throw new AppError("Quote not found", 404);
    const html = await renderQuoteDocument(quote);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});
