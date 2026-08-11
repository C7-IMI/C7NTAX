import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { encrypt, decrypt, secureClear } from "../services/kumoCrypto";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

export const kumoRouter = Router();
kumoRouter.use(authenticate);

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATES
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/templates", requirePermission(Permission.KumoAssetView), async (_req: AuthRequest, res, next) => {
  try {
    const templates = await prisma.kumoAssetTemplate.findMany({
      include: { _count: { select: { assets: true, fields: true } } },
      orderBy: { name: "asc" },
    });
    res.json({ data: templates });
  } catch (e) { next(e); }
});

kumoRouter.post("/templates", requirePermission(Permission.KumoAssetManageTemplates), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, icon, color, companyId, fields } = req.body;
    if (!name) throw new AppError("name is required", 400);
    const template = await prisma.kumoAssetTemplate.create({
      data: {
        name, description, icon, color, companyId: companyId || null,
        fields: fields?.length ? {
          create: fields.map((f: any, i: number) => ({
            key: f.key, label: f.label, fieldType: f.fieldType || "text",
            required: f.required || false, options: f.options || null,
            placeholder: f.placeholder, helpText: f.helpText,
            isSensitive: f.isSensitive || false, encrypted: f.encrypted || false,
            sortOrder: i,
          })),
        } : undefined,
      },
      include: { fields: { orderBy: { sortOrder: "asc" } }, _count: { select: { assets: true } } },
    });
    res.status(201).json(template);
  } catch (e) { next(e); }
});

kumoRouter.get("/templates/:id", requirePermission(Permission.KumoAssetView), async (req: AuthRequest, res, next) => {
  try {
    const template = await prisma.kumoAssetTemplate.findUnique({
      where: { id: req.params.id },
      include: { fields: { orderBy: { sortOrder: "asc" } }, _count: { select: { assets: true } } },
    });
    if (!template) throw new AppError("Template not found", 404);
    res.json(template);
  } catch (e) { next(e); }
});

kumoRouter.patch("/templates/:id", requirePermission(Permission.KumoAssetManageTemplates), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, icon, color, isActive, fields } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (color !== undefined) data.color = color;
    if (isActive !== undefined) data.isActive = isActive;

    if (fields) {
      await prisma.kumoTemplateField.deleteMany({ where: { templateId: req.params.id } });
      await prisma.kumoTemplateField.createMany({
        data: fields.map((f: any, i: number) => ({
          templateId: req.params.id,
          key: f.key, label: f.label, fieldType: f.fieldType || "text",
          required: f.required || false, options: f.options || null,
          placeholder: f.placeholder, helpText: f.helpText,
          isSensitive: f.isSensitive || false, encrypted: f.encrypted || false,
          sortOrder: i,
        })),
      });
    }

    const template = await prisma.kumoAssetTemplate.update({
      where: { id: req.params.id },
      data,
      include: { fields: { orderBy: { sortOrder: "asc" } }, _count: { select: { assets: true } } },
    });
    res.json(template);
  } catch (e) { next(e); }
});

