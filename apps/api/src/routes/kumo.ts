import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, passwordStrengthLevel } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { encrypt, decrypt, secureClear } from "../services/kumoCrypto";
import { recordKumoAudit, kumoAuditTrail, changedFields } from "../services/kumoAudit";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

export const kumoRouter = Router();
kumoRouter.use(authenticate);

/**
 * Which organization a new record belongs to. An explicitly chosen client wins;
 * otherwise the record follows the creating user's own company. Unknown ids are
 * rejected rather than written, since companyId is a foreign key.
 */
async function resolveCompanyId(requested: unknown, fallback: string | null | undefined): Promise<string | null> {
  if (typeof requested === "string" && requested.trim()) {
    const company = await prisma.company.findUnique({ where: { id: requested.trim() }, select: { id: true } });
    if (!company) throw new AppError("Unknown companyId", 400);
    return company.id;
  }
  return fallback ?? null;
}

/** Whether the audited item still exists — an unknown id should read as 404, not an empty trail. */
async function kumoItemExists(itemType: string, itemId: string): Promise<boolean> {
  switch (itemType) {
    case "password": return !!(await prisma.kumoPassword.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "document": return !!(await prisma.kumoDocument.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "asset": return !!(await prisma.kumoAsset.findUnique({ where: { id: itemId }, select: { id: true } }));
    case "config": return !!(await prisma.kumoServer.findUnique({ where: { id: itemId }, select: { id: true } }));
    default: return false;
  }
}

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
    const { templateId, companyId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (templateId) where.templateId = templateId;
    if (companyId) where.companyId = companyId;
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
        templateId, name, companyId: await resolveCompanyId(companyId, req.user!.companyId),
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
    // The client is a plain id on this model, so it is named here for the
    // record's breadcrumb rather than through a relation.
    const company = asset.companyId
      ? await prisma.company.findUnique({ where: { id: asset.companyId }, select: { id: true, name: true } })
      : null;
    res.json({
      ...asset,
      company,
      values: Object.fromEntries(asset.fieldValues.map((v) => [v.field.key, v.valueText ?? v.valueNum ?? v.valueBool ?? v.valueDate ?? v.valueJson])),
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
    const { strength } = req.query as Record<string, string>;
    const rows = await prisma.kumoPassword.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, label: true, username: true, email: true, url: true, category: true, strength: true,
        companyId: true, totpEnabled: true, expiresAt: true, createdAt: true, updatedAt: true,
        encryptedPassword: true, iv: true, authTag: true,
      },
      take: 200,
    });
    // The ciphertext is dropped in both paths; strength is only scored when a
    // strength filter is asked for, which is the one case that needs plaintext.
    const data = rows.map(({ encryptedPassword, iv, authTag, ...rest }) => {
      if (!strength) return rest as Record<string, unknown>;
      let plaintext = "";
      try { plaintext = decrypt(encryptedPassword, iv, authTag); } catch { plaintext = ""; }
      const computedStrength = !plaintext || plaintext.startsWith("ENC:") ? "Not evaluated" : passwordStrengthLevel(plaintext);
      return { ...rest, computedStrength } as Record<string, unknown>;
    });
    res.json({ data: strength ? data.filter((p) => p.computedStrength === strength) : data });
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
    const { label, username, password, email, url, category, notes, companyId } = req.body;
    if (!label) throw new AppError("label required", 400);
    if (!password) throw new AppError("password required", 400);
    const { ciphertext, iv, authTag } = encrypt(password);
    const ownerCompanyId = await resolveCompanyId(companyId, req.user!.companyId);
    const pw = await prisma.kumoPassword.create({
      data: { label, username, email, url, category, notes: notes || null, encryptedPassword: ciphertext, encryptionKeyId: "v1", iv, authTag, companyId: ownerCompanyId, createdById: req.user!.userId },
      select: { id: true, label: true, username: true, email: true, url: true, category: true, createdAt: true },
    });
    res.status(201).json(pw);
    void recordKumoAudit({ itemType: "password", itemId: pw.id, action: "created", userId: req.user!.userId, summary: `Created "${label}"` });
  } catch (e) { next(e); }
});

