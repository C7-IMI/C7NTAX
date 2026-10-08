/**
 * The configuration API.
 *
 * One endpoint describes every configurable setting in the product, and one endpoint writes
 * them. Both are driven by the registry in `@C7NTAX/shared`, which means the screen cannot show
 * a field the server does not honour and cannot offer a value the server would refuse.
 *
 * Three rules, because this surface can switch features on and off:
 *   1. A field is writable only if the registry declares it a setting. Environment-owned values —
 *      outbound credentials, and the switches that decide whether authentication is enforced at
 *      all — are reported and never written, so an administrator session cannot weaken the
 *      deployment's own security posture by accident.
 *   2. Validation lives in one place (`coerceConfigValue`), so the rule that stops a form
 *      submitting a 900-minute idle timeout also stops a crafted request.
 *   3. A section is described only to a caller allowed to read it, and the request path names a
 *      section and a field rather than a storage key — so this endpoint cannot be pointed at a
 *      `SystemConfig` row the registry does not own. That is why it needs no deny-list, unlike
 *      the general key-value endpoint beside it.
 */
import { Router } from "express";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import {
  CONFIG_SECTIONS,
  LANDING_PAGES,
  Permission,
  type ConfigFieldSpec,
  type ConfigSectionSpec,
} from "@C7NTAX/shared";
import {
  clearConfigValue,
  configValue,
  environmentSupplied,
  fallbackValue,
  isWritableConfigField,
  savedValue,
  settingsLoaded,
  writeConfigValue,
} from "../services/appSettings";
import { resolvePortalBoardId } from "../services/portalBoard";
import { portalEnabled } from "../services/portalAuth";
import { oidcConfigured } from "../services/ssoSettings";

export const configurationRouter = Router();
configurationRouter.use(authenticate);

const has = (req: AuthRequest, permission: Permission): boolean => !!req.user?.permissions?.includes(permission);

interface RenderedChoice { value: string; label: string }

/** The choices only the database can supply, resolved once per request. */
async function dynamicChoices(): Promise<Record<string, RenderedChoice[]>> {
  const [boards, providers] = await Promise.all([
    prisma.serviceBoard.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.aiProviderConfig.findMany({ where: { isActive: true }, orderBy: { updatedAt: "desc" }, select: { provider: true, model: true } }),
  ]);

  const models: RenderedChoice[] = [];
  for (const provider of providers) {
    if (!provider.model || models.some(m => m.value === provider.model)) continue;
    models.push({ value: provider.model, label: `${provider.model} (${provider.provider})` });
  }

  return {
    serviceBoards: boards.map(b => ({ value: b.id, label: b.name })),
    landingPages: LANDING_PAGES.map(p => ({ value: p.path, label: p.label })),
    inferenceModels: models,
  };
}

function renderField(
  section: ConfigSectionSpec,
  field: ConfigFieldSpec,
  choices: Record<string, RenderedChoice[]>,
  req: AuthRequest,
) {
  const value = configValue(section.id, field.id);
  const fallback = fallbackValue(section.id, field.id);
  const fromEnvironment = environmentSupplied(field);
  const saved = savedValue(section.id, field.id);

  return {
    id: field.id,
    label: field.label,
    summary: field.summary,
    detail: field.detail ?? null,
    type: field.type,
    source: field.source,
    env: field.env ?? null,
    envMatch: field.envMatch ?? null,
    default: field.default,
    min: field.min ?? null,
    max: field.max ?? null,
    step: field.step ?? null,
    unit: field.unit ?? null,
    affects: field.affects ?? [],
    restartRequired: !!field.restartRequired,
    locked: !!field.locked,
    secret: !!field.secret,
    /** The value in force. */
    value,
    /** What is saved here, or null when nothing has been. */
    saved: saved ?? null,
    /** What the deployment's environment would give it with nothing saved. */
    fallback,
    fromEnvironment,
    /** A saved value is shadowing the deployment's own. */
    overridden: fromEnvironment && saved !== undefined && fallback !== value,
    choices: field.choices ?? (field.choicesFrom ? (choices[field.choicesFrom] ?? []) : []),
    editable: isWritableConfigField(section.id, field.id) && has(req, section.writePermission),
  };
}

