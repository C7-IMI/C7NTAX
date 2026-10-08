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
  configText,
  configValue,
  environmentSupplied,
  fallbackValue,
  isWritableConfigField,
  savedValue,
  settingsLoaded,
  writeConfigValue,
} from "../services/appSettings";
import { resolvePortalBoardId } from "../services/portalBoard";
import { portalAddress } from "../services/portalAddress";
import { portalEnabled } from "../services/portalAuth";
import {
  asVisibility, clientPortalOverrides, instancePortalPolicy, resolvePortalPolicy, resolvePolicyFrom,
} from "../services/portalPolicy";
import { listPortalTickets, loadPortalTicket } from "../services/portalTickets";
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
 * what each of them is allowed to see and do, which board its tickets land on, and who has
 * actually signed in.
 *
 * Each client's row carries both halves of its policy — what the client itself was set to
 * (`overrides`, where null means "inherit") and what actually applies (`policy`), with the level
 * each answer came from — because the useful question is not "what is the setting" but "what will
 * this customer get, and because of what".
 */
configurationRouter.get("/portal/overview", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const [clients, eligible, sessions, signIns, boardId, boards] = await Promise.all([
      prisma.company.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, portalEnabled: true, portalAccentColor: true, portalLogoUrl: true,
          portalVisibility: true, portalAllowTicketCreation: true, portalAllowReplies: true, portalBoardId: true,
          _count: { select: { contacts: true, tickets: true } },
        },
      }),
      prisma.contact.groupBy({
        by: ["companyId"],
        where: { isActive: true, email: { not: "" }, NOT: { portalAccess: false } },
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
      prisma.serviceBoard.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    const board = boardId
      ? await prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { id: true, name: true } })
      : null;
    const eligibleByCompany = new Map(eligible.map(row => [row.companyId, row._count._all]));
    const boardNames = new Map(boards.map(b => [b.id, b.name]));
    const instance = instancePortalPolicy();

    // Where a customer is told to go: the address saved on this screen if there is one, since a
    // deployment may serve the portal on a hostname of its own, and the deployment's own origin
    // otherwise — see `services/portalAddress`.
    const address = portalAddress(typeof req.headers.origin === "string" ? req.headers.origin : "");

    res.json({
      enabled: portalEnabled(),
      portalUrl: address.url,
      portalUrlSource: address.source,
      board,
      boards: boards.map(b => ({ id: b.id, name: b.name })),
      // What the deployment itself would give a customer, so each client's row can be read against it.
      instancePolicy: { ...instance, boardName: instance.boardId ? boardNames.get(instance.boardId) ?? null : null },
      signIns,
      canEdit: has(req, Permission.SystemConfig),
      clients: clients.map(client => {
        const policy = resolvePolicyFrom({
          client: {
            visibility: asVisibility(client.portalVisibility),
            allowTicketCreation: client.portalAllowTicketCreation,
            allowReplies: client.portalAllowReplies,
            boardId: client.portalBoardId,
          },
          contact: null,
        });
        return {
          id: client.id,
          name: client.name,
          portalEnabled: client.portalEnabled,
          accentColor: client.portalAccentColor,
          logoUrl: client.portalLogoUrl,
          contacts: client._count.contacts,
          eligibleContacts: eligibleByCompany.get(client.id) ?? 0,
          tickets: client._count.tickets,
          overrides: {
            visibility: asVisibility(client.portalVisibility),
            allowTicketCreation: client.portalAllowTicketCreation,
            allowReplies: client.portalAllowReplies,
            boardId: client.portalBoardId,
          },
          policy: {
            ...policy,
            boardName: policy.boardId ? boardNames.get(policy.boardId) ?? null : null,
          },
        };
      }),
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

/** The values a client's portal policy may be set to; `null` everywhere means "inherit". */
function readPolicyBody(body: Record<string, unknown>) {
  const data: {
    portalVisibility?: string | null;
    portalAllowTicketCreation?: boolean | null;
    portalAllowReplies?: boolean | null;
    portalBoardId?: string | null;
  } = {};

  if ("visibility" in body) {
    if (body.visibility === null || body.visibility === "" || body.visibility === "inherit") data.portalVisibility = null;
    else {
      const value = asVisibility(body.visibility);
      if (!value) throw new AppError("Ticket visibility must be \"contact\" (their own tickets) or \"company\" (every ticket at the client)");
      data.portalVisibility = value;
    }
  }
  if ("allowTicketCreation" in body) {
    if (body.allowTicketCreation === null || body.allowTicketCreation === "inherit") data.portalAllowTicketCreation = null;
    else if (typeof body.allowTicketCreation === "boolean") data.portalAllowTicketCreation = body.allowTicketCreation;
    else throw new AppError("Raising tickets must be true, false or null to inherit");
  }
  if ("allowReplies" in body) {
    if (body.allowReplies === null || body.allowReplies === "inherit") data.portalAllowReplies = null;
    else if (typeof body.allowReplies === "boolean") data.portalAllowReplies = body.allowReplies;
    else throw new AppError("Replying must be true, false or null to inherit");
  }
  if ("boardId" in body) {
    if (body.boardId === null || body.boardId === "" || body.boardId === "inherit") data.portalBoardId = null;
    else data.portalBoardId = String(body.boardId).trim();
  }
  return data;
}

/**
 * One client's portal policy. A field set here applies to every contact of that client who has not
 * been overruled individually; clearing it hands the answer back to the instance's own setting.
 */
configurationRouter.patch("/portal/clients/:companyId", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new AppError("Client not found", 404);

    const data: {
      portalEnabled?: boolean; portalAccentColor?: string | null; portalLogoUrl?: string | null;
      portalVisibility?: string | null; portalAllowTicketCreation?: boolean | null;
      portalAllowReplies?: boolean | null; portalBoardId?: string | null;
    } = {};
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

    Object.assign(data, readPolicyBody(req.body ?? {}));

    // A board that does not exist would silently fall back at ticket time, so it is refused here
    // where somebody can see why.
    const boardId = data.portalBoardId;
    if (boardId) {
      const board = await prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { id: true, isActive: true } });
      if (!board) throw new AppError("That service board does not exist");
      if (!board.isActive) throw new AppError("That service board is not active — pick one that is");
    }

    if (Object.keys(data).length === 0) throw new AppError("Nothing to change");
    await prisma.company.update({ where: { id: companyId }, data });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * The contacts of one client, with their own overrules. A contact is a person, not a role: the
 * office manager who runs the account needs to see every ticket at the client, and the person who
 * only ever raises the occasional printer fault does not — and neither of them is a `User`.
 */
configurationRouter.get("/portal/clients/:companyId/contacts", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new AppError("Client not found", 404);

    const contacts = await prisma.contact.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
      select: {
        id: true, firstName: true, lastName: true, email: true, isActive: true, isPrimary: true, title: true,
        portalAccess: true, portalVisibility: true,
        _count: { select: { portalSessions: true } },
      },
    });
    const clientPolicy = resolvePolicyFrom({
      client: await clientPortalOverrides(companyId),
      contact: null,
    });

    res.json({
      clientPolicy,
      contacts: contacts.map(contact => ({
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
        title: contact.title,
        isActive: contact.isActive,
        isPrimary: contact.isPrimary,
        signIns: contact._count.portalSessions,
        overrides: { access: contact.portalAccess, visibility: asVisibility(contact.portalVisibility) },
        // What this person gets, which is the client's policy unless they are overruled.
        effective: resolvePolicyFrom({
          client: null,
          contact: { access: contact.portalAccess, visibility: asVisibility(contact.portalVisibility) },
        }).visibility,
        // Whether they may use the portal at all: the client's switch, and their own.
        allowed: contact.portalAccess !== false && contact.isActive,
      })),
      canEdit: has(req, Permission.SystemConfig),
    });
  } catch (e) { next(e); }
});

