import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const clientsRouter = Router();
clientsRouter.use(authenticate);

// ── List companies / clients ────────────────────────────────────────
clientsRouter.get("/", async (req: AuthRequest, res, next) => {
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

// ── Get single client ────────────────────────────────────────────────
clientsRouter.get("/:id", async (req: AuthRequest, res, next) => {
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
clientsRouter.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { name } = req.body;
    if (!name) throw new AppError("name is required", 400);
    const allowed = ["legalName","taxId","phone","fax","email","billingEmail","website",
      "addressLine1","addressLine2","city","state","postalCode","country",
      "billingAddressLine1","billingAddressLine2","billingCity","billingState","billingPostalCode","billingCountry",
      "notes","isActive","clientType","companyType","industry","territory","region","currency",
      "accountManagerId","primaryContactId","serviceLevel","portalEnabled"];
    const data: Record<string, unknown> = { name };
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const company = await prisma.company.create({ data: data as any });
    res.status(201).json(company);
  } catch (e) { next(e); }
});

// ── Update client ────────────────────────────────────────────────────
clientsRouter.patch("/:id", async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name","legalName","taxId","phone","fax","email","billingEmail","website",
      "addressLine1","addressLine2","city","state","postalCode","country",
      "billingAddressLine1","billingAddressLine2","billingCity","billingState","billingPostalCode","billingCountry",
      "notes","isActive","clientType","companyType","industry","territory","region","currency",
      "accountManagerId","primaryContactId","serviceLevel","portalEnabled"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const company = await prisma.company.update({ where: { id: req.params.id }, data: data as any });
    res.json(company);
  } catch (e) { next(e); }
});

// ── Delete client ────────────────────────────────────────────────────
clientsRouter.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.json({ message: "Client deleted" });
  } catch (e) { next(e); }
});

// ── Get ALL contacts (standalone contacts page) ────────────────────
clientsRouter.get("/contacts", async (req: AuthRequest, res, next) => {
  try {
    const { search, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
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

// ── Get client contacts ──────────────────────────────────────────────
clientsRouter.get("/:id/contacts", async (req: AuthRequest, res, next) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { companyId: req.params.id },
      orderBy: { isPrimary: "desc" },
    });
    res.json({ data: contacts });
  } catch (e) { next(e); }
});