/**
 * The whole configuration surface, pre-rendered.
 *
 * Sections the caller may not read are left out rather than blanked: the environment values
 * inside them are facts about the deployment, and a page that says "there is something here you
 * cannot see" is a worse answer than one that does not mention it.
 */
configurationRouter.get(
  "/",
  requirePermission(
    Permission.SystemConfig, Permission.ClientView, Permission.ServiceAlertManage,
    Permission.BillingManage, Permission.KBManage, Permission.IntegrationManage,
    Permission.SecurityManage,
  ),
  async (req: AuthRequest, res, next) => {
    try {
      const choices = await dynamicChoices();
      const visible = CONFIG_SECTIONS.filter(section => has(req, Permission.SystemConfig) || has(req, section.readPermission));

      const sections = await Promise.all(visible.map(async section => ({
        id: section.id,
        label: section.label,
        summary: section.summary,
        governs: section.governs,
        icon: section.icon,
        readPermission: section.readPermission,
        writePermission: section.writePermission,
        writable: has(req, section.writePermission),
        requirements: await Promise.all((section.requirements ?? []).map(async requirement => {
          const missing = (requirement.env ?? []).filter(name => {
            const value = process.env[name];
            return value === undefined || value === "";
          });
          // A requirement can also be satisfied by something configured in the application rather
          // than in the deployment: an identity provider saved on its own screen, for instance.
          const providedOk = requirement.providedBy === "oidcProvider" ? await oidcConfigured() : false;
          const met = missing.length === 0 || providedOk;
          return {
            label: requirement.label,
            detail: requirement.detail,
            env: requirement.env ?? [],
            missing: met ? [] : missing,
            met,
            satisfiedBy: missing.length === 0 ? "environment" : providedOk ? "application" : null,
            link: requirement.link ?? null,
            whenField: requirement.whenField ?? null,
            // A requirement is only worth reporting while the feature that needs it is on.
            applies: requirement.whenField ? configValue(section.id, requirement.whenField) === true : true,
          };
        })),
        fields: section.fields.map(field => renderField(section, field, choices, req)),
      })));

      res.json({ loaded: settingsLoaded(), sections });
    } catch (e) { next(e); }
  },
);

// ── Customer portal ─────────────────────────────────────────────────

/**
 * The parts of the portal's configuration that are not a single value: which clients may use it,
 * which board its tickets land on, and who has actually signed in.
 */
configurationRouter.get("/portal/overview", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const [clients, eligible, sessions, signIns, boardId] = await Promise.all([
      prisma.company.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, portalEnabled: true, portalAccentColor: true, portalLogoUrl: true,
          _count: { select: { contacts: true, tickets: true } },
        },
      }),
      prisma.contact.groupBy({
        by: ["companyId"],
        where: { isActive: true, email: { not: "" } },
        _count: { _all: true },
      }),
      prisma.portalSession.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true, createdAt: true, lastActivityAt: true, expiresAt: true, invalidatedAt: true, ipAddress: true,
          contact: { select: { firstName: true, lastName: true, email: true, company: { select: { name: true } } } },
        },
      }),
      prisma.portalLoginCode.count({ where: { consumedAt: { not: null } } }),
      resolvePortalBoardId().catch(() => null),
    ]);

    const board = boardId
      ? await prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { id: true, name: true } })
      : null;
    const eligibleByCompany = new Map(eligible.map(row => [row.companyId, row._count._all]));

    res.json({
      enabled: portalEnabled(),
      board,
      signIns,
      canEdit: has(req, Permission.SystemConfig),
      clients: clients.map(client => ({
        id: client.id,
        name: client.name,
        portalEnabled: client.portalEnabled,
        accentColor: client.portalAccentColor,
        logoUrl: client.portalLogoUrl,
        contacts: client._count.contacts,
        eligibleContacts: eligibleByCompany.get(client.id) ?? 0,
        tickets: client._count.tickets,
      })),
      sessions: sessions.map(s => ({
        id: s.id,
        contactName: `${s.contact.firstName} ${s.contact.lastName}`.trim(),
        contactEmail: s.contact.email,
        clientName: s.contact.company?.name ?? null,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        expiresAt: s.expiresAt,
        invalidatedAt: s.invalidatedAt,
        ipAddress: s.ipAddress,
        active: !s.invalidatedAt && s.expiresAt.getTime() > Date.now(),
      })),
    });
  } catch (e) { next(e); }
});

