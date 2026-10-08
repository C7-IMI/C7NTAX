import { Router } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { IntegrationHub } from "@C7NTAX/integrations";
import type { IntegrationConfig } from "@C7NTAX/integrations";
import { AppError } from "../middleware/errorHandler";
import { liveStatusEnabled, noteManualVerification, verifyDueIntegrations } from "../services/integrationHealth";
import { CONNECTOR_SETUP } from "../services/connectorSetup";
import { syncFlexpoint } from "../services/flexpoint";
import { inactivityReport, offboardUser } from "../services/m365Inactivity";

export const cloudConnectRouter = Router();
cloudConnectRouter.use(authenticate);

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

// ── Credential helpers for field-level error diagnosis ──────────────────

/**
 * The identity of a synced record.
 *
 * `id` in its common spellings first, because a vendor id is the only thing that keeps a row tied to
 * the record it came from. When a payload carries no id, the record is hashed instead: a stable
 * value, so repeated syncs update one row rather than inserting a new copy of it every time.
 */
function stableEntityId(item: Record<string, unknown>, entityType: string): { externalId: string; derived: boolean } {
  for (const field of ["id", "Id", "ID", "externalId", "ExternalId", "uuid", "key"]) {
    const value = item[field];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return { externalId: text, derived: false };
    }
  }
  const digest = createHash("sha1").update(JSON.stringify(item)).digest("hex").slice(0, 32);
  return { externalId: `derived-${entityType}-${digest}`, derived: true };
}

function getRequiredCredentials(kind: string): string[] {
  // Derived from the catalogue rather than kept alongside it: the two drifted once, and a save that
  // demands a credential the adapter never reads is worse than no validation at all.
  return CONNECTOR_SPECS.find(spec => spec.kind === kind)?.credentials.filter(c => !c.optional).map(c => c.key) ?? [];
}

function formatCredLabel(cred: string): string {
  return cred.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
}

function getCredFix(cred: string): string {
  const fixes: Record<string, string> = {
    tenantId: "Find it in Azure Portal → Azure AD → Overview → Tenant ID, or use your primary domain (contoso.onmicrosoft.com)",
    clientId: "Create an app registration → copy the Application (client) ID",
    clientSecret: "Go to Certificates & secrets → New client secret → copy the value immediately",
    domain: "Enter your verified domain (e.g., contoso.com)",
    username: "Service account email or username for API access",
    integrationCode: "Find in AutoTask → Admin → API Security → Integration Code",
    accessToken: "Obtain an OAuth access token from your provider's authorization endpoint",
    apiKey: "Generate in your provider's admin panel (usually Settings → API Keys)",
    apiToken: "Generate an API token in your provider's admin console",
    baseUrl: "Full URL of your instance, e.g., https://company.halopsa.com/api",
    tenantUrl: "Your tenant URL, e.g., https://company.halopsa.com",
    companyId: "Your company identifier used in the login URL",
    publicKey: "ConnectWise → System → Members → API Keys → copy Public Key",
    privateKey: "ConnectWise → System → Members → API Keys → copy Private Key",
    realmId: "QuickBooks Online → Settings → Company Info → Company ID",
    principal: "Proofpoint service principal (API username or email)",
    secret: "Proofpoint API secret from your admin console",
    companyAccountId: "Scoro → Settings → Site → Account ID",
    accessKeyId: "AWS IAM → your user → Security credentials → Create access key",
    secretAccessKey: "Shown once when you create an AWS access key",
    region: "AWS region code, e.g., us-east-1, eu-west-2",
    subscriptionId: "Azure Portal → Subscriptions → copy Subscription ID",
    apiSecret: "FlexPoint → Settings → WebAPI → New API Credentials → Create Token, then copy the credential it shows you",
    site: "The Scoro site subdomain only — `acme` for acme.scoro.com",
    consoleUrl: "Your SentinelOne console address, e.g. https://usea1-acme.sentinelone.net",
    appId: "The application id issued to your API application in the vendor's portal",
    appSecret: "The application secret that belongs with the application id",
    refreshToken: "From the provider's OAuth 2.0 flow — the long-lived token that mints short-lived access tokens",
    sessionToken: "Only for temporary AWS credentials from STS AssumeRole or IAM Identity Center",
  };
  return fixes[cred] || `Enter a valid ${formatCredLabel(cred)}`;
}

function getCredExample(cred: string): string {
  const ex: Record<string, string> = {
    tenantId: "contoso.onmicrosoft.com", clientId: "00000000-0000-0000-0000-000000000000",
    clientSecret: "abc123~xyz789...", domain: "contoso.com", username: "api@company.com",
    integrationCode: "ABCDEF123456", accessToken: "eyJ0eXAiOiJKV1Qi...", apiKey: "sk-abc123...",
    apiToken: "s1-api-token-abc...", baseUrl: "https://api-na.myconnectwise.net/v4_6_release/apis/3.0",
    tenantUrl: "https://company.halopsa.com", companyId: "mycompany",
    publicKey: "-----BEGIN PUBLIC KEY-----...", privateKey: "-----BEGIN PRIVATE KEY-----...",
    realmId: "4620816365012345678", principal: "api-user@company.com",
    secret: "abc123xyz...", companyAccountId: "12345", accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1", subscriptionId: "00000000-0000-0000-0000-000000000000",
    apiSecret: "the value FlexPoint shows once, when the credential is created",
    site: "acme", consoleUrl: "https://usea1-acme.sentinelone.net",
    appId: "b1f2c3d4-5678-90ab-cdef-1234567890ab", appSecret: "abc123xyz...",
    refreshToken: "AB1172107280413xYZ...", sessionToken: "IQoJb3JpZ2luX2VjE...",
  };
  return ex[cred] || `Enter your ${formatCredLabel(cred)}`;
}

