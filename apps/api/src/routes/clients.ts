import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const clientsRouter = Router();
clientsRouter.use(authenticate);

// ── List companies / clients ────────────────────────────────────────
clientsRouter.get("/", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const { search, status, type, industry, territory, limit = "50", offset = "0", sort = "name" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (status === "active") where.isActive = true;
    if (status === "inactive") where.isActive = false;
    if (type) where.companyType = type;
    if (industry) where.industry = industry;
    if (territory) where.territory = territory;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { legalName: { contains: search } },
        { email: { contains: search } },
        { city: { contains: search } },
        { phone: { contains: search } },
      ];
    }
    const orderField = ["name","createdAt","city","state","industry"].includes(sort) ? sort : "name";
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { [orderField]: "asc" },
        include: {
          _count: { select: { contacts: true, tickets: true, serviceAgreements: true } },
          contacts: { where: { isPrimary: true }, take: 1, select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);
    res.json({ data: companies, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get ALL contacts (standalone contacts page) — MUST be before /:id ─
clientsRouter.get("/contacts", requirePermission(Permission.ContactView), async (req: AuthRequest, res, next) => {
  try {
    const { search, companyId, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }
    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where, skip: Number(offset), take: Number(limit),
        orderBy: { firstName: "asc" },
        include: { company: { select: { id: true, name: true } } },
      }),
      prisma.contact.count({ where }),
    ]);
    res.json({ data: contacts, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Look up who owns an address ──────────────────────────────────────
// Used by the recipient fields to name the organisation an outside address
// actually belongs to, so a warning can say "that is Stark's John Smith".
clientsRouter.get("/contacts/lookup", requirePermission(Permission.ContactView), async (req: AuthRequest, res, next) => {
  try {
    const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
    if (!email) throw new AppError("email is required", 400);
    const contact = await prisma.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, firstName: true, lastName: true, email: true, company: { select: { id: true, name: true } } },
    });
    res.json(contact ?? null);
  } catch (e) { next(e); }
});

// ── Create contact ───────────────────────────────────────────────────
clientsRouter.post("/contacts", requirePermission(Permission.ContactCreate), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, firstName, lastName, email } = req.body;
    if (!companyId || !firstName || !lastName || !email) {
      throw new AppError("companyId, firstName, lastName, email are required", 400);
    }
    const allowed = ["phone","mobile","title","department","notes","isPrimary","isActive"];
    const data: Record<string, unknown> = { companyId, firstName, lastName, email };
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const contact = await prisma.contact.create({ data: data as any, include: { company: { select: { id: true, name: true } } } });
    res.status(201).json(contact);
  } catch (e) { next(e); }
});

// ── Update contact ───────────────────────────────────────────────────
clientsRouter.patch("/contacts/:id", requirePermission(Permission.ContactEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["firstName","lastName","email","phone","mobile","title","department","notes","isPrimary","isActive","companyId"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (Object.keys(data).length === 0) throw new AppError("No fields to update", 400);
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: data as any, include: { company: { select: { id: true, name: true } } } });
    res.json(contact);
  } catch (e) { next(e); }
});

// ── Get single client ────────────────────────────────────────────────
clientsRouter.get("/:id", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        contacts: { orderBy: { isPrimary: "desc" } },
        tickets: { take: 10, orderBy: { createdAt: "desc" }, include: { assignedTo: { select: { firstName: true, lastName: true } } } },
        serviceAgreements: { take: 10, orderBy: { createdAt: "desc" } },
        invoices: { take: 10, orderBy: { createdAt: "desc" } },
        _count: { select: { contacts: true, tickets: true, serviceAgreements: true, invoices: true } },
      },
    });
    if (!company) throw new AppError("Client not found", 404);
    res.json(company);
  } catch (e) { next(e); }
});