/**
 * The per-client half of the portal configuration: who may sign in, and the branding that
 * overrides the instance defaults. Kept beside the settings rather than inside them, because it
 * is a fact about a client and not about the deployment.
 */
configurationRouter.patch("/portal/clients/:companyId", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new AppError("Client not found", 404);

    const data: { portalEnabled?: boolean; portalAccentColor?: string | null; portalLogoUrl?: string | null } = {};
    if (typeof req.body?.portalEnabled === "boolean") data.portalEnabled = req.body.portalEnabled;

    if ("accentColor" in (req.body ?? {})) {
      const raw = req.body.accentColor;
      if (raw === null || raw === "") data.portalAccentColor = null;
      else {
        const text = String(raw).trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(text)) throw new AppError("An accent colour must be a hex colour such as #2563eb");
        data.portalAccentColor = text.toLowerCase();
      }
    }

    if ("logoUrl" in (req.body ?? {})) {
      const raw = req.body.logoUrl;
      if (raw === null || raw === "") data.portalLogoUrl = null;
      else {
        const text = String(raw).trim();
        if (!/^https?:\/\//i.test(text) && !text.startsWith("/")) {
          throw new AppError("A logo must be an http(s) address or a path starting with /");
        }
        data.portalLogoUrl = text;
      }
    }

    if (Object.keys(data).length === 0) throw new AppError("Nothing to change");
    await prisma.company.update({ where: { id: companyId }, data });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Writes ──────────────────────────────────────────────────────────

/**
 * Save one setting, validating it against the registry.
 *
 * The permission guard is the union of every area's write permission, because the area is named
 * by the request rather than by the path. The section's own permission is then checked against
 * the registry below, so a caller admitted by the union can still only write where the registry
 * says they may.
 */
configurationRouter.patch(
  "/:sectionId/:fieldId",
  requirePermission(
    Permission.SystemConfig, Permission.SecurityManage, Permission.BillingManage,
    Permission.KBManage, Permission.IntegrationManage, Permission.ServiceAlertManage,
  ),
  async (req: AuthRequest, res, next) => {
  try {
    const section = CONFIG_SECTIONS.find(s => s.id === String(req.params.sectionId));
    if (!section) throw new AppError("Unknown configuration section", 404);
    if (!has(req, section.writePermission)) throw new AppError("Insufficient permissions", 403);

    const fieldId = String(req.params.fieldId);
    if (!section.fields.some(f => f.id === fieldId)) throw new AppError("Unknown setting", 404);
    if (!isWritableConfigField(section.id, fieldId)) {
      throw new AppError("That setting is managed by the deployment and cannot be changed here", 403);
    }

    const result = await writeConfigValue(section.id, fieldId, req.body?.value);
    if (!result.ok) throw new AppError(result.message, 400);

    res.json({ ok: true, section: section.id, field: fieldId, value: result.value });
  } catch (e) { next(e); }
  },
);

/**
 * Clear a stored setting so it falls back to the deployment's own value.
 *
 * Its own route rather than `PATCH` with a null, because "unset" and "set to the default" are
 * different states and the screen has to be able to say which one it is in.
 */
configurationRouter.delete(
  "/:sectionId/:fieldId",
  requirePermission(
    Permission.SystemConfig, Permission.SecurityManage, Permission.BillingManage,
    Permission.KBManage, Permission.IntegrationManage, Permission.ServiceAlertManage,
  ),
  async (req: AuthRequest, res, next) => {
    try {
      const section = CONFIG_SECTIONS.find(s => s.id === String(req.params.sectionId));
      if (!section) throw new AppError("Unknown configuration section", 404);
      if (!has(req, section.writePermission)) throw new AppError("Insufficient permissions", 403);

      const fieldId = String(req.params.fieldId);
      if (!section.fields.some(f => f.id === fieldId)) throw new AppError("Unknown setting", 404);
      if (!isWritableConfigField(section.id, fieldId)) {
        throw new AppError("That setting is managed by the deployment and cannot be changed here", 403);
      }

      const result = await clearConfigValue(section.id, fieldId);
      if (!result.ok) throw new AppError(result.message, 400);
      res.json({ ok: true, section: section.id, field: fieldId, cleared: true });
    } catch (e) { next(e); }
  },
);