kumoRouter.patch("/passwords/:id", requirePermission(Permission.KumoPasswordsEdit), async (req: AuthRequest, res, next) => {
  try {
    const data: Record<string, any> = {};
    const allowed = ["label","username","email","url","category","notes","passwordPolicy","expiresAt","isActive"];
    for (const k of allowed) if (req.body[k] !== undefined && req.body[k] !== null) data[k] = req.body[k];
    // Handle password change — encrypt new value
    const newPwd = req.body.password;
    if (newPwd && typeof newPwd === "string" && newPwd.length > 0) {
      const encPwd = encrypt(newPwd);
      data.encryptedPassword = encPwd.ciphertext;
      data.iv = encPwd.iv;
      data.authTag = encPwd.authTag;
    }
    if (Object.keys(data).length === 0) throw new AppError("No fields to update", 400);
    data.updatedById = req.user!.userId;
    const before = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    const pw = await prisma.kumoPassword.update({ where: { id: req.params.id }, data, select: { id: true, label: true } });
    // The trail names the fields that moved; it never carries the new secret.
    const changed = changedFields((before ?? {}) as Record<string, unknown>, data)
      .map(field => (field === "encryptedPassword" || field === "iv" || field === "authTag" ? "password" : field));
    void recordKumoAudit({
      itemType: "password",
      itemId: pw.id,
      action: "updated",
      userId: req.user!.userId,
      summary: `Updated ${[...new Set(changed)].join(", ") || "nothing"}`,
      details: { fields: [...new Set(changed)] },
    });
    res.json(pw);
  } catch (e) { next(e); }
});

kumoRouter.delete("/passwords/:id", requirePermission(Permission.KumoPasswordsDelete), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    await prisma.kumoPassword.update({ where: { id }, data: { isActive: false } });
    void recordKumoAudit({ itemType: "password", itemId: id, action: "deleted", userId: req.user!.userId, summary: "Deactivated" });
    res.json({ message: "Password deactivated" });
  } catch (e) { next(e); }
});