kumoRouter.delete("/templates/:id", requirePermission(Permission.KumoAssetManageTemplates), async (req: AuthRequest, res, next) => {
  try {
    const count = await prisma.kumoAsset.count({ where: { templateId: req.params.id } });
    if (count > 0) throw new AppError(`Cannot delete: ${count} assets use this template`, 400);
    await prisma.kumoAssetTemplate.delete({ where: { id: req.params.id } });
    res.json({ message: "Template deleted" });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  ASSETS
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/assets", requirePermission(Permission.KumoAssetView), async (req: AuthRequest, res, next) => {
  try {
    const { templateId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (templateId) where.templateId = templateId;
    if (search) where.name = { contains: search };
    const [assets, total] = await Promise.all([
      prisma.kumoAsset.findMany({
        where,
        skip: Number(offset), take: Number(limit),
        orderBy: { updatedAt: "desc" },
        include: {
          template: { select: { id: true, name: true, icon: true, color: true } },
          fieldValues: { include: { field: true } },
        },
      }),
      prisma.kumoAsset.count({ where }),
    ]);
    const data = assets.map(a => ({
      ...a,
      values: Object.fromEntries(a.fieldValues.map(v => [v.field.key, v.valueText ?? v.valueNum ?? v.valueBool ?? v.valueDate ?? v.valueJson])),
      fieldValues: undefined,
    }));
    res.json({ data, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

kumoRouter.post("/assets", requirePermission(Permission.KumoAssetCreate), async (req: AuthRequest, res, next) => {
  try {
    const { templateId, name, companyId, tags, values } = req.body;
    if (!templateId || !name) throw new AppError("templateId and name are required", 400);

    const template = await prisma.kumoAssetTemplate.findUnique({
      where: { id: templateId },
      include: { fields: true },
    });
    if (!template) throw new AppError("Template not found", 404);

    const asset = await prisma.kumoAsset.create({
      data: {
        templateId, name, companyId: companyId || null,
        tags: tags || [], createdById: req.user!.userId,
        fieldValues: values ? {
          create: Object.entries(values).map(([key, val]) => {
            const field = template.fields.find(f => f.key === key);
            if (!field) return null;
            const fv: Record<string, unknown> = { fieldId: field.id };
            if (field.fieldType === "number") fv.valueNum = Number(val);
            else if (field.fieldType === "boolean") fv.valueBool = Boolean(val);
            else if (field.fieldType === "date") fv.valueDate = new Date(val as string);
            else if (["select", "multi_select", "json"].includes(field.fieldType)) fv.valueJson = val;
            else fv.valueText = String(val);
            return fv;
          }).filter(Boolean) as any,
        } : undefined,
      },
      include: { template: { select: { id: true, name: true, icon: true } }, fieldValues: { include: { field: true } } },
    });
    res.status(201).json({
      ...asset,
      values: Object.fromEntries(asset.fieldValues.map(v => [v.field.key, v.valueText ?? v.valueNum ?? v.valueBool ?? v.valueDate ?? v.valueJson])),
      fieldValues: undefined,
    });
  } catch (e) { next(e); }
});

kumoRouter.get("/assets/:id", requirePermission(Permission.KumoAssetView), async (req: AuthRequest, res, next) => {
  try {
    const asset = await prisma.kumoAsset.findUnique({
      where: { id: req.params.id },
      include: {
        template: { include: { fields: { orderBy: { sortOrder: "asc" } } } },
        fieldValues: { include: { field: true } },
        configServer: true, configWorkstation: true, configNetwork: true,
      },
    });
    if (!asset) throw new AppError("Asset not found", 404);
    res.json({
      ...asset,
      values: Object.fromEntries(asset.fieldValues.map(v => [v.field.key, v.valueText ?? v.valueNum ?? v.valueBool ?? v.valueDate ?? v.valueJson])),
      fieldValues: undefined,
    });
  } catch (e) { next(e); }
});

kumoRouter.patch("/assets/:id", requirePermission(Permission.KumoAssetEdit), async (req: AuthRequest, res, next) => {
  try {
    const { name, status, companyId, tags, values } = req.body;
    const data: Record<string, unknown> = { updatedById: req.user!.userId };
    if (name !== undefined) data.name = name;
    if (status !== undefined) data.status = status;
    if (companyId !== undefined) data.companyId = companyId;
    if (tags !== undefined) data.tags = tags;

    if (values) {
      for (const [key, val] of Object.entries(values)) {
        const field = await prisma.kumoTemplateField.findFirst({
          where: { key, template: { assets: { some: { id: req.params.id } } } },
        });
        if (!field) continue;
        const fv: Record<string, unknown> = {};
        if (field.fieldType === "number") fv.valueNum = Number(val);
        else if (field.fieldType === "boolean") fv.valueBool = Boolean(val);
        else if (field.fieldType === "date") fv.valueDate = new Date(val as string);
        else if (["select", "multi_select", "json"].includes(field.fieldType)) fv.valueJson = val;
        else fv.valueText = String(val);
        await prisma.kumoAssetFieldValue.upsert({
          where: { assetId_fieldId: { assetId: req.params.id, fieldId: field.id } },
          create: { assetId: req.params.id, fieldId: field.id, ...fv },
          update: fv,
        });
      }
    }

    const asset = await prisma.kumoAsset.update({
      where: { id: req.params.id },
      data,
      include: { template: { select: { id: true, name: true } }, fieldValues: { include: { field: true } } },
    });
    res.json({
      ...asset,
      values: Object.fromEntries(asset.fieldValues.map(v => [v.field.key, v.valueText ?? v.valueNum ?? v.valueBool ?? v.valueDate ?? v.valueJson])),
      fieldValues: undefined,
    });
  } catch (e) { next(e); }
});

kumoRouter.delete("/assets/:id", requirePermission(Permission.KumoAssetDelete), async (req: AuthRequest, res, next) => {
  try {
    await prisma.kumoAsset.delete({ where: { id: req.params.id } });
    res.json({ message: "Asset deleted" });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  PASSWORDS — Phase 3 stub
// ═══════════════════════════════════════════════════════════════════
//  PASSWORD VAULT
// ═══════════════════════════════════════════════════════════════════

// Import crypto at top — already done above

kumoRouter.get("/passwords", requirePermission(Permission.KumoPasswordsView), async (req: AuthRequest, res, next) => {
  try {
    const data = await prisma.kumoPassword.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, label: true, username: true, email: true, url: true, category: true, strength: true, companyId: true, totpEnabled: true, expiresAt: true, createdAt: true, updatedAt: true },
      take: 200,
    });
    res.json({ data });
  } catch (e) { next(e); }
});

kumoRouter.get("/passwords/:id", requirePermission(Permission.KumoPasswordsView), async (req: AuthRequest, res, next) => {
  try {
    const pw = await prisma.kumoPassword.findUnique({
      where: { id: req.params.id },
      select: { id: true, label: true, username: true, email: true, url: true, category: true, notes: true, strength: true, totpEnabled: true, passwordPolicy: true, expiresAt: true, companyId: true, createdAt: true, updatedAt: true },
    });
    if (!pw) throw new AppError("Password not found", 404);
    res.json(pw);
  } catch (e) { next(e); }
});

kumoRouter.post("/passwords", requirePermission(Permission.KumoPasswordsCreate), async (req: AuthRequest, res, next) => {
  try {
    const { label, username, password, email, url, category, notes } = req.body;
    if (!label) throw new AppError("label required", 400);
    if (!password) throw new AppError("password required", 400);
    const { ciphertext, iv, authTag } = encrypt(password);
    const pw = await prisma.kumoPassword.create({
      data: { label, username, email, url, category, notes: notes || null, encryptedPassword: ciphertext, encryptionKeyId: "v1", iv, authTag, companyId: req.user!.companyId, createdById: req.user!.userId },
      select: { id: true, label: true, username: true, email: true, url: true, category: true, createdAt: true },
    });
    res.status(201).json(pw);
  } catch (e) { next(e); }
});

kumoRouter.patch("/passwords/:id", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    const data: Record<string, any> = {};
    const allowed = ["label","username","email","url","category","notes","passwordPolicy","expiresAt","isActive"];
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (Object.keys(data).length === 0) throw new AppError("No fields", 400);
    const pw = await prisma.kumoPassword.update({ where: { id: req.params.id }, data, select: { id: true, label: true } });
    res.json(pw);
  } catch (e) { next(e); }
});

kumoRouter.delete("/passwords/:id", requirePermission(Permission.KumoPasswordsDelete), async (req: AuthRequest, res, next) => {
  try {
    await prisma.kumoPassword.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: "Password deactivated" });
  } catch (e) { next(e); }
});

kumoRouter.post("/passwords/:id/reveal", requirePermission(Permission.KumoPasswordsReveal), async (req: AuthRequest, res, next) => {
  try {
    const pw = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    if (!pw) throw new AppError("Not found", 404);
    const plaintext = decrypt(pw.encryptedPassword, pw.iv, pw.authTag);
    // Write access log
    await prisma.kumoPasswordAccessLog.create({
      data: { passwordId: pw.id, accessedById: req.user!.userId, accessType: "reveal", ipAddress: req.ip || req.socket.remoteAddress, userAgent: req.get("User-Agent")?.slice(0, 300) || "", success: true },
    });
    const result = { id: pw.id, label: pw.label, username: pw.username, passwordPlaintext: plaintext };
    // Clear plaintext from memory after response
    setImmediate(() => { secureClear(Buffer.from(plaintext, "utf8")); });
    res.json(result);
  } catch (e) { next(e); }
});

kumoRouter.get("/passwords/:id/access-logs", requirePermission(Permission.KumoPasswordsView), async (req: AuthRequest, res, next) => {
  try {
    const logs = await prisma.kumoPasswordAccessLog.findMany({
      where: { passwordId: req.params.id },
      orderBy: { accessedAt: "desc" },
      take: 100,
    });
    res.json({ data: logs });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  TOTP / 2FA
// ═══════════════════════════════════════════════════════════════════

kumoRouter.post("/passwords/:id/totp/setup", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    const pw = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    if (!pw) throw new AppError("Not found", 404);
    const secret = speakeasy.generateSecret({ name: `Kumo: ${pw.label}` });
    const { ciphertext, iv, authTag } = encrypt(secret.base32);
    // Store all three values delimited so decrypt can use the correct IV/authTag
    await prisma.kumoPassword.update({ where: { id: pw.id }, data: { totpSecret: `${ciphertext}:${iv}:${authTag}`, totpEnabled: true } });
    const qrcode = await QRCode.toDataURL(secret.otpauth_url!);
    res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url, qrcode });
  } catch (e) { next(e); }
});

kumoRouter.post("/passwords/:id/totp/verify", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.body;
    if (!code) throw new AppError("code required", 400);
    const pw = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    if (!pw || !pw.totpSecret) throw new AppError("TOTP not configured", 400);
    const secret = decrypt(pw.totpSecret, pw.iv, pw.authTag);
    const valid = speakeasy.totp.verify({ secret, encoding: "base32", token: code, window: 1 });
    if (!valid) throw new AppError("Invalid code", 400);
    await prisma.kumoPasswordAccessLog.create({
      data: { passwordId: pw.id, accessedById: req.user!.userId, accessType: "totp_verify", ipAddress: req.ip || req.socket.remoteAddress, success: true },
    });
    res.json({ verified: true });
  } catch (e) { next(e); }
});

