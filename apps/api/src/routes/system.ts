import { Router } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { prisma } from "../index";
import { getRetryCount, getRecoveryLog, resetPoller, isPaused } from "../services/poller";

export const systemRouter = Router();
systemRouter.use(authenticate);

// I18N / translations
systemRouter.get("/locales", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.locale.findMany({ include: { _count: { select: { translations: true } } } })); }
  catch (e) { next(e); }
});

systemRouter.post("/locales", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.locale.create({ data: { code: req.body.code, name: req.body.name, direction: req.body.direction || "ltr" } })); }
  catch (e) { next(e); }
});

systemRouter.get("/translations/:localeCode", async (req: AuthRequest, res, next) => {
  try { const ns = req.query.namespace as string || "common";
    const translations = await prisma.translation.findMany({ where: { localeCode: req.params.localeCode, namespace: ns } });
    const map: Record<string, string> = {};
    for (const t of translations) map[t.key] = t.value;
    res.json(map); }
  catch (e) { next(e); }
});

systemRouter.post("/translations", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.translation.create({ data: { localeCode: req.body.localeCode, key: req.body.key, value: req.body.value, namespace: req.body.namespace || "common" } })); }
  catch (e) { next(e); }
});

// Currency
systemRouter.get("/currencies", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.currency.findMany()); }
  catch (e) { next(e); }
});

systemRouter.get("/exchange-rates", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.exchangeRate.findMany({ include: { from: true, to: true } })); }
  catch (e) { next(e); }
});

systemRouter.post("/exchange-rates", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.exchangeRate.create({ data: { fromCurrency: req.body.fromCurrency, toCurrency: req.body.toCurrency, rate: req.body.rate } })); }
  catch (e) { next(e); }
});

// Retention policies
systemRouter.get("/retention-policies", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.retentionPolicy.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/retention-policies", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.retentionPolicy.create({ data: { entity: req.body.entity, retentionDays: req.body.retentionDays, archiveAction: req.body.archiveAction || "archive", condition: req.body.condition || {} } })); }
  catch (e) { next(e); }
});

// Field permissions
systemRouter.get("/field-permissions", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.fieldPermission.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/field-permissions", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.fieldPermission.create({ data: { entity: req.body.entity, field: req.body.field, roleName: req.body.roleName, canRead: req.body.canRead ?? true, canWrite: req.body.canWrite ?? false } })); }
  catch (e) { next(e); }
});

// Calendar sync configs
systemRouter.get("/calendar-sync", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.calendarSyncConfig.findMany({ where: { userId: req.user!.userId } })); }
  catch (e) { next(e); }
});

systemRouter.post("/calendar-sync", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.calendarSyncConfig.create({ data: { userId: req.user!.userId, provider: req.body.provider, syncScheduleEntries: req.body.syncScheduleEntries ?? true, syncPto: req.body.syncPto ?? true } })); }
  catch (e) { next(e); }
});

// ── System Config (landing page, etc.) ──

systemRouter.get("/config/:key", async (req: AuthRequest, res, next) => {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: req.params.key } });
    if (!config) { res.json({ key: req.params.key, value: null }); return; }
    res.json({ key: config.key, value: JSON.parse(config.value as string) });
  } catch (e) { next(e); }
});

systemRouter.patch("/config/:key", async (req: AuthRequest, res, next) => {
  try {
    const config = await prisma.systemConfig.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value: JSON.stringify(req.body.value) },
      update: { value: JSON.stringify(req.body.value) },
    });
    res.json({ key: config.key, value: JSON.parse(config.value as string) });
  } catch (e) { next(e); }
});

systemRouter.get("/configs", async (_req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();
    const map: Record<string, unknown> = {};
    for (const c of configs) {
      try { map[c.key] = JSON.parse(c.value as string); } catch { map[c.key] = c.value; }
    }
    res.json(map);
  } catch (e) { next(e); }
});

// ── Save system config ──
systemRouter.patch("/config/:key", async (req: AuthRequest, res, next) => {
  try {
    const { key } = req.params;
    const value = typeof req.body.value === "string" ? req.body.value : JSON.stringify(req.body.value);
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ── Self-healing poller status ──

systemRouter.get("/poller/status", async (_req: AuthRequest, res) => {
  res.json({ paused: isPaused(), retryCount: getRetryCount(), maxRetries: 10, recoveryLog: getRecoveryLog() });
});

systemRouter.post("/poller/reset", async (_req: AuthRequest, res) => {
  resetPoller();
  res.json({ success: true, message: "Poller reset successfully" });
});

// ── Changelog — parses FEATURE_LIST.md at runtime (single source of truth) ──

interface ChangeItem {
  text: string;
  type: "new" | "update" | "fix";
}

interface VersionEntry {
  version: string;
  date: string;
  title: string;
  changes: ChangeItem[];
}

function parseFeatureList(mdPath: string): VersionEntry[] {
  const raw = readFileSync(mdPath, "utf-8");
  const versions: VersionEntry[] = [];

  // Match version headers:  ## YYYY.M.D.BBB — Title
  const headerRe = /^## (\d{4}\.\d{1,2}\.\d{1,2}\.\d{3})\s*[—–-]\s*(.+)$/gm;
  const matches = [...raw.matchAll(headerRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const version = m[1];
    const title = m[2].trim();
    const headerEnd = (m.index ?? 0) + m[0].length;
    const nextHeaderStart = i + 1 < matches.length ? matches[i + 1].index! : raw.length;

    // Extract lines between this header and the next
    const body = raw.slice(headerEnd, nextHeaderStart);
    const changes: ChangeItem[] = [];

    // Parse bullet lines:  - **[Type]** text
    const bulletRe = /^-\s*\*\*\[(New|Update|Fix)\]\*\*\s+(.+)$/gm;
    let bm: RegExpExecArray | null;
    while ((bm = bulletRe.exec(body)) !== null) {
      const typeLabel = bm[1];
      const text = bm[2].trim();
      const type = typeLabel === "New" ? "new" : typeLabel === "Update" ? "update" : "fix";
      changes.push({ text, type });
    }

    if (changes.length > 0 || title) {
      // Derive date from version: YYYY.M.D.BBB → YYYY-MM-DD
      const parts = version.split(".");
      const date = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      versions.push({ version, date, title, changes });
    }
  }

  return versions;
}

systemRouter.get("/changelog", (_req, res) => {
  try {
    const mdPath = resolve(__dirname, "../../../../FEATURE_LIST.md");
    const data = parseFeatureList(mdPath);
    res.json(data);
  } catch {
    // Fallback to static JSON if MD not available
    try {
      const data = require("../feature_list.json");
      res.json(data);
    } catch {
      res.json([]);
    }
  }
});
