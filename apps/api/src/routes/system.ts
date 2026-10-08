import { Router } from "express";
import { readFileSync, statSync } from "fs";
import { resolve } from "path";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { prisma } from "../index";
import { getRetryCount, getRecoveryLog, resetPoller, isPaused } from "../services/poller";
import { AppError } from "../middleware/errorHandler";
import { CONFIG_FIELDS, Permission, resolveEnvironmentValue } from "@C7NTAX/shared";
import { configFlag, environmentSupplied } from "../services/appSettings";
import { addinAssetsPresent, addinDirectory } from "../services/addinAssets";
import { addinCurrentSourceHash, addinId, addinPlugin, installerBuild, installerDirectory, installerHistory, publicOrigin, type InstallerRelease } from "../services/addinPackage";

export const systemRouter = Router();
systemRouter.use(authenticate);

// ── Failover state (backed by SystemConfig; survives restarts) ─────
const FAILOVER_KEY = "failover_state";

/**
 * The registry entry for the Outlook add-in, resolved once so the deployment report and the
 * registry cannot disagree about which area owns the switch.
 */
const OUTLOOK_ADDIN_FIELD = CONFIG_FIELDS["apps.outlookAddin"];

systemRouter.get("/failover/status", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: FAILOVER_KEY } });
    const v = (row?.value || {}) as { count?: number; lastResetAt?: string | null };
    res.json({ count: v.count || 0, lastResetAt: v.lastResetAt || null });
  } catch (e) { next(e); }
});

systemRouter.post("/failover/reset", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    await prisma.systemConfig.upsert({
      where: { key: FAILOVER_KEY },
      update: { value: { count: 0, lastResetAt: new Date().toISOString() } },
      create: { key: FAILOVER_KEY, value: { count: 0, lastResetAt: new Date().toISOString() } },
    });
    res.json({ count: 0, lastResetAt: new Date().toISOString() });
  } catch (e) { next(e); }
});

// I18N / translations
systemRouter.get("/locales", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const locales = await prisma.locale.findMany();
    const translationCounts = await prisma.translation.groupBy({ by: ["localeCode"], _count: { _all: true } });
    const translationCount = new Map(translationCounts.map(c => [c.localeCode, c._count._all]));
    res.json(locales.map(l => ({ ...l, _count: { translations: translationCount.get(l.code) ?? 0 } })));
  }
  catch (e) { next(e); }
});

systemRouter.post("/locales", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.locale.create({ data: { code: req.body.code, name: req.body.name, direction: req.body.direction || "ltr" } })); }
  catch (e) { next(e); }
});

systemRouter.get("/translations/:localeCode", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { const ns = req.query.namespace as string || "common";
    const translations = await prisma.translation.findMany({ where: { localeCode: req.params.localeCode, namespace: ns } });
    const map: Record<string, string> = {};
    for (const t of translations) map[t.key] = t.value;
    res.json(map); }
  catch (e) { next(e); }
});

systemRouter.post("/translations", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.translation.create({ data: { localeCode: req.body.localeCode, key: req.body.key, value: req.body.value, namespace: req.body.namespace || "common" } })); }
  catch (e) { next(e); }
});

// Currency
systemRouter.get("/currencies", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.currency.findMany()); }
  catch (e) { next(e); }
});

systemRouter.get("/exchange-rates", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const rates = await prisma.exchangeRate.findMany();
    const currencies = await prisma.currency.findMany();
    const currencyByCode = new Map(currencies.map(c => [c.code, c]));
    res.json(rates.map(r => ({ ...r, from: currencyByCode.get(r.fromCurrency) ?? null, to: currencyByCode.get(r.toCurrency) ?? null })));
  }
  catch (e) { next(e); }
});

systemRouter.post("/exchange-rates", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.exchangeRate.create({ data: { fromCurrency: req.body.fromCurrency, toCurrency: req.body.toCurrency, rate: req.body.rate } })); }
  catch (e) { next(e); }
});

// Retention policies
systemRouter.get("/retention-policies", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.retentionPolicy.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/retention-policies", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.retentionPolicy.create({ data: { entity: req.body.entity, retentionDays: req.body.retentionDays, archiveAction: req.body.archiveAction || "archive", condition: req.body.condition || {} } })); }
  catch (e) { next(e); }
});

// Field permissions
systemRouter.get("/field-permissions", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.fieldPermission.findMany()); }
  catch (e) { next(e); }
});