kumoRouter.get("/passwords/:id/totp", requirePermission(Permission.KumoPasswordsView), async (req: AuthRequest, res, next) => {
  try {
    const pw = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    if (!pw || !pw.totpSecret || !pw.totpEnabled) return res.json({ enabled: false });
    const secret = decrypt(pw.totpSecret, pw.iv, pw.authTag);
    const token = speakeasy.totp({ secret, encoding: "base32" });
    const remaining = 30 - Math.floor(Date.now() / 1000) % 30;
    res.json({ enabled: true, code: token, remaining });
  } catch { res.json({ enabled: false }); }
});

kumoRouter.delete("/passwords/:id/totp", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    await prisma.kumoPassword.update({ where: { id: req.params.id }, data: { totpSecret: null, totpEnabled: false } });
    res.json({ message: "TOTP removed" });
  } catch (e) { next(e); }
});

kumoRouter.post("/passwords/:id/totp/manual", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    const { secret } = req.body;
    if (!secret || !/^[A-Z2-7]+=*$/i.test(secret)) throw new AppError("Invalid base32 secret", 400);
    const { ciphertext } = encrypt(secret.toUpperCase());
    await prisma.kumoPassword.update({ where: { id: req.params.id }, data: { totpSecret: ciphertext, totpEnabled: true } });
    const token = speakeasy.totp({ secret: secret.toUpperCase(), encoding: "base32" });
    const remaining = 30 - Math.floor(Date.now() / 1000) % 30;
    res.json({ enabled: true, code: token, remaining });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  LINKS
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/links", requirePermission(Permission.KumoLinkView), async (req: AuthRequest, res, next) => {
  try {
    const { sourceType, sourceId } = req.query as Record<string, string>;
    const where: any = {};
    if (sourceType && sourceId) { where.sourceType = sourceType; where.sourceId = sourceId; }
    const links = await prisma.kumoLink.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ data: links });
  } catch (e) { next(e); }
});