/**
 * What one customer would see, without becoming one.
 *
 * The preview answers with the same policy resolution, the same scoping query and the same
 * public-notes-only rule the portal itself uses — so an administrator looking at this is looking at
 * the real thing rather than at a drawing of it. It changes nothing: no portal session, no customer
 * identity, no code, and every action in the preview is simulated in the browser.
 */
configurationRouter.get("/portal/clients/:companyId/preview", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true, name: true, portalEnabled: true, portalAccentColor: true, portalLogoUrl: true,
        portalVisibility: true, portalAllowTicketCreation: true, portalAllowReplies: true, portalBoardId: true,
      },
    });
    if (!company) throw new AppError("Client not found", 404);

    const contacts = await prisma.contact.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true, isPrimary: true, portalAccess: true, portalVisibility: true },
    });

    // Whichever contact is being simulated: the one asked for, else the client's primary person,
    // else the first person they have. Somebody with no portal access is still previewable — that
    // is exactly the state an administrator wants to look at.
    const requestedId = typeof req.query.contactId === "string" ? req.query.contactId : "";
    const contact = contacts.find(c => c.id === requestedId) ?? contacts[0] ?? null;

    const policy = await resolvePortalPolicy(companyId, contact?.id);
    const scope = contact
      ? { contactId: contact.id, companyId, visibility: policy.visibility }
      : null;

    const [tickets, board, clientTicketTotal] = await Promise.all([
      scope ? listPortalTickets(scope, { limit: 25 }) : Promise.resolve({ data: [], total: 0 }),
      policy.boardId
        ? prisma.serviceBoard.findUnique({ where: { id: policy.boardId }, select: { id: true, name: true } })
        : resolvePortalBoardId(companyId).then(id => prisma.serviceBoard.findUnique({ where: { id }, select: { id: true, name: true } })).catch(() => null),
      prisma.ticket.count({ where: { companyId } }),
    ]);

    const instanceBranding = {
      name: configText("workspace", "companyName") || "Customer portal",
      accentColor: company.portalAccentColor || configText("portal", "accentColor") || null,
      logoUrl: company.portalLogoUrl || configText("portal", "logoUrl") || null,
    };

    res.json({
      client: { id: company.id, name: company.name, portalEnabled: company.portalEnabled },
      branding: {
        ...instanceBranding,
        welcomeText: configText("portal", "welcomeText") || "",
        supportEmail: configText("portal", "supportEmail") || "",
      },
      policy,
      board,
      contact: contact
        ? {
          id: contact.id,
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          firstName: contact.firstName,
          email: contact.email,
          isPrimary: contact.isPrimary,
          // Whether the portal would let this person in at all: the client's switch, their own, and
          // the fact that sign-in needs an active contact.
          allowed: company.portalEnabled && contact.portalAccess !== false,
        }
        : null,
      contacts: contacts.map(c => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        email: c.email,
        isPrimary: c.isPrimary,
        allowed: company.portalEnabled && c.portalAccess !== false,
        visibility: c.portalVisibility === "contact" || c.portalVisibility === "company" ? c.portalVisibility : policy.visibility,
      })),
      tickets: tickets.data,
      ticketTotal: tickets.total,
      // Everything at the client, so the preview can say what the visibility setting is keeping back.
      clientTicketTotal,
    });
  } catch (e) { next(e); }
});