systemRouter.post("/field-permissions", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.fieldPermission.create({ data: { entity: req.body.entity, field: req.body.field, roleName: req.body.roleName, canRead: req.body.canRead ?? true, canWrite: req.body.canWrite ?? false } })); }
  catch (e) { next(e); }
});

// Calendar sync configs
systemRouter.get("/calendar-sync", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.calendarSyncConfig.findMany({ where: { userId: req.user!.userId } })); }
  catch (e) { next(e); }
});

systemRouter.post("/calendar-sync", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const provider = String(req.body?.provider ?? "").trim();
    if (!provider) { res.status(400).json({ error: "A calendar provider is required" }); return; }
    res.status(201).json(await prisma.calendarSyncConfig.create({
      data: {
        userId: req.user!.userId,
        provider,
        syncScheduleEntries: req.body.syncScheduleEntries ?? true,
        syncPto: req.body.syncPto ?? true,
      },
    }));
  }
  catch (e) { next(e); }
});

// ── System Config (landing page, etc.) ──

/**
 * Keys the application itself writes from ordinary screens. Anything else is administrative and
 * needs `SystemConfig`.
 *
 * The set is deliberately short and the general configuration screen no longer uses this route:
 * `/api/configuration` addresses a section and a field declared in the shared registry, so it
 * cannot name a row it does not own and needs no list of exclusions. What remains here is the
 * compatibility surface the SPA still reads — the right-click menu preference, the idle timeout
 * and the landing page — plus the connector state the email services own.
 */
const SELF_SERVICE_CONFIG_KEYS = new Set(["app_settings", "session_timeout", "default_landing_page"]);

/**
 * Keys a request may never write, whoever is asking: connector credentials and OAuth handshake
 * state are owned by the services that create them, and the sample-data switches change what the
 * whole instance contains.
 */
const RESERVED_CONFIG_PREFIXES = ["email_connector:", "oauth", "sso:", "sample_data"];
const RESERVED_CONFIG_PATTERN = /secret|token|password|credential|apikey|api_key|private_?key/i;

/** True for a row that no HTTP caller may see, administrator included. */
function isReservedConfigKey(key: string): boolean {
  return RESERVED_CONFIG_PREFIXES.some(p => key.startsWith(p)) || RESERVED_CONFIG_PATTERN.test(key);
}

/**
 * One policy for reading and writing a `SystemConfig` row by name.
 *
 * Read used to be wide open, and that mattered more than it looks: the SSO callback parks the
 * hand-off row here — the single-use code *and* the signing-in user's whole token — so any signed
 * in account could poll `/api/system/config/sso:oidc_code` while somebody was signing in and take
 * the token, never calling the exchange that exists to consume it. The reserved rows are therefore
 * refused to everyone, reads included; a service reads them through Prisma, not through HTTP.
 *
 * The write side had this gate already, so the two share it rather than drifting apart — which is
 * exactly how the read side came to be missing it.
 */
function assertConfigAccess(user: AuthRequest["user"], key: string, action: "read" | "write"): void {
  if (isReservedConfigKey(key)) {
    throw new AppError(
      action === "read"
        ? "That setting is managed by the system and is not readable here"
        : "That setting is managed by the system and cannot be edited here",
      403,
    );
  }
  // The registry's own rows are read and written through /api/configuration, which checks the
  // section's permission, so they are not self-service here even for the keys an administrator may
  // change.
  if (key.startsWith("config:")) {
    throw new AppError("Use the configuration screen for that setting", 403);
  }
  const isAdmin = !!user?.permissions?.includes(Permission.SystemConfig);
  if (!isAdmin && !SELF_SERVICE_CONFIG_KEYS.has(key)) {
    throw new AppError("Insufficient permissions", 403);
  }
}

systemRouter.get("/config/:key", async (req: AuthRequest, res, next) => {
  try {
    assertConfigAccess(req.user, String(req.params.key), "read");
    const config = await prisma.systemConfig.findUnique({ where: { key: req.params.key } });
    if (!config) { res.json({ key: req.params.key, value: null }); return; }
    res.json({ key: config.key, value: JSON.parse(config.value as string) });
  } catch (e) { next(e); }
});