function checkCredFormat(key: string, val: string): string | null {
  const v = val.trim();
  if (v === "xxx" || v === "..." || v === "changeme" || v === "your-" || v === "test")
    return `${formatCredLabel(key)} appears to be a placeholder — enter the real value`;
  if ((key === "clientId" || key === "tenantId" || key === "subscriptionId") && !v.includes("-") && v.length < 20)
    return `${formatCredLabel(key)} should be a GUID`;
  if (key === "realmId" && !/^\d{10,}$/.test(v))
    return `${formatCredLabel(key)} should be a numeric company ID (10+ digits)`;
  if (key === "region" && !/^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(v) && !/^(us|eu|au|in)$/.test(v))
    return `${formatCredLabel(key)} should be an AWS region code (us-east-1) or a Harmony Email region (us, eu, au, in)`;
  if (key === "site" && /[./:]/.test(v))
    return "Site takes the subdomain only — enter `acme`, not acme.scoro.com";
  if ((key === "consoleUrl" || key === "tenantUrl" || key === "baseUrl") && v && !/^https?:\/\//i.test(v))
    return `${formatCredLabel(key)} should be a full URL starting with https://`;
  return null;
}

/**
 * The connector catalogue: everything the UI needs to configure a connector, written against the
 * vendor's own API documentation — the host, the authentication scheme, the fields the *adapter*
 * actually reads, the options it actually honours, and where that is documented.
 *
 * This list is the promise the form makes to whoever fills it in, and `GET /api/cloudconnect/types`
 * is the only way the web learns about it. It is deliberately not inferred from the adapters: the
 * two drifted apart once already, and the result was a form that asked for an "API key" where the
 * vendor wanted an application id and secret, or a base URL for APIs whose host is fixed by the
 * vendor. When an adapter changes the credentials it reads, this changes with it.
 */
interface CredentialFieldSpec {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  options?: string[];
  placeholder?: string;
  hint: string;
  /** Omitted means required. Optional fields are ones the adapter has a working default for. */
  optional?: boolean;
}

interface SettingFieldSpec {
  key: string;
  label: string;
  type: "boolean" | "number" | "string" | "select" | "json";
  default?: unknown;
  options?: string[];
  hint?: string;
}

interface ConnectorSpec {
  kind: string;
  name: string;
  description: string;
  credentials: CredentialFieldSpec[];
  settings?: SettingFieldSpec[];
  guidance: { tone?: "info" | "warn"; text: string };
  docs: { url: string; label: string };
  requiredScopes?: string[];
}

const CONNECTOR_SPECS: ConnectorSpec[] = [
  {
    kind: "microsoft365",
    name: "Microsoft 365",
    description: "Users, groups, licences and sign-in activity through Microsoft Graph.",
    credentials: [
      { key: "tenantId", label: "Directory (tenant) ID", hint: "Entra admin centre → Overview → Directory (tenant) ID. Your verified domain name works too (contoso.onmicrosoft.com)." },
      { key: "clientId", label: "Application (client) ID", type: "text", hint: "Entra admin centre → App registrations → your app → Overview. The Deploy OAuth app wizard fills this in for you." },
      { key: "clientSecret", label: "Client secret value", type: "password", hint: "Certificates & secrets → New client secret. Copy the *value* immediately — it is never shown again." },
    ],
    settings: [
      { key: "syncUsers", label: "Sync users", type: "boolean", default: true, hint: "GET /users — the account fields listed in the users select. Turning it off leaves the stored users alone." },
      { key: "syncGroups", label: "Sync groups", type: "boolean", default: true, hint: "GET /groups — name, description, mail address and visibility." },
      { key: "syncContacts", label: "Create contacts from users", type: "boolean", default: true, hint: "Writes each user through to C7NTAX contacts, matched on email address." },
      { key: "syncLicenses", label: "Sync licence data", type: "boolean", default: true, hint: "GET /subscribedSkus — enabled, consumed and suspended counts per SKU. This collection takes no $top or $select, so none is sent." },
      { key: "fieldMapping", label: "Field mapping", type: "json", default: { displayName: "firstName", mail: "email", jobTitle: "title" }, hint: "Which C7NTAX contact field each Graph user field lands in: {\"Graph field\": \"C7NTAX field\"}." },
    ],
    guidance: {
      tone: "info",
      text: "App-only access: the app registration needs the Graph *application* permissions you intend to use (User.Read.All, Group.Read.All, Organization.Read.All) and an administrator must grant consent for them once — the wizard does that step. Syncing runs when you press Sync now: nothing in this product schedules a per-connector interval, so the connection does not read your tenant on its own. Sign-in activity is read separately because it needs Entra ID P1 and AuditLog.Read.All; when the tenant cannot answer, the sync reports it and continues with everything else. This connector reads only; nothing is ever written back into your tenant.",
    },
    docs: { url: "https://learn.microsoft.com/en-us/graph/api/overview", label: "Microsoft Graph API reference" },
    requiredScopes: ["https://graph.microsoft.com/.default"],
  },
  {
    kind: "connectwise",
    name: "ConnectWise PSA",
    description: "Tickets, contacts, companies and projects through the ConnectWise Manage REST API.",
    credentials: [
      { key: "baseUrl", label: "API base URL", type: "url", placeholder: "https://api-na.myconnectwise.net/v4_6_release/apis/3.0", hint: "Region host plus codebase plus /apis/3.0: api-na (North America), api-eu (Europe), api-au (Australia). Date-versioned codebases look like v2024_1 instead of v4_6_release. Leave empty for a North American production tenant.", optional: true },
      { key: "companyId", label: "Company identifier", hint: "ConnectWise Manage → System → My Company → the Company ID you sign in with. The codebase is taken from the credential, not the address." },
      { key: "publicKey", label: "API public key", type: "password", hint: "System → Members → API Members → API Keys → copy the public key. The API member's username is companyId+publicKey." },
      { key: "privateKey", label: "API private key", type: "password", hint: "The private key is shown once, when the API key is created." },
      { key: "clientId", label: "Client ID", hint: "ConnectWise issues one per integration through the ClientID Access Request Form at developer.connectwise.com/ClientID (approval can take a few days). Every call is rejected without it." },
    ],
    settings: [
      { key: "pageSize", label: "Records per page (pageSize, max 1000)", type: "number", default: 200, hint: "ConnectWise defaults to 25; 200 is a reasonable middle." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Caps how far paging walks a collection in one sync." },
    ],
    guidance: {
      tone: "info",
      text: "ConnectWise authenticates with a Basic header built from companyId+publicKey : privateKey, and requires a registered clientId on every call — the client id is not something you can generate yourself, so apply for it first. The tenant (codebase) is carried in the credential rather than the hostname, which is why the base URL only has to name the right region and release. Health-check with /system/info.",
    },
    docs: { url: "https://developer.connectwise.com/Products/ConnectWise_PSA", label: "ConnectWise PSA developer documentation" },
  },
  {
    kind: "halopsa",
    name: "HaloPSA",
    description: "Tickets, clients, assets and contracts through the HaloPSA API.",
    credentials: [
      { key: "tenantUrl", label: "Tenant URL", type: "url", placeholder: "https://company.halopsa.com", hint: "The address you sign in to Halo at — the API lives under it at /api, so do not add /api here." },
      { key: "clientId", label: "API application client ID", hint: "Configuration → Integrations → Halo API → Authorise a new application → Client Credentials. The application's permissions are set on its own permissions tab." },
      { key: "clientSecret", label: "API application client secret", type: "password", hint: "Issued with the client id when the application is authorised." },
      { key: "scope", label: "Scope", placeholder: "all", hint: "The permissions the token should carry. `all` requests everything the application was granted; name specific permissions to narrow it.", optional: true },
      { key: "tokenUrl", label: "Token URL override", type: "url", placeholder: "https://auth.halopsa.com/token?tenant=company", hint: "Only needed if C7NTAX cannot work out where to authenticate. Hosted tenants use the auth host with a tenant parameter; on-premise installs use <tenant>/auth/token, which is tried automatically.", optional: true },
    ],
    settings: [
      { key: "pageSize", label: "Records per page (page_size)", type: "number", default: 100, hint: "Halo's own Invoices example uses 100; its documented maximum is not published." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Paging is page_no/page_size — Halo ignores $top and $skip." },
    ],
    guidance: {
      tone: "info",
      text: "HaloPSA authenticates with the OAuth client-credentials grant, and the token request has to carry a scope: an API application's permissions are granted on its own tab in Halo, and the scope is how the request asks for them. Hosted tenants are issued tokens by Halo's auth host (auth.<domain>/token?tenant=<tenant>) while on-premise installs use the tenant's own /auth/token; C7NTAX tries both, because the wrong one fails in a way that looks like a wrong secret. The tenant also constrains access by agent permissions, so an API user with a narrow role sees a narrow tenant.",
    },
    docs: { url: "https://halopsa.com/apidoc/info", label: "HaloPSA API documentation" },
  },
  {
    kind: "autotask",
    name: "AutoTask PSA",
    description: "Tickets, contacts, accounts and resources through the AutoTask REST API.",
    credentials: [
      { key: "username", label: "API user name", hint: "The API user's full email address, e.g. api@yourcompany.com — it is also what the zone lookup is keyed on." },
      { key: "password", label: "API user password", type: "password", hint: "The API user's password. AutoTask tracks its expiry, so a 401 after months of working is usually this." },
      { key: "integrationCode", label: "Integration code", hint: "Admin → Features & Settings → Resources/Users (HR) → the API user's Security tab shows the API tracking identifier. Sent as the ApiIntegrationCode header on every call." },
      { key: "zone", label: "Zone", placeholder: "3", hint: "Your tenant's zone number — the number in the AutoTask address you sign in to, e.g. ww5.autotask.net is zone 5. Leave it empty and C7NTAX looks the zone up from the user name.", optional: true },
    ],
    settings: [
      { key: "maxRecords", label: "Records per page (MaxRecords, max 500)", type: "number", default: 500, hint: "AutoTask accepts 1–500 per page and paging then follows the nextPageUrl it hands back." },
      { key: "maxPages", label: "Maximum pages per entity", type: "number", default: 20, hint: "A stop for an entity with a very long history, so one sync cannot run forever." },
    ],
    guidance: {
      tone: "warn",
      text: "AutoTask's host is zone-specific — webservices3.autotask.net is America East, and there is no host without a zone number — so a connection that omits it cannot work at all. Authentication is three headers (UserName, Secret, ApiIntegrationCode) with no token exchange, and the API user should be created with the API User (API-only) security level. Paging follows pageDetails.nextPageUrl rather than re-querying, which is what AutoTask's documentation requires: the query, MaxRecords and filters must not change between pages. A company in AutoTask is a \"company\", not an \"account\".",
    },
    docs: { url: "https://ww1.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm", label: "AutoTask REST API documentation" },
  },
  {
    kind: "kantata",
    name: "Kantata",
    description: "Workspaces, tasks, time entries, expenses and invoices through the Kantata (Mavenlink) API.",
    credentials: [
      { key: "accessToken", label: "OAuth access token", type: "password", hint: "A bearer token for api.mavenlink.com/api/v1 — issued through Kantata's OAuth 2.0 flow (Settings → API, or a registered application). It expires, so expect to replace it." },
    ],
    settings: [
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "200 records a page. Caps how much of a very large workspace is read in one sync." },
    ],
    guidance: {
      tone: "warn",
      text: "Kantata's API is at api.mavenlink.com and every path ends in .json — without the extension you get redirected to the documentation rather than data. Records also come back as references: the response lists {key,id} pairs and holds the objects in per-type maps, so a reader expecting one flat array sees nothing at all. Because this connection stores a bearer token rather than a client id, re-authenticating is a manual step.",
    },
    docs: { url: "https://developer.kantata.com/", label: "Kantata developer documentation" },
  },
  {
    kind: "scoro",
    name: "Scoro",
    description: "Contacts, projects, tasks, invoices, quotes, bills, products and events through the Scoro API v2.",
    credentials: [
      { key: "site", label: "Site subdomain", placeholder: "acme", hint: "Just the subdomain: `acme` for acme.scoro.com. The site is part of the address, so this is not optional." },
      { key: "apiKey", label: "API key", type: "password", hint: "Scoro → Settings → Integrations → API → API key. Sent in the request body, not as a header." },
      { key: "companyAccountId", label: "Company account ID", hint: "Scoro → Settings → Site → the account id Scoro works inside. Every request has to name it, or Scoro cannot tell which account is meant." },
    ],
    settings: [
      { key: "perPage", label: "Records per request (per_page)", type: "number", default: 100, hint: "Scoro caps this at 500." },
      { key: "maxPages", label: "Maximum pages per module", type: "number", default: 20, hint: "Stops a runaway paging loop on an account with a very long invoice history." },
    ],
    guidance: {
      tone: "warn",
      text: "Scoro's API is module-based: every call is a POST to /api/v2/{module}/list with the key, the company account id, the language and the paging inside the JSON body — an API key in a header or a query string is ignored. Calls are addressed by module, never by the RPC method name, and a wrong site subdomain answers with an HTML page rather than an error.",
    },
    docs: { url: "https://api.scoro.com/api/v2", label: "Scoro API reference" },
  },
  {
    kind: "flexpoint",
    name: "FlexPoint Payment Solutions",
    description: "Billing and accounts-receivable automation for MSPs — customers, invoices and settled deposits, through FlexPoint's merchant API.",
    credentials: [
      { key: "apiSecret", label: "Merchant API secret", type: "password", hint: "FlexPoint → Settings → WebAPI → New API Credentials → Create Token, then copy the credential it shows you. C7NTAX exchanges it for a short-lived token itself, so this is the only credential needed." },
      { key: "baseUrl", label: "API base URL", type: "url", placeholder: "https://apps.getflexpoint.com/core-api", hint: "Leave as it is unless FlexPoint gives you a different host.", optional: true },
    ],
    guidance: {
      tone: "info",
      text: "One connection reads one merchant: FlexPoint's API carries no account or tenant id, because the API secret is what identifies the merchant. The credential is created inside the FlexPoint product (Settings → WebAPI), so it cannot be generated from here — the merchant must already have API access. FlexPoint sends no webhooks, so nothing arrives on its own: press Sync (or Test) and C7NTAX reads customers, invoices and deposits at that moment. Their API has no product catalogue and no subscription resource, so neither is offered.",
    },
    docs: { url: "https://apps.getflexpoint.com/core-api/swagger/index.html", label: "FlexPoint API reference (Swagger)" },
    settings: [
      { key: "syncCustomers", label: "Sync customers", type: "boolean", default: true, hint: "GET /api/merchant/v1/Customers — names, addresses, phone, email and external reference." },
      { key: "syncInvoices", label: "Sync invoices", type: "boolean", default: true, hint: "GET /api/merchant/v1/Invoices — amounts, dates, status, PO number and the payment link." },
      { key: "syncDeposits", label: "Sync deposits (settled payouts)", type: "boolean", default: true, hint: "GET /api/merchant/v1/Deposits — payouts settled to the merchant's bank account." },
      { key: "pageSize", label: "Records per request (page_size, max 200)", type: "number", default: 50, hint: "FlexPoint's own default is 50 and its maximum is 200. Leave it alone unless a large account is slow to sync." },
    ],
  },
  {
    kind: "quickbooks",
    name: "QuickBooks Online",
    description: "Invoices, payments, customers, items, vendors, bills and time activities through the Intuit Accounting API.",
    credentials: [
      { key: "clientId", label: "Client ID", hint: "Intuit developer dashboard → your app → Keys & credentials → Client ID." },
      { key: "clientSecret", label: "Client secret", type: "password", hint: "The same page as the client id. Leave the production/sandbox choice below in step with whichever keys these are." },
      { key: "refreshToken", label: "Refresh token", type: "password", hint: "From the OAuth 2.0 flow. QuickBooks access tokens last one hour, so the refresh token is the credential that matters — it is exchanged for a new access token on every sync." },
      { key: "realmId", label: "Company ID (realm ID)", hint: "QuickBooks Online → Settings → Company info → the numeric company id, or the `realmId` returned by the OAuth callback." },
    ],
    settings: [
      { key: "environment", label: "Environment", type: "select", default: "production", options: ["production", "sandbox"], hint: "Sandbox calls go to sandbox-quickbooks.api.intuit.com and only work with sandbox keys." },
      { key: "recordLimit", label: "Records per entity (maxresults)", type: "number", default: 1000, hint: "Each entity is read with `select * from Entity maxresults N`. QuickBooks refuses anything above 1000 for most entities." },
    ],
    guidance: {
      tone: "warn",
      text: "QuickBooks tokens are short-lived and are minted at a different host from the API: oauth.platform.intuit.com/oauth2/v1/tokens/bearer, authenticated with Basic client-id:client-secret. An access token is worth one hour, so a connection that stores only one works once and then reports itself broken. Intuit may also rotate the refresh token on each exchange; when that happens the new value is only in that response, and C7NTAX warns you in the sync result so you can store it.",
    },
    docs: { url: "https://developer.intuit.com/app/developer/qbo/docs/get-started", label: "Intuit QuickBooks API documentation" },
  },
  {
    kind: "pax8",
    name: "Pax8",
    description: "Companies, subscriptions, products, invoices and contacts through the Pax8 API.",
    credentials: [
      { key: "clientId", label: "API client ID", hint: "Pax8 → Integrations → API credentials → create a client. Generate it in Pax8; it cannot be created from here." },
      { key: "clientSecret", label: "API client secret", type: "password", hint: "Shown once when the Pax8 API client is created." },
    ],
    settings: [
      { key: "pageSize", label: "Records per page (size)", type: "number", default: 200, hint: "Pax8 caps a page at 200." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Stops after this many pages, so a first sync of a large company list cannot run away." },
    ],
    guidance: {
      tone: "info",
      text: "Pax8 issues an OAuth client-credentials token at api.pax8.com/v1/token with audience \"https://api.pax8.com\" in a JSON body — the token endpoint is not part of the /v1 data API, and asking for a token anywhere else fails. Note also that a Pax8 \"customer\" is a company, so customer data lives at /v1/companies.",
    },
    docs: { url: "https://docs.pax8.com/api-docs", label: "Pax8 API documentation" },
  },
  {
    kind: "avanan",
    name: "Check Point Harmony Email (Avanan)",
    description: "Email security incidents and events through the Check Point Harmony Email & Collaboration API.",
    credentials: [
      { key: "region", label: "Region", type: "select", options: ["us", "eu", "au", "in"], hint: "The region your tenant lives in. Data is not replicated between regions, so the wrong one answers for the wrong tenant." },
      { key: "appId", label: "Application ID", hint: "Harmony Email → Settings → API → the application id issued to your API application." },
      { key: "appSecret", label: "Application secret", type: "password", hint: "The matching application secret." },
      { key: "baseUrl", label: "API base URL override", type: "url", hint: "Only for tenants on a custom host; otherwise the region above decides.", optional: true },
    ],
    settings: [
      { key: "lookbackDays", label: "Days of history", type: "number", default: 7, hint: "How far back incident and event reads start (1–90)." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Paging follows the scrollId the API returns rather than a page number." },
    ],
    guidance: {
      tone: "warn",
      text: "This API does not take an API key. It signs an application id and secret into a JWT: POST /v1.0/auth with x-av-app-id and x-av-app-secret, then send that JWT back as x-av-token on every call. Responses are wrapped in responseEnvelope/responseData, and paging hands you a scrollId instead of a page number. An empty sync usually means the API application's scopes have not been granted in the Infinity Portal yet.",
    },
    docs: { url: "https://app-swagger.avanan.com/", label: "Harmony Email API reference (Swagger)" },
  },
  {
    kind: "proofpoint",
    name: "Proofpoint",
    description: "Blocked and delivered mail, permitted and blocked clicks, and issues from the Proofpoint TAP SIEM API.",
    credentials: [
      { key: "principal", label: "Service principal", hint: "Proofpoint TAP → Settings → Service principals → the service principal name. Used as the HTTP Basic username." },
      { key: "secret", label: "Service principal password", type: "password", hint: "The password generated with the service principal." },
    ],
    settings: [
      { key: "lookbackDays", label: "Days of history", type: "number", default: 1, hint: "1–7. The SIEM API rejects windows longer than an hour, so C7NTAX asks for the period in hourly slices." },
    ],
    guidance: {
      tone: "info",
      text: "The SIEM API authenticates with HTTP Basic and answers with a differently named array per endpoint — messagesBlocked, messagesDelivered, clicksPermitted, clicksBlocked, issues — so a reader looking for a shared data key finds nothing. sinceSeconds is capped at 3600 seconds per request, which is why a multi-day window is read in slices rather than in one call.",
    },
    docs: { url: "https://help.proofpoint.com/Threat_Insight_Dashboard/API_Documentation/SIEM_API", label: "Proofpoint TAP SIEM API documentation" },
  },
  {
    kind: "sentinelone",
    name: "SentinelOne",
    description: "Threats, agents, activities, sites, groups and application risks through the SentinelOne console API.",
    credentials: [
      { key: "consoleUrl", label: "Console URL", type: "url", placeholder: "https://usea1-acme.sentinelone.net", hint: "Your own console address. The region host is not shared: another tenant's console will reject the token." },
      { key: "apiToken", label: "API token", type: "password", hint: "Console → Settings → Users → your service user → API token. Sent in an ApiToken header, not as a bearer token." },
    ],
    settings: [
      { key: "pageSize", label: "Records per page (limit)", type: "number", default: 100, hint: "The console caps this at 1000." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Paging follows pagination.nextCursor." },
      { key: "lookbackDays", label: "Days of history for threats and activities", type: "number", default: 30, hint: "These two collections grow without bound, so they are read with a createdAt filter." },
    ],
    guidance: {
      tone: "info",
      text: "The console host is yours — usea1 and friends are tenant addresses, and a shared host either rejects the token or answers for the wrong tenant. The token goes in an ApiToken header. Connectivity is checked against /system/info, which every token can read, so a failure there means the host or the token is wrong rather than a permissions problem.",
    },
    docs: { url: "https://usea1.sentinelone.net/api-doc/overview", label: "SentinelOne API reference (your console)" },
  },
  {
    kind: "itglue",
    name: "IT Glue",
    description: "Organisations, configurations, flexible assets, passwords, documents, contacts, domains and locations through the IT Glue API.",
    credentials: [
      { key: "apiKey", label: "API key", type: "password", hint: "IT Glue → Account → API keys → generate a key for an API user. Sent in the x-api-key header." },
    ],
    settings: [
      { key: "pageSize", label: "Records per page (page[size])", type: "number", default: 1000, hint: "IT Glue accepts up to 1000 per page." },
      { key: "maxPages", label: "Maximum pages per resource", type: "number", default: 20, hint: "Paging stops at meta.totalPages." },
      { key: "incremental", label: "Only read records changed since the last sync", type: "select", default: "false", options: ["false", "true"], hint: "Uses filter[updated_at], which needs the IT Glue API's date filtering to be available on your plan." },
      { key: "maxOrganizations", label: "Organisations to read documents for", type: "number", default: 50, hint: "Documents live under an organisation, so this bounds how many organisations are walked for them." },
    ],
    guidance: {
      tone: "info",
      text: "The API is JSON:API: records arrive as { id, type, attributes } and are flattened before they are stored. Two details trip people up. `include=organization` is not supported on these resources and returns 400, so the organisation link is kept as organization-id. And there is no top-level document list — documents hang off an organisation at /organizations/{id}/relationships/documents, which is why organisations are read first and how many of them is a setting.",
    },
    docs: { url: "https://api.itglue.com/developer/", label: "IT Glue API documentation" },
  },
  {
    kind: "azure",
    name: "Azure",
    description: "Resource groups, resources and policy assignments in a subscription, through Azure Resource Manager.",
    credentials: [
      { key: "tenantId", label: "Directory (tenant) ID", hint: "Entra admin centre → Overview → Directory (tenant) ID. The token endpoint is scoped to it." },
      { key: "clientId", label: "Application (client) ID", hint: "App registrations → your app → Overview." },
      { key: "clientSecret", label: "Client secret value", type: "password", hint: "Certificates & secrets → New client secret. Copy the value immediately." },
      { key: "subscriptionId", label: "Subscription ID", hint: "Subscriptions → the subscription to read → Subscription ID." },
    ],
    guidance: {
      tone: "info",
      text: "The app registration is only half of it: the application also needs a role assignment on the subscription — Reader is enough for everything this connector reads — or ARM answers 403 for each call even though the token is perfectly valid. C7NTAX requests the token itself with the client-credentials grant (scope https://management.azure.com/.default), because a pasted access token expires within the hour.",
    },
    docs: { url: "https://learn.microsoft.com/en-us/rest/api/resources/", label: "Azure Resource Manager REST API" },
  },
  {
    kind: "aws",
    name: "AWS",
    description: "Accounts and EC2 instance inventory, read with a signed AWS API request.",
    credentials: [
      { key: "accessKeyId", label: "Access key ID", hint: "IAM → Users → your user → Security credentials → Create access key." },
      { key: "secretAccessKey", label: "Secret access key", type: "password", hint: "Shown once when the access key is created." },
      { key: "region", label: "Region", placeholder: "us-east-1", hint: "The region instance inventory is read from. STS is called in the same region." },
      { key: "sessionToken", label: "Session token", type: "password", hint: "Only for temporary credentials from STS AssumeRole or IAM Identity Center.", optional: true },
    ],
    guidance: {
      tone: "info",
      text: "AWS has no bearer-token form: every request is signed with SigV4 using the secret access key, and an unsigned Authorization header is simply rejected. The connectivity check is sts:GetCallerIdentity, which requires no permissions at all — so a 200 proves the credentials and the signature — while organizations:ListAccounts and ec2:DescribeInstances do need permission on the IAM user, and each one reports its own refusal without sinking the rest of the sync.",
    },
    docs: { url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html", label: "AWS SigV4 signing reference" },
  },
  {
    kind: "azure_ad_sso",
    name: "Azure AD SSO",
    description: "SAML 2.0 and OpenID Connect single sign-on: federation, JIT provisioning, group-to-role mapping.",
    credentials: [
      { key: "tenantId", label: "Directory (tenant) ID", hint: "Entra admin centre → Overview → Directory (tenant) ID." },
      { key: "clientId", label: "Application (client) ID", hint: "The app registration that represents C7NTAX in your tenant." },
      { key: "clientSecret", label: "Client secret value", type: "password", hint: "Needed for the OIDC code flow. Not used by SAML.", optional: true },
      { key: "domain", label: "Verified domain", placeholder: "contoso.com", hint: "The domain whose users sign in through this connection.", optional: true },
    ],
    settings: [
      { key: "protocol", label: "Protocol", type: "select", default: "saml", options: ["saml", "oidc"], hint: "SAML 2.0 or OpenID Connect — the two are configured differently in Entra, so this decides which fields below matter." },
      { key: "jitProvisioning", label: "JIT user provisioning", type: "boolean", default: true, hint: "Create the C7NTAX user on first sign-in instead of requiring one to exist already." },
      { key: "mfaEnforced", label: "Enforce MFA via Conditional Access", type: "boolean", default: true, hint: "Recorded as a promise about the tenant's Conditional Access policy; C7NTAX cannot verify it." },
      { key: "entityId", label: "SP entity ID (SAML)", type: "string", hint: "The identifier this instance presents as the service provider. Must match Entra's Basic SAML configuration." },
      { key: "acsUrl", label: "ACS URL (SAML)", type: "string", hint: "Where the identity provider posts the assertion — Entra rejects a mismatch." },
      { key: "redirectUri", label: "Redirect URI (OIDC)", type: "string", hint: "The callback registered in the app registration; it has to match exactly." },
      { key: "groupRoleMapping", label: "Group-to-role mapping", type: "json", default: { "C7NTAX-Admin": "admin", "C7NTAX-Technician": "technician", "C7NTAX-Manager": "manager", "C7NTAX-Billing": "billing_admin", "C7NTAX-Client": "client" }, hint: "{\"Entra group name\": \"C7NTAX role\"}. Applied at sign-in, so a change takes effect the next time the user signs in." },
    ],
    guidance: {
      tone: "info",
      text: "This connection is authentication rather than data sync: it decides who may sign in and which C7NTAX role they get. SAML needs the entity id and ACS URL registered in Entra; OIDC needs the redirect URI. Group-to-role mapping is applied at sign-in, so a change here takes effect the next time the user signs in.",
    },
    docs: { url: "https://learn.microsoft.com/en-us/entra/identity/saas-apps/tutorial-list", label: "Microsoft Entra SSO application tutorials" },
  },
];

/** The catalogue in the shape the API serves. */
function connectorTypes() {
  return CONNECTOR_SPECS.map(spec => ({
    kind: spec.kind,
    name: spec.name,
    description: spec.description,
    requiredCredentials: spec.credentials.filter(c => !c.optional).map(c => c.key),
    requiredScopes: spec.requiredScopes,
    credentialFields: spec.credentials.map(c => ({
      key: c.key,
      label: c.label,
      type: c.type ?? "text",
      required: !c.optional,
      hint: c.hint,
      ...(c.placeholder ? { placeholder: c.placeholder } : {}),
      ...(c.options ? { options: c.options } : {}),
    })),
    guidance: spec.guidance,
    docsUrl: spec.docs.url,
    docsLabel: spec.docs.label,
    // How to get it running, in the order it has to happen — what the setup wizard walks through.
    setup: CONNECTOR_SETUP[spec.kind] ?? null,
    settings: (spec.settings ?? []).map(s => ({
      key: s.key,
      label: s.label,
      type: s.type,
      default: s.default,
      ...(s.options ? { options: s.options } : {}),
      ...(s.hint ? { hint: s.hint } : {}),
    })),
  }));
}

// ── List available integration types ─────────────────────────────────────
cloudConnectRouter.get("/types", requirePermission(Permission.IntegrationView), (_req, res) => {
  res.json({ types: connectorTypes() });
});


// ── List configured integrations ─────────────────────────────────────────
/**
 * An integration row without its secrets, for a caller who may look but not manage.
 *
 * `credentials` is stored in clear text and hydrated straight into the connector, and
 * `IntegrationView` is held by technicians as well as by managers — so this list was handing every
 * technician the M365 client secret, the ConnectWise public/private key pair and the AWS
 * `secretAccessKey` for every client in the provider. The values are only ever *used* by the
 * server, and only ever *entered* through the manage-gated write routes, so a reader who cannot
 * write has no use for them: `hasCredentials` is what a read-only screen actually needs, and the
 * fix dialog that does need the values is on the manage-gated path.
 */
function toPublicIntegration(row: { credentials?: unknown }, canManage: boolean) {
  if (canManage) return row;
  const { credentials, ...rest } = row as Record<string, unknown> & { credentials?: Record<string, unknown> };
  return { ...rest, hasCredentials: Object.keys(credentials ?? {}).length > 0 };
}

cloudConnectRouter.get("/", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const canManage = !!req.user?.permissions?.includes(Permission.IntegrationManage);
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
    res.json({ data: rows.map(row => toPublicIntegration(row, canManage)) });
  } catch (e) { next(e); }
});

// ── Create integration ────────────────────────────────────────────────────
cloudConnectRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
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
cloudConnectRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
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

// ── Microsoft 365 inactivity + offboarding (PLAN-015 Phase B #12) ─────────
/**
 * Who is dormant, per client. The report says how many accounts it could and could not read a
 * sign-in for, because "no sign-in data" and "no sign-ins" are different findings.
 */
cloudConnectRouter.get("/m365/inactivity", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    res.json(await inactivityReport());
  } catch (e) { next(e); }
});

/**
 * Raises an offboarding checklist for a synced account. It does not disable anything: the work is
 * done by a person, in order, with a record that it happened.
 */
cloudConnectRouter.post("/m365/users/:userId/offboard", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const assignToId = typeof req.body?.assignToId === "string" ? req.body.assignToId : undefined;
    const dueDate = typeof req.body?.dueDate === "string" && !isNaN(Date.parse(req.body.dueDate)) ? new Date(req.body.dueDate) : undefined;
    res.status(201).json(await offboardUser(String(req.params.userId), req.user!.userId, { assignToId, dueDate }));
  } catch (e) { next(e); }
});

