import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { IntegrationHub } from "@C7NTAX/integrations";
import type { IntegrationConfig } from "@C7NTAX/integrations";
import { AppError } from "../middleware/errorHandler";

export const integrationsRouter = Router();
integrationsRouter.use(authenticate);

const hub = new IntegrationHub();

// ── Helpers ─────────────────────────────────────────────────────────

/** Load an integration from DB and hydrate the in-memory hub. */
async function loadConfig(id: string): Promise<IntegrationConfig> {
  const row = await prisma.integration.findUnique({ where: { id } });
  if (!row) throw new AppError("Integration not found", 404);
  const config: IntegrationConfig = {
    id: row.id,
    kind: row.kind as IntegrationConfig["kind"],
    name: row.name,
    enabled: row.enabled,
    credentials: row.credentials as Record<string, string>,
    settings: row.settings as Record<string, unknown>,
    status: row.status as IntegrationConfig["status"],
    errorMessage: row.errorMessage ?? undefined,
    lastSyncAt: row.lastSyncAt ?? undefined,
  };
  hub.register(config);
  return config;
}

/** Save credentials back to DB after OAuth token refresh. */
async function persistCredentials(id: string, credentials: Record<string, string>) {
  await prisma.integration.update({ where: { id }, data: { credentials } });
}

/** Upsert a Contact from synced M365 user data. */
async function upsertContactFromM365User(
  companyId: string,
  m365User: Record<string, unknown>,
  fieldMapping: Record<string, string>
) {
  const mail = (m365User.mail as string) || (m365User.userPrincipalName as string);
  if (!mail) return null;

  const existing = await prisma.contact.findFirst({
    where: { email: mail, companyId },
  });

  const data = {
    companyId,
    firstName: (m365User.givenName as string) || (m365User.displayName as string)?.split(" ")[0] || "",
    lastName: (m365User.surname as string) || (m365User.displayName as string)?.split(" ").slice(1).join(" ") || "",
    email: mail,
    phone: (m365User.businessPhones as string[])?.[0] || (m365User.mobilePhone as string) || null,
    mobilePhone: (m365User.mobilePhone as string) || null,
    title: (m365User.jobTitle as string) || null,
    isActive: (m365User.accountEnabled as boolean) !== false,
  };

  if (existing) {
    return prisma.contact.update({ where: { id: existing.id }, data });
  }
  return prisma.contact.create({ data: { ...data, isPrimary: false } });
}