systemRouter.patch("/config/:key", async (req: AuthRequest, res, next) => {
  try {
    const key = String(req.params.key ?? "");
    assertConfigAccess(req.user, key, "write");
    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(req.body.value) },
      update: { value: JSON.stringify(req.body.value) },
    });
    res.json({ key: config.key, value: JSON.parse(config.value as string) });
  } catch (e) { next(e); }
});

// The full config dump is an administrative view, and the service-owned rows are left out of it
// even for an administrator: an SSO hand-off row carries a live token for two minutes, and an
// administrator reading one is an administrator who can be somebody else. Nothing in the SPA reads
// this route; what remains is the non-secret state an operator may want in one response.
systemRouter.get("/configs", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();
    const map: Record<string, unknown> = {};
    for (const c of configs) {
      if (isReservedConfigKey(c.key)) continue;
      try { map[c.key] = JSON.parse(c.value as string); } catch { map[c.key] = c.value; }
    }
    res.json(map);
  } catch (e) { next(e); }
});

/**
 * The non-secret facts about how this instance is deployed.
 *
 * Exists so the System Settings screen can state what it actually knows instead of offering an
 * edit control for a value only a deployment can change. Passwords are never returned: the mail
 * relay reports whether credentials are set, not what they are, and the database URL is reduced
 * to host and database name because the connection string carries a password.
 */
systemRouter.get("/deployment", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res) => {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL ?? "";
  let database: { configured: boolean; host: string | null; name: string | null } = { configured: false, host: null, name: null };
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      database = { configured: true, host: `${url.hostname}${url.port ? `:${url.port}` : ""}`, name: url.pathname.replace(/^\//, "") || null };
    } catch {
      // An unparseable URL is still a configured one; only the readable half is unknown.
      database = { configured: true, host: null, name: null };
    }
  }

  const addinDir = env.OUTLOOK_ADDIN_DIR || "(default: apps/outlook-addin)";
  const smtpHost = env.SMTP_HOST ?? "";
  /**
   * The origin the add-in's URLs must carry, the plugin in force, and the installers actually
   * built here. All resolved once so the halves of the report cannot describe different
   * deployments, and hashed once rather than per installer row.
   */
  const origin = publicOrigin(req);
  const installer = installerBuild();
  const plugin = addinPlugin();
  const currentSourceHash = await addinCurrentSourceHash();
  res.json({
    mail: {
      configured: Boolean(smtpHost),
      host: smtpHost || null,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      secure: env.SMTP_SECURE === "true",
      hasCredentials: Boolean(env.SMTP_USER && env.SMTP_PASS),
      from: env.SMTP_FROM ?? null,
    },
    database,
    runtime: {
      nodeEnv: env.NODE_ENV ?? "development",
      port: Number(env.PORT) || 4000,
      webOrigin: env.WEB_ORIGIN ?? null,
      servesWeb: env.SERVE_WEB === "true",
    },
    addin: {
      /** The value in force, so this screen cannot disagree with what the add-in experiences. */
      enabled: configFlag("apps", "outlookAddin"),
      /**
       * What the deployment's own environment would give it with nothing saved. Guarded because
       * the registry is the authority: if the field is ever removed, this reports "no opinion"
       * rather than failing the whole screen.
       */
      environmentEnabled: OUTLOOK_ADDIN_FIELD
        ? resolveEnvironmentValue(OUTLOOK_ADDIN_FIELD, env as Record<string, string | undefined>)
        : false,
      environmentSupplied: OUTLOOK_ADDIN_FIELD ? environmentSupplied(OUTLOOK_ADDIN_FIELD) : false,
      directory: addinDirectory(),
      /**
       * Whether the taskpane's files are on disk at all. A switch cannot serve a directory that
       * is not there, and saying so here is the difference between "off" and "cannot be on".
       */
      assetsPresent: addinAssetsPresent(),
      /** Where the manifest's URLs point, and the identity Office knows the add-in by. */
      origin,
      manifestId: addinId(),
      manifestUrl: `${origin}/addin/manifest.xml`,
      /**
       * The plugin as an artifact: the version stamped into the manifest and the MSI, the release
       * it shipped in, and the hash of the files that make it up.
       */
      plugin: {
        version: plugin.version,
        release: plugin.release,
        sourceHash: plugin.sourceHash,
        currentSourceHash,
        /**
         * Whether the plugin's files have changed since it was versioned. True means somebody
         * edited the add-in and did not run `pnpm plugin:bump`, so the version Office reports
         * describes a payload that no longer exists.
         */
        modifiedSinceVersioned: Boolean(plugin.sourceHash) && plugin.sourceHash !== currentSourceHash,
      },
      /**
       * The Windows installers this deployment has, newest first. Null rather than an empty object
       * when there are none, because "there is no installer here" is a fact the screen has to state
       * plainly, and `installerDirectory` is reported alongside it so an operator knows where to
       * put one.
       */
      installer: installer
        ? {
            ...installerDescriptorFor(installer, currentSourceHash, origin),
            /** Every earlier version, so a plugin change can be rolled back. */
            versions: installerHistory().map((release) =>
              installerDescriptorFor(release, currentSourceHash, origin),
            ),
          }
        : null,
      installerDirectory: installerDirectory(),
    },
  });
});