// ── Live status ───────────────────────────────────────────────────────────
/**
 * What each connection's health actually is, verified on a throttle (PLAN-015 Phase B #9). The
 * verification happens server-side so ten open tabs still produce one call per integration, and an
 * integration with credentials missing is never called at all.
 */
cloudConnectRouter.get("/status", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    if (!liveStatusEnabled()) {
      const rows = await prisma.integration.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, status: true, enabled: true } });
      res.json({ enabled: false, data: rows.map(r => ({ id: r.id, status: r.status, enabled: r.enabled, health: null })) });
      return;
    }
    const rows = await verifyDueIntegrations(
      async config => {
        const adapter = hub.getAdapter(config.kind);
        if (!adapter) return false;
        hub.register(config);
        return adapter.testConnection(config);
      },
      row => ({
        id: row.id,
        kind: row.kind as IntegrationConfig["kind"],
        name: row.name,
        enabled: row.enabled,
        credentials: row.credentials as Record<string, string>,
        settings: row.settings as Record<string, unknown>,
        status: row.status as IntegrationConfig["status"],
        errorMessage: row.errorMessage ?? undefined,
        lastSyncAt: row.lastSyncAt ?? null,
      }),
    );
    res.json({ enabled: true, data: rows.map(r => ({ id: r.id, status: r.status, enabled: r.enabled, health: r.health })) });
  } catch (e) { next(e); }
});