// ── List available integration types ─────────────────────────────────────
integrationsRouter.get("/types", requirePermission(Permission.IntegrationView), (_req, res) => {
  res.json({
    types: [
      {
        kind: "microsoft365",
        name: "Microsoft 365",
        description: "Users, groups, licenses, and security via Microsoft Graph API",
        requiredCredentials: ["tenantId", "clientId", "clientSecret"],
        requiredScopes: ["https://graph.microsoft.com/.default"],
        settings: [
          { key: "syncUsers", label: "Sync Users", type: "boolean", default: true },
          { key: "syncContacts", label: "Create Contacts from Users", type: "boolean", default: true },
          { key: "syncLicenses", label: "Sync License Data", type: "boolean", default: true },
          { key: "syncIntervalMinutes", label: "Sync Interval (minutes)", type: "number", default: 60 },
          { key: "fieldMapping", label: "Field Mapping", type: "json", default: { displayName: "firstName", mail: "email", jobTitle: "title" } },
        ],
      },
      { kind: "connectwise", name: "ConnectWise PSA", description: "Tickets, contacts, companies, projects via ConnectWise REST API", requiredCredentials: ["companyId", "publicKey", "privateKey", "clientId", "baseUrl"] },
      { kind: "halopsa", name: "HaloPSA", description: "Tickets, clients, assets, contracts via HaloPSA OAuth API", requiredCredentials: ["tenantUrl", "clientId", "clientSecret"] },
      { kind: "kantata", name: "Kantata", description: "Workspaces, tasks, time entries, invoices via Kantata REST API", requiredCredentials: ["accessToken"] },
      { kind: "scoro", name: "Scoro", description: "Contacts, projects, invoices, events via Scoro RPC API", requiredCredentials: ["apiKey", "companyAccountId"] },
      { kind: "autotask", name: "AutoTask PSA", description: "Tickets, contacts, accounts, resources via AutoTask REST API", requiredCredentials: ["username", "password", "integrationCode"] },
      { kind: "flexpoint", name: "Flexpoint Payments", description: "Payment processing and transaction data", requiredCredentials: ["apiKey", "baseUrl"] },
      { kind: "quickbooks", name: "QuickBooks Online", description: "Invoices, payments, customers, accounts via Intuit API", requiredCredentials: ["clientId", "clientSecret", "realmId", "accessToken"] },
      { kind: "pax8", name: "Pax8", description: "Products, subscriptions, invoices", requiredCredentials: ["apiKey", "baseUrl"] },
      { kind: "avanan", name: "Avanan", description: "Email security incidents and threat data", requiredCredentials: ["apiKey", "baseUrl"] },
      { kind: "proofpoint", name: "Proofpoint", description: "Email security messages and threat data", requiredCredentials: ["principal", "secret", "baseUrl"] },
      { kind: "sentinelone", name: "SentinelOne", description: "Threats, agents, activities via S1 API", requiredCredentials: ["apiToken", "baseUrl"] },
      { kind: "itglue", name: "ITGlue", description: "Configurations, passwords, documents, contacts", requiredCredentials: ["apiKey", "baseUrl"] },
      { kind: "azure", name: "Azure", description: "Resource management, security alerts via Azure ARM", requiredCredentials: ["accessToken", "subscriptionId"] },
      { kind: "aws", name: "AWS", description: "Cloud resource inventory via AWS APIs", requiredCredentials: ["accessKeyId", "secretAccessKey", "region"] },
      { kind: "azure_ad_sso", name: "Azure AD SSO", description: "SAML 2.0 & OpenID Connect single sign-on. Federation, JIT provisioning, group-to-role mapping.", requiredCredentials: ["tenantId", "clientId"], requiredScopes: ["openid", "profile", "email", "User.Read"], settings: [{ key: "protocol", label: "Protocol", type: "select", default: "saml", options: ["saml", "oidc"] }, { key: "jitProvisioning", label: "JIT User Provisioning", type: "boolean", default: true }, { key: "mfaEnforced", label: "Enforce MFA via Conditional Access", type: "boolean", default: true }, { key: "entityId", label: "SP Entity ID (SAML)", type: "string" }, { key: "acsUrl", label: "ACS URL (SAML)", type: "string" }, { key: "redirectUri", label: "Redirect URI (OIDC)", type: "string" }, { key: "groupRoleMapping", label: "Group-to-Role Mapping", type: "json", default: { "C7NTAX-Admin": "admin", "C7NTAX-Technician": "technician", "C7NTAX-Manager": "manager", "C7NTAX-Billing": "billing_admin", "C7NTAX-Client": "client" } }] },
    ],
  });
});

// ── List configured integrations ─────────────────────────────────────────
integrationsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req, res, next) => {
  try {
    const rows = await prisma.integration.findMany({ orderBy: { createdAt: "desc" } });
    for (const row of rows) {
      hub.register({
        id: row.id, kind: row.kind as IntegrationConfig["kind"], name: row.name,
        enabled: row.enabled,
        credentials: row.credentials as Record<string, string>,
        settings: row.settings as Record<string, unknown>,
        status: row.status as IntegrationConfig["status"],
        errorMessage: row.errorMessage ?? undefined,
        lastSyncAt: row.lastSyncAt ?? undefined,
      });
    }
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// ── Create integration ────────────────────────────────────────────────────
integrationsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { kind, name, credentials, settings } = req.body;
    if (!kind || !name) throw new AppError("kind and name are required", 400);
    const row = await prisma.integration.create({
      data: { kind, name, credentials: credentials || {}, settings: settings || {} },
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// ── Update integration ────────────────────────────────────────────────────
integrationsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, credentials, settings, enabled } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (credentials !== undefined) data.credentials = credentials;
    if (settings !== undefined) data.settings = settings;
    if (enabled !== undefined) data.enabled = enabled;
    const row = await prisma.integration.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (e) { next(e); }
});

// ── Test connection ───────────────────────────────────────────────────────
integrationsRouter.post("/:id/test", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const config = await loadConfig(req.params.id!);
    const adapter = hub.getAdapter(config.kind);
    if (!adapter) throw new AppError(`Unknown integration kind: ${config.kind}`, 400);
    const ok = await adapter.testConnection(config);
    await persistCredentials(req.params.id!, config.credentials as Record<string, string>);
    await prisma.integration.update({
      where: { id: req.params.id },
      data: { status: ok ? "connected" : "error", errorMessage: ok ? null : "Connection test failed" },
    });
    res.json({ connected: ok });
  } catch (e) { next(e); }
});