/**
 * One history entry, described for the deployment report.
 *
 * `matchesOrigin` is the fact worth reporting: an installer built for another host registers a
 * manifest pointing somewhere the taskpane does not exist, and the only symptom is an add-in that
 * installs cleanly and then opens an empty pane.
 */
function installerDescriptorFor(release: InstallerRelease, currentSourceHash: string, origin: string) {
  return {
    fileName: release.fileName,
    pluginVersion: release.pluginVersion,
    productVersion: release.productVersion,
    size: release.size,
    builtAt: release.builtAt,
    sha256: release.sha256,
    addinHost: release.addinHost,
    matchesOrigin: release.addinHost === origin,
    matchesPlugin: release.sourceHash === currentSourceHash,
    downloadPath: `/addin/installer/${release.fileName}`,
  };
}

// ── Self-healing poller status ──
systemRouter.get("/poller/status", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  res.json({ paused: isPaused(), retryCount: getRetryCount(), maxRetries: 10, recoveryLog: getRecoveryLog() });
});

systemRouter.post("/poller/reset", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  resetPoller();
  res.json({ success: true, message: "Poller reset successfully" });
});

// ── Snapshot poller status ─────────────────────────────────────────

systemRouter.get("/snapshot-poller/status", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  try {
    const { getStatus } = await import("../services/snapshotPoller");
    res.json(getStatus());
  } catch { res.json({ error: "Snapshot poller not loaded" }); }
});