kumoRouter.post("/links", requirePermission(Permission.KumoLinkManage), async (req: AuthRequest, res, next) => {
  try {
    const { sourceType, sourceId, targetType, targetId, relationship, label, notes } = req.body;
    if (!sourceType || !sourceId || !targetType || !targetId) throw new AppError("sourceType, sourceId, targetType, targetId required", 400);
    const link = await prisma.kumoLink.create({
      data: { sourceType, sourceId, targetType, targetId, relationship: relationship || "related_to", label: label || null, notes: notes || null, createdById: req.user!.userId },
    });
    res.status(201).json(link);
  } catch (e) { next(e); }
});

kumoRouter.delete("/links/:id", requirePermission(Permission.KumoLinkManage), async (req: AuthRequest, res, next) => {
  try { await prisma.kumoLink.delete({ where: { id: req.params.id } }); res.json({ message: "Link removed" }); }
  catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  CONFIGS
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/configs/servers", requirePermission(Permission.KumoConfigView), async (_req: AuthRequest, res, next) => {
  try {
    const data = await prisma.kumoServer.findMany({ include: { kumoAsset: { select: { id: true, name: true } } }, take: 200 });
    res.json({ data });
  } catch (e) { next(e); }
});

kumoRouter.post("/configs/servers", requirePermission(Permission.KumoConfigCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, hostname, templateId, ...fields } = req.body;
    if (!name || !hostname || !templateId) throw new AppError("name, hostname, templateId required", 400);
    const asset = await prisma.kumoAsset.create({ data: { name, templateId, companyId: req.user!.companyId, createdById: req.user!.userId } });
    const server = await prisma.kumoServer.create({ data: { kumoAssetId: asset.id, hostname, ...fields } });
    res.status(201).json({ ...asset, server });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  DOCUMENTS
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/documents/folders", requirePermission(Permission.KumoDocumentView), async (req: AuthRequest, res, next) => {
  try {
    const folders = await prisma.kumoFolder.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { documents: true } } } });
    res.json({ data: folders });
  } catch (e) { next(e); }
});