// ── Sync integration ──────────────────────────────────────────────────────
integrationsRouter.post("/:id/sync", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const config = await loadConfig(req.params.id!);
    const adapter = hub.getAdapter(config.kind);
    if (!adapter) throw new AppError(`Unknown integration kind: ${config.kind}`, 400);

    // Create sync log
    const log = await prisma.syncLog.create({
      data: { integrationId: req.params.id, status: "running", entityType: "all", startedAt: new Date() },
    });

    const result = await adapter.sync(config);

    // Persist credentials (may have been updated with new tokens)
    await persistCredentials(req.params.id!, config.credentials as Record<string, string>);

    let recordsCreated = 0;
    let recordsUpdated = 0;

    // ── Persist Microsoft 365 synced data ──
    if (config.kind === "microsoft365") {
      const settings = (config.settings || {}) as Record<string, unknown>;
      const syncContacts = settings.syncContacts !== false;

      // Users
      if ((result as any).users) {
        const users = (result as any).users as Array<Record<string, unknown>>;
        for (const u of users) {
          const azureId = u.id as string;
          const existing = await prisma.m365User.findUnique({ where: { azureObjectId: azureId } });
          const userData = {
            integrationId: req.params.id,
            azureObjectId: azureId,
            userPrincipalName: (u.userPrincipalName as string) || "",
            displayName: (u.displayName as string) || "",
            givenName: (u.givenName as string) || null,
            surname: (u.surname as string) || null,
            mail: (u.mail as string) || null,
            jobTitle: (u.jobTitle as string) || null,
            department: (u.department as string) || null,
            officeLocation: (u.officeLocation as string) || null,
            mobilePhone: (u.mobilePhone as string) || null,
            businessPhone: (u.businessPhones as string[])?.[0] || null,
            usageLocation: (u.usageLocation as string) || null,
            accountEnabled: (u.accountEnabled as boolean) !== false,
            raw: u as any,
            lastSyncedAt: new Date(),
          };

          if (existing) {
            await prisma.m365User.update({ where: { id: existing.id }, data: userData });
            recordsUpdated++;
          } else {
            const created = await prisma.m365User.create({ data: userData });
            recordsCreated++;

            // Create/update Contact if enabled
            if (syncContacts && u.mail) {
              try {
                const contact = await upsertContactFromM365User(
                  "", // No default company — admins can assign later
                  u,
                  (settings.fieldMapping as Record<string, string>) || {}
                );
                if (contact) {
                  await prisma.m365User.update({
                    where: { id: created.id },
                    data: { contactId: contact.id },
                  });
                }
              } catch { /* contact creation is best-effort */ }
            }
          }
        }
      }

      // Groups
      if ((result as any).groups) {
        const groups = (result as any).groups as Array<Record<string, unknown>>;
        for (const g of groups) {
          const azureId = g.id as string;
          const existing = await prisma.m365Group.findUnique({ where: { azureObjectId: azureId } });
          const data = {
            integrationId: req.params.id,
            azureObjectId: azureId,
            displayName: (g.displayName as string) || "",
            description: (g.description as string) || null,
            mail: (g.mail as string) || null,
            visibility: (g.visibility as string) || null,
            memberCount: 0,
            raw: g as any,
            lastSyncedAt: new Date(),
          };
          if (existing) {
            await prisma.m365Group.update({ where: { id: existing.id }, data });
            recordsUpdated++;
          } else {
            await prisma.m365Group.create({ data });
            recordsCreated++;
          }
        }
      }

      // Subscriptions / Licenses
      if ((result as any).subscriptions) {
        const subs = (result as any).subscriptions as Array<Record<string, unknown>>;
        for (const s of subs) {
          const skuId = s.skuId as string;
          const existing = await prisma.m365Subscription.findFirst({
            where: { integrationId: req.params.id, skuId },
          });
          const prepaid = (s.prepaidUnits || {}) as Record<string, number>;
          const data = {
            integrationId: req.params.id,
            skuId,
            skuPartNumber: (s.skuPartNumber as string) || "",
            displayName: `${(s.skuPartNumber as string) || ""} (${skuId})`,
            enabled: prepaid.enabled || 0,
            suspended: prepaid.suspended || 0,
            assigned: (s.consumedUnits as number) || 0,
            unit: "user",
            raw: s as any,
            lastSyncedAt: new Date(),
          };
          if (existing) {
            await prisma.m365Subscription.update({ where: { id: existing.id }, data });
            recordsUpdated++;
          } else {
            await prisma.m365Subscription.create({ data });
            recordsCreated++;
          }
        }
      }
    }

    // ── Generic persistence: store synced data for ALL integration kinds ──
    // Each adapter returns its data under named keys (e.g. result.tickets, result.contacts)
    const syncDataKeys = Object.keys(result).filter(
      k => !["success", "kind", "recordsProcessed", "errors", "syncedAt"].includes(k) && Array.isArray((result as any)[k])
    );
    for (const key of syncDataKeys) {
      const items = (result as any)[key] as Array<Record<string, unknown>>;
      for (const item of items) {
        const externalId = (item.id || item.Id || item.externalId || String(Math.random())) as string;
        const displayField = item.displayName || item.DisplayName || item.name || item.Name || item.title || item.Title || item.subject || key;
        try {
          await prisma.syncedEntity.upsert({
            where: {
              integrationId_entityType_externalId: {
                integrationId: req.params.id,
                entityType: key,
                externalId: String(externalId),
              },
            },
            create: {
              integrationId: req.params.id,
              entityKind: config.kind,
              entityType: key,
              externalId: String(externalId),
              displayName: String(displayField).slice(0, 200),
              data: item as any,
              lastSyncedAt: new Date(),
            },
            update: {
              displayName: String(displayField).slice(0, 200),
              data: item as any,
              lastSyncedAt: new Date(),
            },
          });
        } catch { /* duplicate key = skip */ }
      }
    }

    // Update sync log
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: result.success ? "success" : "failed",
        recordsProcessed: result.recordsProcessed,
        recordsCreated,
        recordsUpdated,
        recordsFailed: result.errors.length,
        errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
        completedAt: new Date(),
      },
    });

    // Update integration status
    await prisma.integration.update({
      where: { id: req.params.id },
      data: { lastSyncAt: new Date(), status: result.success ? "connected" : "error", errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null },
    });

    res.json({
      success: result.success,
      recordsProcessed: result.recordsProcessed,
      recordsCreated,
      recordsUpdated,
      errors: result.errors,
    });
  } catch (e) { next(e); }
});