systemRouter.post("/snapshot-poller/force", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  try {
    const { forcePoll } = await import("../services/snapshotPoller");
    await forcePoll();
    res.json({ success: true, message: "Force poll + capture triggered" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

systemRouter.post("/snapshot-poller/pause", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  try {
    const { setPaused } = await import("../services/snapshotPoller");
    setPaused(true);
    res.json({ success: true, message: "Snapshot poller paused" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

systemRouter.post("/snapshot-poller/resume", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res) => {
  try {
    const { setPaused } = await import("../services/snapshotPoller");
    setPaused(false);
    res.json({ success: true, message: "Snapshot poller resumed" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Changelog — parses BuildNotes.md at runtime (single source of truth) ──

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

function parseBuildNotes(mdPath: string): VersionEntry[] {
  const raw = readFileSync(mdPath, "utf-8");
  const versions: VersionEntry[] = [];

  // Match version headers:  ## YYYY.M.D.BBB — Title
  const headerRe = /^## (\d{4}\.\d{1,2}\.\d{1,2}\.\d{3})\s*[—–-]\s*(.+)$/gm;
  const matches = [...raw.matchAll(headerRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    // A header the pattern matched but that did not yield both groups is skipped rather than
    // recorded with a hole in it — the reader is rendering released notes, and a half-read
    // version is worse than a missing one.
    const version = m?.[1];
    const title = m?.[2]?.trim();
    if (!m || !version || !title) continue;
    const headerEnd = (m.index ?? 0) + m[0].length;
    const nextHeaderStart = i + 1 < matches.length ? matches[i + 1]?.index ?? raw.length : raw.length;

    // Extract lines between this header and the next
    const body = raw.slice(headerEnd, nextHeaderStart);
    const changes: ChangeItem[] = [];

    // Parse bullet lines:  - **[Type]** text
    const bulletRe = /^-\s*\*\*\[(New|Update|Fix)\]\*\*\s+(.+)$/gm;
    let bm: RegExpExecArray | null;
    while ((bm = bulletRe.exec(body)) !== null) {
      const typeLabel = bm[1];
      const text = bm[2]?.trim();
      if (!typeLabel || !text) continue;
      const type = typeLabel === "New" ? "new" : typeLabel === "Update" ? "update" : "fix";
      changes.push({ text, type });
    }

    if (changes.length > 0 || title) {
      // Derive date from version: YYYY.M.D.BBB → YYYY-MM-DD
      const [year, month, day] = version.split(".");
      if (!year || !month || !day) continue;
      const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      versions.push({ version, date, title, changes });
    }
  }

  return versions;
}

/**
 * Locate the root BuildNotes.md. Walks up from this file's location so the
 * parse works whether the API runs from src (tsx/dev), from dist, or from a
 * packaged desktop build, and honors C7NTAX_ROOT when set.
 */
function findBuildNotes(): string | null {
  const candidates: string[] = [];
  const envRoot = process.env.C7NTAX_ROOT;
  if (envRoot) candidates.push(resolve(envRoot, "BuildNotes.md"));
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    candidates.push(resolve(dir, "BuildNotes.md"));
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p;
    } catch { /* keep searching */ }
  }
  return null;
}

/**
 * Parse BuildNotes.md once and re-parse only when the file itself changes. `/changelog` asking for
 * every release is fine; a menu label asking for one version string is not, and the notes are a few
 * hundred KB of markdown. Keyed on mtime+size rather than a TTL so a deploy is picked up on the next
 * request instead of up to a TTL later.
 */
let buildNotesCache: { key: string; versions: VersionEntry[] } | null = null;

function loadBuildNotes(): VersionEntry[] {
  const mdPath = findBuildNotes();
  if (!mdPath) throw new Error("BuildNotes.md not found");
  const stat = statSync(mdPath);
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (buildNotesCache?.key === key) return buildNotesCache.versions;
  const versions = parseBuildNotes(mdPath);
  buildNotesCache = { key, versions };
  return versions;
}

/** The notes bundled with the API, for when the source markdown is not on disk. */
function buildNotesFromJson(): VersionEntry[] {
  try {
    const data = require("../BuildNotes.json");
    return Array.isArray(data) ? (data as VersionEntry[]) : [];
  } catch {
    return [];
  }
}

function buildNotes(): VersionEntry[] {
  try {
    return loadBuildNotes();
  } catch {
    return buildNotesFromJson();
  }
}

systemRouter.get("/changelog", (_req, res) => {
  res.json(buildNotes());
});

/**
 * The version the running build identifies as, for labelling the application itself (the account
 * menu) without pulling the whole change history across.
 */
systemRouter.get("/version", (_req, res) => {
  const newest = buildNotes()[0];
  // A build whose notes cannot be read still answers, with nulls rather than a 404: "unknown
  // version" is a state the UI can render, and the menu should not log a failed request for it.
  res.json({
    version: newest?.version ?? null,
    date: newest?.date ?? null,
    title: newest?.title ?? null,
  });
});

// ── Audit logs ──
/**
 * The audit trail. Two optional filters, both of which only ever *narrow* what this route returns:
 *
 * - `mine=true` limits the rows to the caller's own, which is what the header's Recent menu asks for.
 *   It is narrower than the unfiltered read the ticket view has always done, and it is the reason the
 *   menu needs no new endpoint and no new permission.
 * - `limit` caps the page, because the menu wants five and the audit screen wants hundreds.
 */
systemRouter.get("/audit-logs", async (req: AuthRequest, res, next) => {
  try {
    const { entity, entityId, mine } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (entity) where.entity = entity;
    if (entityId) where.entityId = entityId;
    if (mine === "true") {
      const me = req.user?.userId;
      // A caller the session middleware could not name gets an empty list rather than everybody's
      // rows: "mine" that answers with someone else's activity is worse than no answer.
      if (!me) { res.json({ data: [] }); return; }
      where.userId = me;
    }
    const requested = Number(req.query.limit);
    const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : 500;
    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
    });
    // Resolve user names for display
    const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const enriched = logs.map(log => ({
      ...log,
      userName: log.userId === "system" ? "System"
        : userMap.has(log.userId) ? `${userMap.get(log.userId)!.firstName || ""} ${userMap.get(log.userId)!.lastName || ""}`.trim() || log.userId.slice(0, 8)
        : log.userId?.slice(0, 8) || "System",
    }));
    res.json({ data: enriched });
  } catch (e) { next(e); }
});