// ── Test connection ───────────────────────────────────────────────────────
cloudConnectRouter.post("/:id/test", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const config = await loadConfig(req.params.id!);
    const adapter = hub.getAdapter(config.kind);
    if (!adapter) throw new AppError(`Unknown integration kind: ${config.kind}`, 400);
    const ok = await adapter.testConnection(config);
    await persistCredentials(req.params.id!, config.credentials as Record<string, string>);
    noteManualVerification(req.params.id!, ok, ok ? "Verified from the connection test — the connection answered." : "The connection test failed.");

    if (ok) {
      await prisma.integration.update({
        where: { id: req.params.id },
        data: { status: "connected", errorMessage: null },
      });
      res.json({ connected: true });
    } else {
      // Build structured field errors with fix suggestions
      const requiredCreds = getRequiredCredentials(config.kind);
      const missingFields: string[] = [];
      const fieldErrors: Array<{ field: string; message: string; fix: string; example: string }> = [];

      for (const cred of requiredCreds) {
        const val = config.credentials?.[cred];
        if (!val || val.length === 0) {
          missingFields.push(cred);
          fieldErrors.push({
            field: cred,
            message: `${formatCredLabel(cred)} is missing`,
            fix: getCredFix(cred),
            example: getCredExample(cred),
          });
        }
      }

      // Also flag any credential that looks invalid
      for (const [key, val] of Object.entries(config.credentials || {})) {
        if (val && typeof val === "string" && !missingFields.includes(key)) {
          const issue = checkCredFormat(key, val);
          if (issue) {
            fieldErrors.push({
              field: key,
              message: issue,
              fix: getCredFix(key),
              example: getCredExample(key),
            });
          }
        }
      }

      await prisma.integration.update({
        where: { id: req.params.id },
        data: { status: "error", errorMessage: missingFields.length > 0
          ? `Missing: ${missingFields.map(formatCredLabel).join(", ")}`
          : "Connection test failed — check credentials" },
      });
      res.json({ connected: false, fieldErrors: fieldErrors.length > 0 ? fieldErrors : undefined });
    }
  } catch (e) { next(e); }
});