/** One ticket as the portal would return it to that contact — including the 404 when it would not. */
configurationRouter.get("/portal/clients/:companyId/preview/tickets/:ticketId", requirePermission(Permission.ClientView), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.params.companyId);
    const contactId = typeof req.query.contactId === "string" ? req.query.contactId : "";
    const contact = await prisma.contact.findFirst({
      where: contactId ? { id: contactId, companyId } : { companyId, isActive: true },
      orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }],
      select: { id: true, email: true },
    });
    if (!contact) throw new AppError("That client has no contact to preview", 404);

    const policy = await resolvePortalPolicy(companyId, contact.id);
    const scope = { contactId: contact.id, companyId, visibility: policy.visibility };
    res.json(await loadPortalTicket(String(req.params.ticketId), scope, contact.email));
  } catch (e) { next(e); }
});

/** One contact's overrules: no portal at all, or a different ticket visibility from their client. */
configurationRouter.patch("/portal/contacts/:contactId", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const contactId = String(req.params.contactId);
    const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
    if (!contact) throw new AppError("Contact not found", 404);

    const data: { portalAccess?: boolean | null; portalVisibility?: string | null } = {};
    if ("access" in (req.body ?? {})) {
      const raw = req.body.access;
      if (raw === null || raw === "inherit") data.portalAccess = null;
      else if (typeof raw === "boolean") data.portalAccess = raw;
      else throw new AppError("Portal access must be true, false or null to inherit");
    }
    if ("visibility" in (req.body ?? {})) {
      const raw = req.body.visibility;
      if (raw === null || raw === "" || raw === "inherit") data.portalVisibility = null;
      else {
        const value = asVisibility(raw);
        if (!value) throw new AppError("Ticket visibility must be \"contact\" or \"company\"");
        data.portalVisibility = value;
      }
    }
    if (Object.keys(data).length === 0) throw new AppError("Nothing to change");

    await prisma.contact.update({ where: { id: contactId }, data });
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