// ── Create client ────────────────────────────────────────────────────
clientsRouter.post("/", requirePermission(Permission.ClientCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name } = req.body;
    if (!name) throw new AppError("name is required", 400);
    const allowed = ["legalName","taxId","phone","fax","email","billingEmail","website",
      "addressLine1","addressLine2","city","state","postalCode","country",
      "billingAddressLine1","billingAddressLine2","billingCity","billingState","billingPostalCode","billingCountry",
      "notes","isActive","clientType","companyType","industry","territory","region","currency",
      "accountManagerId","primaryContactId","serviceLevel","portalEnabled","parentId"];
    const data: Record<string, unknown> = { name };
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (data.parentId) {
      const parent = await prisma.company.findUnique({ where: { id: data.parentId as string }, select: { id: true } });
      if (!parent) throw new AppError("Unknown parentId", 400);
    }
    const company = await prisma.company.create({ data: data as any });
    res.status(201).json(company);
  } catch (e) { next(e); }
});

// ── Update client ────────────────────────────────────────────────────
clientsRouter.patch("/:id", requirePermission(Permission.ClientEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name","legalName","taxId","phone","fax","email","billingEmail","website",
      "addressLine1","addressLine2","city","state","postalCode","country",
      "billingAddressLine1","billingAddressLine2","billingCity","billingState","billingPostalCode","billingCountry",
      "notes","isActive","clientType","companyType","industry","territory","region","currency",
      "accountManagerId","primaryContactId","serviceLevel","portalEnabled","parentId"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    // Walking up from the new parent must never reach this client, or the
    // hierarchy would loop.
    if (data.parentId) {
      if (data.parentId === req.params.id) throw new AppError("A client cannot be its own parent", 400);
      let cursor: string | null = data.parentId as string;
      for (let hops = 0; cursor && hops < 50; hops++) {
        if (cursor === req.params.id) throw new AppError("That client is already inside this organization", 400);
        const ancestor: { parentId: string | null } | null =
          await prisma.company.findUnique({ where: { id: cursor }, select: { parentId: true } });
        cursor = ancestor?.parentId ?? null;
      }
    }
    const company = await prisma.company.update({ where: { id: req.params.id }, data: data as any });
    res.json(company);
  } catch (e) { next(e); }
});

// ── Delete client ────────────────────────────────────────────────────
clientsRouter.delete("/:id", requirePermission(Permission.ClientDelete), async (req: AuthRequest, res, next) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.json({ message: "Client deleted" });
  } catch (e) { next(e); }
});

// ── Get a client's service agreements (used by the ticket form) ──────
clientsRouter.get("/:id/agreements", requirePermission(Permission.ServiceAgreementView), async (req: AuthRequest, res, next) => {
  try {
    const agreements = await prisma.serviceAgreement.findMany({
      where: { companyId: req.params.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, billingPeriod: true, billingAmount: true, isActive: true },
    });
    res.json(agreements);
  } catch (e) { next(e); }
});

// ── Get client contacts ──────────────────────────────────────────────
clientsRouter.get("/:id/contacts", requirePermission(Permission.ContactView), async (req: AuthRequest, res, next) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { companyId: req.params.id },
      orderBy: { isPrimary: "desc" },
    });
    res.json({ data: contacts });
  } catch (e) { next(e); }
});

// ── FI-033: Client Kumo summary ────────────────────────────────────
clientsRouter.get("/:id/kumo", requirePermission(Permission.KumoView), authenticate, async (req: AuthRequest, res, next) => {
  try {
    const [assets, passwords, documents, domains, certificates] = await Promise.all([
      prisma.kumoAsset.count({ where: { companyId: req.params.id } }),
      prisma.kumoPassword.count({ where: { companyId: req.params.id } }),
      prisma.kumoDocument.count({ where: { companyId: req.params.id } }),
      prisma.kumoDomain.count({ where: { companyId: req.params.id } }),
      prisma.kumoCertificate.count({ where: { companyId: req.params.id } }),
    ]);
    res.json({ assets, passwords, documents, domains, certificates });
  } catch (e) { next(e); }
});