kumoRouter.post("/documents/folders", requirePermission(Permission.KumoDocumentCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, parentId } = req.body;
    if (!name) throw new AppError("name required", 400);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const folder = await prisma.kumoFolder.create({ data: { name, slug, parentId: parentId || null, companyId: req.user!.companyId } });
    res.status(201).json(folder);
  } catch (e) { next(e); }
});

kumoRouter.get("/documents", requirePermission(Permission.KumoDocumentView), async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.query as Record<string, string>;
    const where: any = {};
    if (folderId) where.folderId = folderId;
    const docs = await prisma.kumoDocument.findMany({ where, orderBy: { sortOrder: "asc" }, take: 200 });
    res.json({ data: docs });
  } catch (e) { next(e); }
});

kumoRouter.get("/documents/:id", requirePermission(Permission.KumoDocumentView), async (req: AuthRequest, res, next) => {
  try {
    const doc = await prisma.kumoDocument.findUnique({ where: { id: req.params.id }, include: { folder: true } });
    if (!doc) throw new AppError("Not found", 404);
    const revisions = await prisma.kumoDocumentRevision.findMany({
      where: { documentId: doc.id }, orderBy: { version: "desc" },
      select: { id: true, version: true, changeLog: true, authorId: true, createdAt: true }, take: 20,
    });
    res.json({ ...doc, revisions });
  } catch (e) { next(e); }
});

kumoRouter.post("/documents", requirePermission(Permission.KumoDocumentCreate), async (req: AuthRequest, res, next) => {
  try {
    const { title, content, folderId, visibility } = req.body;
    if (!title || !content) throw new AppError("title and content required", 400);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
    const doc = await prisma.kumoDocument.create({
      data: { title, slug, currentContent: content, currentVersion: 1, folderId: folderId || null, visibility: visibility || "internal", companyId: req.user!.companyId, authorId: req.user!.userId },
    });
    await prisma.kumoDocumentRevision.create({ data: { documentId: doc.id, version: 1, content, authorId: req.user!.userId } });
    res.status(201).json(doc);
  } catch (e) { next(e); }
});

