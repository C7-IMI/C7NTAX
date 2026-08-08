import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const clientsRouter = Router();
clientsRouter.use(authenticate);

// ── List clients (companies) ──
clientsRouter.get("/", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const where: Record<string, unknown> = {};
    const { search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ];
    }
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { name: "asc" },
        include: {
          _count: { select: { users: true, tickets: true, invoices: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);
    res.json({ data: companies, total });
  } catch (e) { next(e); }
});

// ── Get single client ──
clientsRouter.get("/:id", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        users: { select: { id: true, email: true, firstName: true, lastName: true, roleId: true, isActive: true } },
        serviceAgreements: true,
        _count: { select: { tickets: true, invoices: true } },
      },
    });
    if (!company) throw new AppError("Client not found", 404);
    res.json(company);
  } catch (e) { next(e); }
});

// ── Create client ──
clientsRouter.post("/", requirePermission(Permission.ClientCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, email, phone, address, city, state, zip, country, website, notes } = req.body;
    if (!name) throw new AppError("Company name is required");
    const company = await prisma.company.create({
      data: { name, email: email || null, phone: phone || null, address: address || null, city: city || null, state: state || null, zip: zip || null, country: country || "US", website: website || null, notes: notes || null },
    });
    res.status(201).json(company);
  } catch (e) { next(e); }
});

// ── Update client ──
clientsRouter.patch("/:id", requirePermission(Permission.ClientEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "email", "phone", "address", "city", "state", "zip", "country", "website", "notes"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    const company = await prisma.company.update({ where: { id: req.params.id }, data: updates });
    res.json(company);
  } catch (e) { next(e); }
});

// ── Delete client ──
clientsRouter.delete("/:id", requirePermission(Permission.ClientDelete), async (req: AuthRequest, res, next) => {
  try {
    await prisma.company.update({ where: { id: req.params.id }, data: { status: "inactive" } });
    res.json({ message: "Client deactivated" });
  } catch (e) { next(e); }
});

// ── List all contacts across clients ──
clientsRouter.get("/contacts", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, limit = "500", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    const [data, total] = await Promise.all([
      prisma.contact.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { lastName: "asc" }, include: { company: { select: { id: true, name: true } } } }),
      prisma.contact.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) { next(e); }
});

// ── Update contact ──
clientsRouter.patch("/contacts/:id", requirePermission(Permission.ClientEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["firstName","lastName","email","phone","mobile","title","department","notes","isPrimary","isActive"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (req.body.companyId) updates.companyId = req.body.companyId;
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: updates, include: { company: { select: { id: true, name: true } } } });
    res.json(contact);
  } catch (e) { next(e); }
});