// ── Sync integration ──────────────────────────────────────────────────────
cloudConnectRouter.post("/:id/sync", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const config = await loadConfig(req.params.id!);
    const adapter = hub.getAdapter(config.kind);
    if (!adapter) throw new AppError(`Unknown integration kind: ${config.kind}`, 400);

    /*
     * FlexPoint has a service of its own (services/flexpoint.ts) that goes further than the generic
     * path below: it links synced customers to clients, and can record the settled payments of
     * invoices this application pushed. Persisting the same records in two places would be the way
     * those two screens start disagreeing, so the route hands the work over rather than doing it
     * again here. The summary it returns is a superset of this route's own shape.
     */
    if (config.kind === "flexpoint") {
      res.json(await syncFlexpoint(req.params.id!));
      return;
    }

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
    let derivedIds = 0;
    for (const key of syncDataKeys) {
      const items = (result as any)[key] as Array<Record<string, unknown>>;
      for (const item of items) {
        // Records are identified by the vendor's own id. Where a vendor's payload has none — IT Glue
        // relationships, some collection endpoints — the previous code invented a random one, so
        // every sync inserted the whole set again as new rows. A hash of the payload is stable, so
        // the same record updates itself in place instead of piling up.
        const { externalId, derived } = stableEntityId(item, key);
        if (derived) derivedIds++;
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
      // Named so the operator knows when identity had to be derived rather than read.
      recordsWithoutId: derivedIds,
    });
  } catch (e) { next(e); }
});

// ── Get synced data for any integration ────────────────────────────────────
cloudConnectRouter.get("/:id/synced-entities", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
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
cloudConnectRouter.get("/:id/entity-types", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
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
cloudConnectRouter.get("/:id/m365/users", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const users = await prisma.m365User.findMany({
      where: { integrationId: req.params.id },
      orderBy: { displayName: "asc" },
    });
    res.json({ data: users });
  } catch (e) { next(e); }
});

cloudConnectRouter.get("/:id/m365/subscriptions", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const subs = await prisma.m365Subscription.findMany({
      where: { integrationId: req.params.id },
      orderBy: { displayName: "asc" },
    });
    res.json({ data: subs });
  } catch (e) { next(e); }
});

cloudConnectRouter.get("/:id/sync-logs", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
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
cloudConnectRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.integration.delete({ where: { id: req.params.id } });
    hub.remove(req.params.id!);
    res.json({ message: "Integration removed" });
  } catch (e) { next(e); }
});