kumoRouter.post("/passwords/:id/reveal", requirePermission(Permission.KumoPasswordsReveal), async (req: AuthRequest, res, next) => {
  try {
    const pw = await prisma.kumoPassword.findUnique({ where: { id: req.params.id } });
    if (!pw) throw new AppError("Not found", 404);
    // Show who last changed it — fall back to creator if never updated
    let updatedByName: string | null = null;
    const lookupId = pw.updatedById || pw.createdById;
    if (lookupId) {
      const u = await prisma.user.findUnique({ where: { id: lookupId }, select: { firstName: true, lastName: true } });
      if (u) updatedByName = `${u.firstName} ${u.lastName}`;
    }
    let plaintext: string;
    try {
      plaintext = decrypt(pw.encryptedPassword, pw.iv, pw.authTag);
    } catch {
      plaintext = pw.encryptedPassword.startsWith("ENC:")
        ? "[Seed data — re-encrypt this password to use it]"
        : "[Unable to decrypt]";
    }
    // Write access log
    await prisma.kumoPasswordAccessLog.create({
      data: { passwordId: pw.id, accessedById: req.user!.userId, accessType: "reveal", ipAddress: req.ip || req.socket.remoteAddress, userAgent: req.get("User-Agent")?.slice(0, 300) || "", success: true },
    });
    void recordKumoAudit({ itemType: "password", itemId: pw.id, action: "revealed", userId: req.user!.userId, summary: `Revealed "${pw.label}"` });
    const result = { id: pw.id, label: pw.label, username: pw.username, passwordPlaintext: plaintext, updatedBy: updatedByName };
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

/**
 * The shared trail for one item — who touched this credential or document, and what they did.
 * Behind the same view permission as the item itself; the caller has already been scoped to the
 * client by the item they can see, and entries carry no secret material.
 */
kumoRouter.get("/audit/:itemType/:itemId", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const itemType = String(req.params.itemType ?? "");
    const itemId = String(req.params.itemId ?? "");
    if (!itemType || !itemId) throw new AppError("itemType and itemId are required", 400);
    const limit = Number(req.query.limit ?? 50);
    if (!(await kumoItemExists(itemType, itemId))) throw new AppError("Not found", 404);
    res.json({ data: await kumoAuditTrail(itemType, itemId, Number.isFinite(limit) ? limit : 50) });
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
    const parts = pw.totpSecret.split(":");
    const [ciphertext, iv, authTag] = parts.length === 3 ? parts : [pw.totpSecret, pw.iv, pw.authTag];
    const secret = decrypt(ciphertext, iv, authTag);
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
    const parts = pw.totpSecret.split(":");
    const [ciphertext, iv, authTag] = parts.length === 3 ? parts : [pw.totpSecret, pw.iv, pw.authTag];
    const secret = decrypt(ciphertext, iv, authTag);
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
    const { ciphertext, iv, authTag } = encrypt(secret.toUpperCase());
    await prisma.kumoPassword.update({ where: { id: req.params.id }, data: { totpSecret: `${ciphertext}:${iv}:${authTag}`, totpEnabled: true } });
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
    const data = await prisma.kumoServer.findMany({ include: { kumoAsset: { select: { id: true, name: true, companyId: true } } }, take: 200 });
    res.json({ data });
  } catch (e) { next(e); }
});

kumoRouter.post("/configs/servers", requirePermission(Permission.KumoConfigCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, hostname, templateId, companyId, ...fields } = req.body;
    if (!name || !hostname || !templateId) throw new AppError("name, hostname, templateId required", 400);
    const ownerCompanyId = await resolveCompanyId(companyId, req.user!.companyId);
    const asset = await prisma.kumoAsset.create({ data: { name, templateId, companyId: ownerCompanyId, createdById: req.user!.userId } });
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
    const { name, parentId, companyId } = req.body;
    if (!name) throw new AppError("name required", 400);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const ownerCompanyId = await resolveCompanyId(companyId, req.user!.companyId);
    const folder = await prisma.kumoFolder.create({ data: { name, slug, parentId: parentId || null, companyId: ownerCompanyId } });
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
    const { title, content, folderId, visibility, companyId } = req.body;
    if (!title || !content) throw new AppError("title and content required", 400);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
    const doc = await prisma.kumoDocument.create({
      data: { title, slug, currentContent: content, currentVersion: 1, folderId: folderId || null, visibility: visibility || "internal", companyId: await resolveCompanyId(companyId, req.user!.companyId), authorId: req.user!.userId },
    });
    await prisma.kumoDocumentRevision.create({ data: { documentId: doc.id, version: 1, content, authorId: req.user!.userId } });
    void recordKumoAudit({ itemType: "document", itemId: doc.id, action: "created", userId: req.user!.userId, summary: `Created "${title}" (v1)` });
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
    const touched = [title !== undefined ? "title" : null, content !== undefined ? "content" : null, folderId !== undefined ? "folder" : null, visibility !== undefined ? "visibility" : null, status !== undefined ? "status" : null].filter((f): f is string => !!f);
    void recordKumoAudit({
      itemType: "document",
      itemId: doc.id,
      action: "updated",
      userId: req.user!.userId,
      summary: `${touched.length ? `Updated ${touched.join(", ")}` : "Updated"} — v${doc.currentVersion}${changeLog ? `: ${changeLog}` : ""}`,
      details: { fields: touched, version: doc.currentVersion, changeLog: changeLog ?? null },
    });
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
    const validTypes = ["password", "config", "asset", "document", "domain", "certificate", "link", "organization"];
    if (!validTypes.includes(entityType)) throw new AppError(`Invalid entityType. Must be one of: ${validTypes.join(", ")}`, 400);
    const item = await prisma.recentlyViewedItem.upsert({
      where: { userId_entityType_entityId: { userId: req.user!.userId, entityType, entityId } },
      create: { userId: req.user!.userId, entityType, entityId, entityName, entityIcon: entityIcon || "document" },
      update: { entityName, entityIcon: entityIcon || "document", viewedAt: new Date() },
    });
    res.status(201).json(item);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  DOMAINS & CERTIFICATES — one list, since both are expiry-driven
// ═══════════════════════════════════════════════════════════════════

const UPCOMING_EXPIRY_DAYS = 90;

kumoRouter.get("/domains", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const { filter = "all", companyId } = req.query as Record<string, string>;
    const where = companyId ? { companyId } : {};
    const [domains, certificates] = await Promise.all([
      prisma.kumoDomain.findMany({ where, orderBy: { expiryDate: "asc" }, take: 200 }),
      prisma.kumoCertificate.findMany({ where, orderBy: { expiryDate: "asc" }, take: 200 }),
    ]);

    const companyIds = [...new Set([...domains, ...certificates].map((r) => r.companyId).filter((c): c is string => !!c))];
    const companies = companyIds.length
      ? await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : [];
    const companyNames = new Map(companies.map((c) => [c.id, c.name]));

    const now = Date.now();
    const upcomingBefore = now + UPCOMING_EXPIRY_DAYS * 86_400_000;
    const data = [
      ...certificates.map((c) => ({
        kind: "Certificate", id: c.id, name: c.name, target: c.domain, issuer: c.issuer,
        expiryDate: c.expiryDate, autoRenew: c.autoRenew, companyId: c.companyId, companyName: c.companyId ? companyNames.get(c.companyId) ?? null : null,
      })),
      ...domains.map((d) => ({
        kind: "Domain", id: d.id, name: d.domainName, target: d.domainName, issuer: d.registrar,
        expiryDate: d.expiryDate, autoRenew: d.autoRenew, companyId: d.companyId, companyName: d.companyId ? companyNames.get(d.companyId) ?? null : null,
      })),
    ]
      .filter((r) => {
        if (filter === "expired") return !!r.expiryDate && r.expiryDate.getTime() < now;
        if (filter === "upcoming") return !!r.expiryDate && r.expiryDate.getTime() >= now && r.expiryDate.getTime() <= upcomingBefore;
        return true;
      })
      .sort((a, b) => (a.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER));

    res.json({ data, total: data.length, upcomingDays: UPCOMING_EXPIRY_DAYS });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
//  ORGANIZATIONS — the client list, with its Kumo documentation coverage
// ═══════════════════════════════════════════════════════════════════

kumoRouter.get("/organizations", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const { search = "", limit = "200", offset = "0", sort = "name", companyType = "" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (companyType) where.companyType = companyType;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { legalName: { contains: search } },
        { city: { contains: search } },
        { industry: { contains: search } },
      ];
    }
    const orderField = ["name", "companyType", "createdAt", "city", "industry"].includes(sort) ? sort : "name";

    // One grouped count per documentation type, then merged onto the page of
    // organizations — this keeps it to a fixed number of queries rather than
    // one lookup per row.
    const [companies, total, assetRows, passwordRows, documentRows, domainRows, certificateRows] = await Promise.all([
      prisma.company.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { [orderField]: "asc" },
        select: {
          id: true, name: true, companyType: true, industry: true, city: true, state: true,
          isActive: true, updatedAt: true,
          _count: { select: { contacts: true, tickets: true, serviceAgreements: true } },
        },
      }),
      prisma.company.count({ where }),
      prisma.kumoAsset.groupBy({ by: ["companyId"], _count: { _all: true } }),
      prisma.kumoPassword.groupBy({ by: ["companyId"], _count: { _all: true } }),
      prisma.kumoDocument.groupBy({ by: ["companyId"], _count: { _all: true } }),
      prisma.kumoDomain.groupBy({ by: ["companyId"], _count: { _all: true } }),
      prisma.kumoCertificate.groupBy({ by: ["companyId"], _count: { _all: true } }),
    ]);

    const toMap = (rows: { companyId: string | null; _count: { _all: number } }[]) => {
      const map = new Map<string, number>();
      for (const row of rows) if (row.companyId) map.set(row.companyId, row._count._all);
      return map;
    };
    const assets = toMap(assetRows);
    const passwords = toMap(passwordRows);
    const documents = toMap(documentRows);
    const domains = toMap(domainRows);
    const certificates = toMap(certificateRows);

    res.json({
      data: companies.map((c) => ({
        ...c,
        kumo: {
          assets: assets.get(c.id) ?? 0,
          passwords: passwords.get(c.id) ?? 0,
          documents: documents.get(c.id) ?? 0,
          domains: domains.get(c.id) ?? 0,
          certificates: certificates.get(c.id) ?? 0,
        },
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (e) { next(e); }
});

// ── One organization: the documentation dashboard behind a client ─────
// Everything the organization screen shows, aggregated for a single company
// in one round trip: vault strength, documentation health, recents, contacts,
// popular passwords, expirations, recent activity and sub-organizations.

/** A document untouched for this long counts as stale. */
const STALE_DOCUMENT_DAYS = 90;
/** created/updated within this window is reported as a creation. */
const CREATED_WINDOW_MS = 60_000;

kumoRouter.get("/organizations/:id", requirePermission(Permission.KumoView), async (req: AuthRequest, res, next) => {
  try {
    const companyId = req.params.id;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DOCUMENT_DAYS * 86_400_000);

    const org = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, companyType: true, industry: true, territory: true, region: true,
        phone: true, email: true, website: true, addressLine1: true, addressLine2: true,
        city: true, state: true, postalCode: true, country: true, notes: true, isActive: true,
        serviceLevel: true, portalEnabled: true, parentId: true, createdAt: true, updatedAt: true,
        _count: { select: { contacts: true, tickets: true, serviceAgreements: true, invoices: true } },
      },
    });
    if (!org) throw new AppError("Organization not found", 404);

    const [
      assetCount, passwordCount, documentCount, domainCount, certificateCount,
      staleDocuments, unviewedDocuments, expiredCertificates, expiredDomains,
      passwords, documents, certificates, domains, recentAssets, children, contacts, recentItems,
    ] = await Promise.all([
      prisma.kumoAsset.count({ where: { companyId } }),
      prisma.kumoPassword.count({ where: { companyId } }),
      prisma.kumoDocument.count({ where: { companyId } }),
      prisma.kumoDomain.count({ where: { companyId } }),
      prisma.kumoCertificate.count({ where: { companyId } }),
      prisma.kumoDocument.count({ where: { companyId, updatedAt: { lt: staleBefore } } }),
      prisma.kumoDocument.count({ where: { companyId, viewCount: 0 } }),
      prisma.kumoCertificate.count({ where: { companyId, expiryDate: { lt: now } } }),
      prisma.kumoDomain.count({ where: { companyId, expiryDate: { lt: now } } }),
      prisma.kumoPassword.findMany({
        where: { companyId },
        select: {
          id: true, label: true, username: true, url: true, expiresAt: true, createdAt: true, updatedAt: true,
          createdById: true, updatedById: true, encryptedPassword: true, iv: true, authTag: true,
          _count: { select: { accessLogs: true } },
        },
        orderBy: [{ accessLogs: { _count: "desc" } }, { label: "asc" }],
      }),
      prisma.kumoDocument.findMany({
        where: { companyId },
        select: { id: true, title: true, status: true, updatedAt: true, createdAt: true, authorId: true, lastEditorId: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.kumoCertificate.findMany({
        where: { companyId },
        select: { id: true, name: true, domain: true, expiryDate: true, createdAt: true, updatedAt: true },
        orderBy: { expiryDate: "asc" },
      }),
      prisma.kumoDomain.findMany({
        where: { companyId },
        select: { id: true, domainName: true, expiryDate: true, createdAt: true, updatedAt: true },
        orderBy: { domainName: "asc" },
      }),
      prisma.kumoAsset.findMany({
        where: { companyId },
        select: { id: true, name: true, createdAt: true, updatedAt: true, createdById: true, updatedById: true },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
      prisma.company.findMany({
        where: { parentId: companyId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, companyType: true, city: true, state: true, isActive: true },
      }),
      prisma.contact.findMany({
        where: { companyId },
        orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
        take: 6,
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, isPrimary: true },
      }),
      prisma.recentlyViewedItem.findMany({
        where: { userId: req.user!.userId },
        orderBy: { viewedAt: "desc" },
        take: 20,
      }),
    ]);

    // Strength is scored here rather than stored, because the vault scores on
    // reveal and never writes the column. Rows that cannot be decrypted (seed
    // data carries an ENC: placeholder) count as "Not evaluated".
    const passwordStrength: Record<string, number> = {
      "Very Weak": 0, Weak: 0, Fair: 0, Good: 0, Strong: 0, "Very Strong": 0, "Not evaluated": 0,
    };
    for (const pw of passwords) {
      let plaintext = "";
      try { plaintext = decrypt(pw.encryptedPassword, pw.iv, pw.authTag); } catch { plaintext = ""; }
      const bucket = !plaintext || plaintext.startsWith("ENC:") ? "Not evaluated" : passwordStrengthLevel(plaintext);
      passwordStrength[bucket] = (passwordStrength[bucket] ?? 0) + 1;
    }

    type Expiring = { type: string; id: string; name: string; expiresAt: Date };
    const upcoming: Expiring[] = [];
    for (const p of passwords) if (p.expiresAt && p.expiresAt >= now) upcoming.push({ type: "Password", id: p.id, name: p.label, expiresAt: p.expiresAt });
    for (const c of certificates) if (c.expiryDate >= now) upcoming.push({ type: "Certificate", id: c.id, name: c.name, expiresAt: c.expiryDate });
    for (const d of domains) if (d.expiryDate && d.expiryDate >= now) upcoming.push({ type: "Domain", id: d.id, name: d.domainName, expiresAt: d.expiryDate });
    const upcomingExpirations = upcoming.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, 5);

    const recentlyUpdated = [
      ...recentAssets.map((a) => ({ type: "Asset", id: a.id, name: a.name, updatedAt: a.updatedAt })),
      ...documents.map((d) => ({ type: "Document", id: d.id, name: d.title, updatedAt: d.updatedAt })),
      ...passwords.map((p) => ({ type: "Password", id: p.id, name: p.label, updatedAt: p.updatedAt })),
      ...domains.map((d) => ({ type: "Domain", id: d.id, name: d.domainName, updatedAt: d.updatedAt })),
      ...certificates.map((c) => ({ type: "Certificate", id: c.id, name: c.name, updatedAt: c.updatedAt })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 5);

    // Activity is derived from the records themselves — the audit log records
    // the path, not the owning organization, so filtering it here would miss
    // every create.
    const activityRaw = [
      ...recentAssets.map((a) => ({ type: "Asset", id: a.id, name: a.name, createdAt: a.createdAt, updatedAt: a.updatedAt, byId: a.updatedById || a.createdById })),
      ...documents.map((d) => ({ type: "Document", id: d.id, name: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, byId: d.lastEditorId || d.authorId })),
      ...passwords.map((p) => ({ type: "Password", id: p.id, name: p.label, createdAt: p.createdAt, updatedAt: p.updatedAt, byId: p.updatedById || p.createdById })),
      ...domains.map((d) => ({ type: "Domain", id: d.id, name: d.domainName, createdAt: d.createdAt, updatedAt: d.updatedAt, byId: null })),
      ...certificates.map((c) => ({ type: "Certificate", id: c.id, name: c.name, createdAt: c.createdAt, updatedAt: c.updatedAt, byId: null })),
    ]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 8);

    const actorIds = [...new Set(activityRaw.map((a) => a.byId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const actorName = new Map(actors.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const activity = activityRaw.map((e) => ({
      type: e.type,
      id: e.id,
      name: e.name,
      action: e.updatedAt.getTime() - e.createdAt.getTime() < CREATED_WINDOW_MS ? "created" : "updated",
      at: e.updatedAt,
      by: e.byId ? actorName.get(e.byId) ?? null : null,
    }));

    // The rail's asset types: every active template (global, or owned by this
    // client) with its asset count for this client. Templates with no assets
    // stay in the list so the rail can still offer them as an empty type.
    const [templates, templateUsage, changeBoard, serverCount] = await Promise.all([
      prisma.kumoAssetTemplate.findMany({
        where: { isActive: true, OR: [{ companyId: null }, { companyId }] },
        select: {
          id: true, name: true, description: true, icon: true, color: true,
          isBuiltIn: true, companyId: true, _count: { select: { fields: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.kumoAsset.groupBy({ by: ["templateId"], where: { companyId }, _count: { _all: true } }),
      prisma.serviceBoard.findFirst({
        where: { isActive: true, name: { contains: "change", mode: "insensitive" } },
        select: { id: true, name: true },
      }),
      prisma.kumoServer.count({ where: { kumoAsset: { companyId } } }),
    ]);
    const templateUsageByTemplate = new Map(templateUsage.map((r) => [r.templateId, r._count._all]));
    const assetTypes = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      color: t.color,
      isBuiltIn: t.isBuiltIn,
      ownedByClient: t.companyId === companyId,
      fieldCount: t._count.fields,
      count: templateUsageByTemplate.get(t.id) ?? 0,
    }));

    // A recent is only kept when the item it points at belongs to this client.
    const recentIds = recentItems.map((i) => i.entityId);
    const [ownedAssets, ownedPasswords, ownedDocuments, ownedDomains, ownedCertificates, ownedServers] = recentIds.length
      ? await Promise.all([
        prisma.kumoAsset.findMany({ where: { id: { in: recentIds }, companyId }, select: { id: true } }),
        prisma.kumoPassword.findMany({ where: { id: { in: recentIds }, companyId }, select: { id: true } }),
        prisma.kumoDocument.findMany({ where: { id: { in: recentIds }, companyId }, select: { id: true } }),
        prisma.kumoDomain.findMany({ where: { id: { in: recentIds }, companyId }, select: { id: true } }),
        prisma.kumoCertificate.findMany({ where: { id: { in: recentIds }, companyId }, select: { id: true } }),
        prisma.kumoServer.findMany({ where: { id: { in: recentIds }, kumoAsset: { companyId } }, select: { id: true } }),
      ])
      : [[], [], [], [], [], []];
    const ownedIds = new Set(
      [...ownedAssets, ...ownedPasswords, ...ownedDocuments, ...ownedDomains, ...ownedCertificates, ...ownedServers].map((r) => r.id)
    );

    res.json({
      organization: org,
      counts: {
        assets: assetCount, passwords: passwordCount, documents: documentCount,
        domains: domainCount, certificates: certificateCount, configs: serverCount,
      },
      passwordStrength,
      documentation: {
        stale: staleDocuments,
        notViewed: unviewedDocuments,
        expired: expiredCertificates + expiredDomains,
        staleAfterDays: STALE_DOCUMENT_DAYS,
      },
      recentlyViewed: recentItems.filter((i) => ownedIds.has(i.entityId)).slice(0, 5),
      importantContacts: contacts,
      recentlyUpdated,
      popularPasswords: passwords.slice(0, 5).map((p) => ({
        id: p.id, label: p.label, username: p.username, url: p.url, accessCount: p._count.accessLogs,
      })),
      upcomingExpirations,
      activity,
      subOrganizations: children,
      assetTypes,
      changeBoard,
    });
  } catch (e) { next(e); }
});