// ── Get synced data for any integration ────────────────────────────────────
integrationsRouter.get("/:id/synced-entities", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const { entityType, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { integrationId: req.params.id };
    if (entityType) where.entityType = entityType;
    const [items, total] = await Promise.all([
      prisma.syncedEntity.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { lastSyncedAt: "desc" } }),
      prisma.syncedEntity.count({ where }),
    ]);
    res.json({ data: items, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get entity types available for an integration ─────────────────────────
integrationsRouter.get("/:id/entity-types", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const types = await prisma.syncedEntity.findMany({
      where: { integrationId: req.params.id },
      distinct: ["entityType"],
      select: { entityType: true },
    });
    const counts = await Promise.all(types.map(async (t: { entityType: string }) => ({
      entityType: t.entityType,
      count: await prisma.syncedEntity.count({ where: { integrationId: req.params.id, entityType: t.entityType } }),
    })));
    res.json({ data: counts });
  } catch (e) { next(e); }
});

// ── Get M365 synced data ──────────────────────────────────────────────────
integrationsRouter.get("/:id/m365/users", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const users = await prisma.m365User.findMany({
      where: { integrationId: req.params.id },
      orderBy: { displayName: "asc" },
    });
    res.json({ data: users });
  } catch (e) { next(e); }
});

integrationsRouter.get("/:id/m365/subscriptions", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const subs = await prisma.m365Subscription.findMany({
      where: { integrationId: req.params.id },
      orderBy: { displayName: "asc" },
    });
    res.json({ data: subs });
  } catch (e) { next(e); }
});

integrationsRouter.get("/:id/sync-logs", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const logs = await prisma.syncLog.findMany({
      where: { integrationId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ data: logs });
  } catch (e) { next(e); }
});

// ── Delete integration ────────────────────────────────────────────────────
integrationsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.integration.delete({ where: { id: req.params.id } });
    hub.remove(req.params.id!);
    res.json({ message: "Integration removed" });
  } catch (e) { next(e); }
});