kumoRouter.patch("/documents/:id", requirePermission(Permission.KumoDocumentEdit), async (req: AuthRequest, res, next) => {
  try {
    const { title, content, changeLog, folderId, visibility, status } = req.body;
    const data: any = {};
    if (title !== undefined) { data.title = title; data.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36); }
    if (content !== undefined) { data.currentContent = content; data.currentVersion = { increment: 1 }; data.lastEditorId = req.user!.userId; }
    if (folderId !== undefined) data.folderId = folderId;
    if (visibility !== undefined) data.visibility = visibility;
    if (status !== undefined) data.status = status;
    const doc = await prisma.kumoDocument.update({ where: { id: req.params.id }, data });
    if (content !== undefined) {
      await prisma.kumoDocumentRevision.create({ data: { documentId: doc.id, version: doc.currentVersion, content, changeLog: changeLog || null, authorId: req.user!.userId } });
    }
    res.json(doc);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/dashboard", requirePermission(Permission.KumoView), async (_req: AuthRequest, res, next) => {
  try {
    const [assets, passwords, configs, documents, links] = await Promise.all([
      prisma.kumoAsset.count(),
      prisma.kumoPassword.count(),
      prisma.kumoServer.count(),
      prisma.kumoDocument.count(),
      prisma.kumoLink.count(),
    ]);
    res.json({ assets, passwords, configs, documents, links });
  } catch (e) { next(e); }
});

// ── FI-035: File Manager ───────────────────────────────────────────
kumoRouter.get("/files", requirePermission(Permission.KumoAssetView), async (req: AuthRequest, res, next) => {
  try {
    const files = await prisma.kumoFile.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ data: files });
  } catch (e) { next(e); }
});

kumoRouter.post("/files/upload", requirePermission(Permission.KumoAssetCreate), async (req: AuthRequest, res, next) => {
  try {
    const { filename, mimeType, size, storagePath, entityType, entityId, companyId } = req.body;
    if (!filename) throw new AppError("filename required", 400);
    const file = await prisma.kumoFile.create({
      data: { filename, mimeType: mimeType || "application/octet-stream", size: size || 0, storagePath: storagePath || filename, entityType, entityId, companyId, uploadedById: req.user!.userId },
    });
    res.status(201).json(file);
  } catch (e) { next(e); }
});

kumoRouter.delete("/files/:id", requirePermission(Permission.KumoAssetDelete), async (req: AuthRequest, res, next) => {
  try { await prisma.kumoFile.delete({ where: { id: req.params.id } }); res.json({ message: "Deleted" }); }
  catch (e) { next(e); }
});

// ── Recently Viewed Items ───────────────────────────────────────────

kumoRouter.get("/recently-viewed", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const items = await prisma.recentlyViewedItem.findMany({
      where: { userId: req.user!.userId },
      orderBy: { viewedAt: "desc" },
      take: 20,
    });
    res.json({ data: items });
  } catch (e) { next(e); }
});

kumoRouter.post("/recently-viewed", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const { entityType, entityId, entityName, entityIcon } = req.body;
    if (!entityType || !entityId || !entityName) throw new AppError("entityType, entityId, and entityName are required", 400);
    const validTypes = ["password", "config", "asset", "document", "domain", "certificate", "link"];
    if (!validTypes.includes(entityType)) throw new AppError(`Invalid entityType. Must be one of: ${validTypes.join(", ")}`, 400);
    const item = await prisma.recentlyViewedItem.upsert({
      where: { userId_entityType_entityId: { userId: req.user!.userId, entityType, entityId } },
      create: { userId: req.user!.userId, entityType, entityId, entityName, entityIcon: entityIcon || "document" },
      update: { entityName, entityIcon: entityIcon || "document", viewedAt: new Date() },
    });
    res.status(201).json(item);
  } catch (e) { next(e); }
});
