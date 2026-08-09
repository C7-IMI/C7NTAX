import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

// ── List assets ─────────────────────────────────────────────────────
inventoryRouter.get("/assets", async (req: AuthRequest, res, next) => {
  try {
    const { type, status, companyId, search, category, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (category) where.category = category;
    if (companyId) where.companyId = companyId;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { assetTag: { contains: search } },
        { serialNumber: { contains: search } },
        { manufacturer: { contains: search } },
      ];
    }
    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.asset.count({ where }),
    ]);
    res.json({ data: assets, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get single asset ─────────────────────────────────────────────────
inventoryRouter.get("/assets/:id", async (req: AuthRequest, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
    });
    if (!asset) throw new AppError("Asset not found", 404);
    const assignments = await prisma.assetAssignment.findMany({
      where: { assetId: req.params.id },
      orderBy: { checkedOutAt: "desc" },
    });
    res.json({ ...asset, assignments });
  } catch (e) { next(e); }
});

// ── Create asset ─────────────────────────────────────────────────────
inventoryRouter.post("/assets", async (req: AuthRequest, res, next) => {
  try {
    const { name, assetTag, type } = req.body;
    if (!name || !assetTag || !type) throw new AppError("name, assetTag, and type are required", 400);
    const allowed = ["serialNumber", "model", "manufacturer", "category", "department", "vendor",
      "purchaseDate", "purchasePrice", "purchaseOrder", "warrantyExpiry", "location", "building", "room",
      "companyId", "assignedToId", "costCenter", "depreciationMethod", "usefulLife", "salvageValue",
      "ipAddress", "macAddress", "osName", "osVersion", "installedSoftware", "notes", "customFields"];
    const data: Record<string, unknown> = { name, assetTag, type };
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (req.body.purchaseDate) data.purchaseDate = new Date(req.body.purchaseDate);
    if (req.body.warrantyExpiry) data.warrantyExpiry = new Date(req.body.warrantyExpiry);
    const asset = await prisma.asset.create({ data: data as any });
    res.status(201).json(asset);
  } catch (e) { next(e); }
});

// ── Update asset ─────────────────────────────────────────────────────
inventoryRouter.patch("/assets/:id", async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "assetTag", "serialNumber", "model", "manufacturer", "type", "category",
      "status", "department", "vendor", "purchaseOrder", "location", "building", "room", "companyId",
      "assignedToId", "costCenter", "depreciationMethod", "usefulLife", "salvageValue",
      "ipAddress", "macAddress", "osName", "osVersion", "installedSoftware", "notes", "customFields",
      "purchaseDate", "purchasePrice", "warrantyExpiry"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    if (req.body.purchaseDate) data.purchaseDate = new Date(req.body.purchaseDate);
    if (req.body.warrantyExpiry) data.warrantyExpiry = new Date(req.body.warrantyExpiry);
    if (req.body.purchasePrice !== undefined) data.purchasePrice = Number(req.body.purchasePrice);
    if (req.body.usefulLife !== undefined) data.usefulLife = Number(req.body.usefulLife);
    if (req.body.salvageValue !== undefined) data.salvageValue = Number(req.body.salvageValue);
    const asset = await prisma.asset.update({ where: { id: req.params.id }, data: data as any });
    res.json(asset);
  } catch (e) { next(e); }
});

// ── Delete asset ─────────────────────────────────────────────────────
inventoryRouter.delete("/assets/:id", async (req: AuthRequest, res, next) => {
  try {
    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ message: "Asset deleted" });
  } catch (e) { next(e); }
});

// ── Checkout / assign asset ──────────────────────────────────────────
inventoryRouter.post("/assets/:id/checkout", async (req: AuthRequest, res, next) => {
  try {
    const { assignedToId, ticketId, notes } = req.body;
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) throw new AppError("Asset not found", 404);
    if (asset.status === "assigned") throw new AppError("Asset already assigned", 400);

    await prisma.assetAssignment.create({
      data: { assetId: req.params.id, assignedToId: assignedToId || null, ticketId: ticketId || null, notes },
    });
    await prisma.asset.update({
      where: { id: req.params.id },
      data: { status: "assigned", assignedToId: assignedToId || null },
    });
    res.json({ message: "Asset checked out" });
  } catch (e) { next(e); }
});

// ── Checkin / return asset ───────────────────────────────────────────
inventoryRouter.post("/assignments/:id/checkin", async (req: AuthRequest, res, next) => {
  try {
    const assignment = await prisma.assetAssignment.findUnique({ where: { id: req.params.id } });
    if (!assignment) throw new AppError("Assignment not found", 404);
    await prisma.assetAssignment.update({
      where: { id: req.params.id },
      data: { checkedInAt: new Date() },
    });
    await prisma.asset.update({
      where: { id: assignment.assetId },
      data: { status: "available", assignedToId: null },
    });
    res.json({ message: "Asset checked in" });
  } catch (e) { next(e); }
});

// ── Import assets from CSV ──────────────────────────────────────────
const ASSET_FIELDS = ["name", "assetTag", "type", "category", "status", "serialNumber", "model", "manufacturer", "department", "vendor", "location", "building", "room", "purchaseDate", "purchasePrice", "purchaseOrder", "warrantyExpiry", "costCenter", "depreciationMethod", "usefulLife", "salvageValue", "ipAddress", "macAddress", "osName", "osVersion", "notes"];

inventoryRouter.post("/assets/import", async (req: AuthRequest, res, next) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new AppError("No data rows provided", 400);
    const errors: Array<{ line: number; message: string }> = [];
    const imported: string[] = [];
    const requiredFields = ["name", "assetTag", "type"];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const invalidFields = Object.keys(row).filter(k => !ASSET_FIELDS.includes(k));
      if (invalidFields.length > 0) { errors.push({ line, message: `Unknown field(s): ${invalidFields.join(", ")}` }); continue; }
      const missing = requiredFields.filter(f => !row[f]);
      if (missing.length > 0) { errors.push({ line, message: `Missing required fields: ${missing.join(", ")}` }); continue; }
      const data: Record<string, unknown> = {};
      for (const f of ASSET_FIELDS) { if (row[f] !== undefined && row[f] !== "") data[f] = row[f]; }
      if (row.purchaseDate) data.purchaseDate = new Date(row.purchaseDate);
      if (row.warrantyExpiry) data.warrantyExpiry = new Date(row.warrantyExpiry);
      try {
        await prisma.asset.upsert({ where: { assetTag: row.assetTag }, create: data as any, update: data as any });
        imported.push(row.assetTag);
      } catch (e: any) { errors.push({ line, message: `DB error: ${e.message?.slice(0, 100)}` }); }
    }
    res.json({ success: errors.length === 0 || imported.length > 0, imported, errors, total: rows.length });
  } catch (e) { next(e); }
});
