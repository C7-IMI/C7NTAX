/**
 * The application configuration registry.
 *
 * Every configurable thing this product has is declared here, once, and both the API and the
 * web app render from this declaration. That is deliberate: before this file existed the
 * configuration surfaces were hand-written screens whose fields had quietly drifted away from
 * the code that was supposed to read them, so the only way to tell whether a setting worked
 * was to read the server. A setting now has to name the environment variable it replaces, the
 * value it falls back to, and what it changes — and the screen is generated from that, so a
 * field that does nothing cannot be drawn in the first place.
 *
 * Three sources, resolved in this order:
 *   1. the stored setting (a `SystemConfig` row, editable in the UI);
 *   2. the environment variable named by `env`, read exactly the way the code read it before;
 *   3. `default`.
 *
 * Fields whose `source` is `"environment"` are shown and never written: an outbound credential
 * or a switch that weakens authentication belongs to the deployment, not to whoever is holding
 * an administrator session.
 */
import { Permission } from "./enums";

/** Where a field's value can come from. */
export type ConfigSource = "setting" | "environment";

export type ConfigValueType = "boolean" | "number" | "text" | "select" | "colour" | "url";

export interface ConfigChoice {
  value: string;
  label: string;
}

/**
 * Where a setting is stored, when it is not the section's own row.
 *
 * Several settings predate this registry and already live in a row of their own — the idle
 * timeout is the bare `session_timeout` row, for instance, and the right-click menu preference
 * is nested inside the `app_settings` blob. Naming the address keeps those consumers working
 * while moving the edit surface here.
 */
export interface ConfigStoreAddress {
  /** `SystemConfig` key. Defaults to `config:<sectionId>`. */
  key?: string;
  /** Dotted path inside the row's value. Defaults to the field id. */
  path?: string;
  /** The row holds the value itself rather than a JSON object. */
  scalar?: boolean;
}

export interface ConfigFieldSpec {
  /** Stable identifier, unique within its section. */
  id: string;
  label: string;
  /** One line, shown under the label. */
  summary: string;
  /**
   * The longer explanation: what changes, what happens when it is off, what it needs.
   *
   * **Plain text.** The configuration screen prints this as written, so inline marks such as
   * `**bold**` would appear as literal asterisks — the Help renders those, this does not, and
   * putting them here is a defect rather than emphasis. The `affects` list carries the emphasis.
   */
  detail?: string;
  type: ConfigValueType;
  source: ConfigSource;
  /** Environment variable consulted when no setting is stored. */
  env?: string;
  /**
   * For booleans read out of the environment: how the variable's text was interpreted.
   * `not-false` means only the literal `false` turned it off (a flag that ships on);
   * `is-true` means only the literal `true` turned it on (a flag that ships off).
   */
  envMatch?: "not-false" | "is-true";
  default: boolean | number | string;
  choices?: ConfigChoice[];
  /** Choices the API fills in at read time, because only it can list them. */
  choicesFrom?: "serviceBoards" | "landingPages" | "inferenceModels";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** What an operator will see change, in their words. */
  affects?: string[];
  /** A change only applies after the API is restarted. */
  restartRequired?: boolean;
  /** Required by the product; shown as on and not switchable off. */
  locked?: boolean;
  /** A credential: reported as configured or not, never returned. */
  secret?: boolean;
  store?: ConfigStoreAddress;
}

export interface ConfigRequirementSpec {
  label: string;
  /** All of these environment variables are needed for the requirement to be met. */
  env?: string[];
  /**
   * A server-side check that can satisfy the requirement without any environment variable —
   * `oidcProvider` is met by a provider configured on Administration → Single Sign-On. Naming the
   * check rather than the value keeps the registry declarative: the API decides what "configured"
   * means, and the screen only has to render the answer.
   */
  providedBy?: "oidcProvider";
  detail: string;
  /** Where to go to satisfy it, when there is a screen that can. */
  link?: { label: string; to: string };
  /** Only relevant while the named boolean field in this section is on. */
  whenField?: string;
}

export interface ConfigSectionSpec {
  id: string;
  label: string;
  /** One line for the hub card. */
  summary: string;
  /** Lucide icon name, resolved by the web app. */
  icon: string;
  /** Required to see the section's live values. */
  readPermission: Permission;
  /** Required to change them. */
  writePermission: Permission;
  /** What the section governs, in one sentence. */
  governs: string;
  requirements?: ConfigRequirementSpec[];
  fields: ConfigFieldSpec[];
}

/** The stored form of one section: field id to value. */
export type ConfigSectionValue = Record<string, unknown>;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Storage keys this registry owns or shares. Kept exported so the API need not guess. */
export const CONFIG_STORE_KEYS = {
  appSettings: "app_settings",
  sessionTimeout: "session_timeout",
  defaultLandingPage: "default_landing_page",
} as const;

/** The `SystemConfig` row a section's values live in. */
export function configSectionKey(sectionId: string): string {
  return `config:${sectionId}`;
}

/**
 * The pages a sign-in may land on. Shared rather than written twice, because the personal
 * preference screen and the instance setting have to offer the same list or one of them will
 * quietly stop being reachable.
 */
export const LANDING_PAGES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/", label: "Dashboard" },
  { path: "/tickets", label: "Tickets" },
  { path: "/boards", label: "Service Boards" },
  { path: "/opportunities", label: "Sales Pipeline" },
  { path: "/projects", label: "Projects" },
  { path: "/assets", label: "Asset Inventory" },
  { path: "/kb", label: "Knowledge Base" },
  { path: "/clients", label: "Clients" },
  { path: "/billing", label: "Billing" },
  { path: "/c7nc", label: "C7NC" },
  { path: "/users", label: "Users" },
];

/**
 * Pages that have moved, so a preference saved before the move still lands where it meant.
 *
 * A landing page is stored as a *path*, and paths are validated against `LANDING_PAGES` — so a page
 * that is renamed silently drops the preference and sends somebody to the Dashboard instead of the
 * page they chose. `/cloudconnect` became `/c7nc` when CloudConnect merged into C7NC (PLAN-027), and
 * this mapping lives here rather than in the two callers that need it (the API that resolves a
 * stored value and the screen that shows which one is chosen), so they cannot disagree.
 */
export const LANDING_PAGE_ALIASES: Readonly<Record<string, string>> = {
  "/cloudconnect": "/c7nc",
};

/**
 * The current path for a stored landing page, or null when it names a page that no longer exists.
 *
 * Callers use this instead of comparing against the list themselves: it applies the aliases first,
 * so a value written before a rename resolves to the page that replaced it.
 */
export function resolveLandingPagePath(stored: string | null | undefined): string | null {
  const raw = (stored ?? "").trim();
  if (!raw) return null;
  const path = LANDING_PAGE_ALIASES[raw] ?? raw;
  return LANDING_PAGES.some(page => page.path === path) ? path : null;
}

export const CONFIG_SECTIONS: ConfigSectionSpec[] = [
  // ── Workspace ────────────────────────────────────────────────────
  {
    id: "workspace",
    label: "Workspace",
    summary: "Instance identity, the default landing page, and the interface options that apply to everyone.",
    icon: "Wrench",
    readPermission: Permission.SystemConfig,
    writePermission: Permission.SystemConfig,
    governs: "What the application calls itself and where people land when they sign in.",
    fields: [
      {
        id: "companyName",
        label: "Company name",
        summary: "The name shown to customers in the portal, and the signature on customer email.",
        detail:
          "Used as the portal's title when a client has not been given a portal name of its own, and as the fallback sender name. It is not the client list — clients keep their own names under Clients.",
        type: "text",
        source: "setting",
        default: "C7NTAX",
        affects: ["Customer portal title", "Portal sign-in page", "Customer email signature"],
      },
      {
        id: "contextMenus",
        label: "Application right-click menus",
        summary: "Themed right-click menus on Tickets and the other sections that have them.",
        detail:
          "When off, right-clicking anywhere in those sections shows the browser's own menu. Text fields always keep the browser menu either way, and a per-browser override still wins locally.",
        type: "boolean",
        source: "setting",
        default: true,
        store: { key: CONFIG_STORE_KEYS.appSettings, path: "general.contextMenus" },
        affects: ["Tickets", "Service Boards", "Every section with a themed context menu"],
      },
      {
        id: "console",
        label: "Command console",
        summary: "The console in the header toolbar, and the command catalogue behind it.",
        detail:
          "When off, the header icon is hidden and the console's catalogue endpoint answers 404. It can also be withheld from one person (the Console category in Users & Roles) or from one client (the Console card on the client's own record). The console adds no route of its own to the write surface, so switching it off leaves every existing screen, route and permission exactly as it was. Read commands are available now; write commands arrive with PLAN-026's action manifest.",
        type: "boolean",
        source: "setting",
        env: "CONSOLE_ENABLED",
        envMatch: "not-false",
        default: true,
        store: { key: CONFIG_STORE_KEYS.appSettings, path: "general.console" },
        affects: ["Header toolbar", "Console", "c7ntax CLI", "Users & Roles", "Client records"],
      },
      {
        id: "navigationStyle",
        label: "Navigation pane",
        summary: "The rail of sections with a column of destinations, or the single collapsible tree.",
        detail:
          "Modern draws a short rail of domains that does not grow as the feature list does, with the destinations inside the chosen domain beside it in their own scrolling column, ordered by what this person actually opens. Classic is the single tree: every section and every nested row in one list, exactly as it was before this setting existed. Switching back is immediate and changes nothing about the destinations themselves — both panes are generated from the same navigation, so no page, route or permission moves. A person can override this for their own browser with the c7_ui_nav flag, in either direction, which is what makes it safe to try before adopting.",
        type: "select",
        source: "setting",
        env: "UI_NAV_STYLE",
        default: "modern",
        choices: [
          { value: "modern", label: "Rail and sections (default)" },
          { value: "classic", label: "Single tree (classic)" },
        ],
        store: { key: CONFIG_STORE_KEYS.appSettings, path: "appearance.navigationStyle" },
        affects: ["Every screen", "The navigation pane", "Favourites", "Administration"],
      },
      {
        id: "assistantInRail",
        label: "Assistant in the navigation rail",
        summary: "Whether the Assistant is a section in the rail or a utility at its foot.",
        detail:
          "Off, the Assistant sits with Help and My settings: somewhere you go for something rather than somewhere you work, which is where it belongs while its answers are about the screen you are already on. On, it joins the rail itself, for the case where people start their day in it. Only the modern pane has a rail, so this has no effect while the navigation pane is set to classic; the Assistant is always in the sidebar there.",
        type: "boolean",
        source: "setting",
        env: "ASSISTANT_IN_RAIL",
        default: false,
        store: { key: CONFIG_STORE_KEYS.appSettings, path: "appearance.assistantInRail" },
        affects: ["The navigation pane", "Assistant"],
      },
      {
        id: "defaultLandingPage",
        label: "Default landing page",
        summary: "Where a sign-in lands when the person has not chosen a page of their own.",
        detail:
          "Each person can override this under their own Settings; this is the fallback for everyone who has not.",
        type: "select",
        source: "setting",
        default: "/",
        choicesFrom: "landingPages",
        store: { key: CONFIG_STORE_KEYS.defaultLandingPage, path: "path" },
        affects: ["Sign-in", "SSO hand-off", "Passkey sign-in"],
      },
    ],
  },

  // ── Sessions & Security ──────────────────────────────────────────
  {
    id: "sessions",
    label: "Sessions & Security",
    summary: "Idle timeout, the hard session ceiling, and the sign-in methods this deployment offers.",
    icon: "Shield",
    readPermission: Permission.SystemConfig,
    writePermission: Permission.SecurityManage,
    governs: "How long a signed-in person stays signed in, and which sign-in methods are accepted.",
    requirements: [
      {
        label: "Authenticator hardware (passkeys)",
        env: ["WEBAUTHN_RP_ID"],
        whenField: "passkeys",
        detail: "Passkeys need the relying-party domain the browser is expected to present, without a scheme or port.",
      },
      {
        label: "An identity provider (single sign-on)",
        env: ["SSO_ISSUER"],
        providedBy: "oidcProvider",
        whenField: "sso",
        detail:
          "Single sign-on needs an issuer URL and a client id. Configure them at Administration → Single Sign-On, or supply SSO_ISSUER and SSO_CLIENT_ID to the deployment.",
        link: { label: "Open Single Sign-On", to: "/admin/sso" },
      },
    ],
    fields: [
      {
        id: "sessionTimeout",
        label: "Idle timeout",
        summary: "Minutes of no activity before a session is ended.",
        detail:
          "The server is the authority. The browser counts the same clock and warns a minute before the deadline so unsaved work can be kept. Administrators and the test account are exempt; see below.",
        type: "number",
        source: "setting",
        default: 30,
        min: 5,
        max: 480,
        unit: "minutes",
        store: { key: CONFIG_STORE_KEYS.sessionTimeout, scalar: true },
        affects: ["Every signed-in session", "The 'still there?' warning", "Sign-in page timeout message"],
      },
      {
        id: "maxSessionHours",
        label: "Maximum session life",
        summary: "Hours a session may live even if it never goes idle.",
        detail:
          "The ceiling that makes the idle timeout meaningful: without it, continuous activity would keep one cookie alive indefinitely. Four times the idle timeout is used when that is shorter, so lowering the idle timeout tightens this too.",
        type: "number",
        source: "setting",
        default: 12,
        min: 1,
        max: 72,
        unit: "hours",
        affects: ["Session renewal", "Re-authentication"],
      },
      {
        id: "exemptAdministrators",
        label: "Administrators never time out",
        summary: "Admin and Super Admin sessions ignore the idle timeout.",
        detail:
          "Off by default in regulated deployments. Turning it off means an idle administrator is signed out like anyone else, and the session can no longer be kept alive purely by a role name.",
        type: "boolean",
        source: "setting",
        default: true,
        affects: ["Administration", "Every admin session"],
      },
      {
        id: "sessionAuth",
        label: "Session authentication",
        summary: "Cookie sessions with CSRF protection, rather than a bearer token per request.",
        detail: "Environment-only, and switched on in every supported deployment. Disabling it would reinstate token-per-request authentication.",
        type: "boolean",
        source: "environment",
        env: "SESSION_AUTH_ENABLED",
        envMatch: "not-false",
        default: true,
        locked: true,
        restartRequired: true,
        affects: ["Every signed-in session", "CSRF protection"],
      },
      {
        id: "authHardening",
        label: "Authentication hardening",
        summary: "Account lockout after repeated failures, and short-lived sign-in tokens.",
        detail:
          "Environment-only. With it on, five failed attempts lock an account, tokens last fifteen minutes, and a forced password change is enforced at sign-in.",
        type: "boolean",
        source: "environment",
        env: "AUTH_HARDENING_ENABLED",
        envMatch: "is-true",
        default: false,
        restartRequired: true,
        affects: ["Sign-in", "Account lockout", "Password change enforcement"],
      },
      {
        id: "passkeys",
        label: "Passkeys (WebAuthn)",
        summary: "Let people enrol a passkey and sign in without a password.",
        detail:
          "Additive: passwords keep working. Needs the relying-party id above, which only the deployment can supply.",
        type: "boolean",
        source: "setting",
        env: "PASSKEY_ENABLED",
        envMatch: "is-true",
        default: false,
        affects: ["Sign-in", "My Account", "MFASetup"],
      },
      {
        id: "sso",
        label: "Single sign-on (OIDC)",
        summary: "Send sign-in to an identity provider instead of asking for a password.",
        detail:
          "Additive: password sign-in keeps working as a fallback. Configure the provider at Administration → Single Sign-On — the issuer, the client credentials and the redirect URI to register there — and this switch decides whether it is offered.",
        type: "boolean",
        source: "setting",
        env: "SSO_ENABLED",
        envMatch: "is-true",
        default: false,
        affects: ["Sign-in", "Account provisioning"],
      },
      {
        id: "testBypass",
        label: "Authentication test bypass",
        summary: "An account allowed to sign in without a password or an idle timeout.",
        detail:
          "Environment-only, and refused outright when NODE_ENV is production. Intended for testing a deployment that has just enforced authentication.",
        type: "boolean",
        source: "environment",
        env: "AUTH_TEST_BYPASS",
        envMatch: "is-true",
        default: false,
        restartRequired: true,
        affects: ["Sign-in", "Idle timeout"],
      },
    ],
  },

  // ── Customer Portal ──────────────────────────────────────────────
  {
    id: "portal",
    label: "Customer Portal",
    summary: "The customer-facing sign-in, what a customer may see and do, and how it looks.",
    icon: "Globe",
    readPermission: Permission.ClientView,
    writePermission: Permission.SystemConfig,
    governs: "Whether customers have a portal at all, and what it lets them do.",
    requirements: [
      {
        label: "An outbound mail server",
        env: ["SMTP_HOST"],
        whenField: "enabled",
        detail:
          "Sign-in is an emailed one-time code, so without a working relay nobody can get in. The code is sent from SMTP_FROM.",
      },
      {
        label: "At least one active service board",
        whenField: "enabled",
        detail: "Tickets raised in the portal have to land on a board. One is chosen below, or the oldest active board is used.",
      },
    ],
    fields: [
      {
        id: "enabled",
        label: "Customer portal enabled",
        summary: "Expose the portal and everything behind it.",
        detail:
          "When off, every portal route answers 404 and the sign-in page does not exist — a deployment that has not switched the portal on should not advertise it. Takes effect immediately; no restart.",
        type: "boolean",
        source: "setting",
        env: "PORTAL_ENABLED",
        envMatch: "is-true",
        default: false,
        affects: ["/portal", "Portal sign-in", "Clients → Portal access"],
      },
      {
        id: "publicUrl",
        label: "Portal address",
        summary: "The address a customer is given for the portal.",
        detail:
          "Leave this blank when customers reach the portal at this application's own address — the usual case, and the address is then worked out for you. Set it when the portal is served from somewhere else, such as https://portal.example.com or https://support.example.com/portal, and that becomes the address shown on the Portal card, copied for a welcome mail, and quoted in the sign-in email. Include the https:// and any path the portal sits under.",
        type: "url",
        source: "setting",
        env: "PORTAL_PUBLIC_URL",
        default: "",
        affects: ["Portal card", "Portal sign-in email"],
      },
      {
        id: "defaultBoardId",
        label: "Board for portal-raised tickets",
        summary: "Where a ticket created in the portal lands.",
        detail:
          "Tickets are raised by the portal's own system user, so they never appear to come from a member of staff. Unset means the oldest active board is used. A client whose work belongs on another queue can be routed there on its own, from Client access on the same screen.",
        type: "select",
        source: "setting",
        env: "PORTAL_DEFAULT_BOARD_ID",
        default: "",
        choicesFrom: "serviceBoards",
        affects: ["Tickets created in the portal", "Service Board queues"],
      },
      {
        id: "visibility",
        label: "Ticket visibility",
        summary: "Whether a customer sees only their own tickets or every ticket belonging to their client.",
        detail:
          "Contact (the default) shows a ticket the customer raised, is the contact on, or was added to. Client opens it up to everyone at the same client — right for a small business with one mailbox, wrong for a client with three hundred staff. Either answer can be changed for one client, or for one person, from Client access on the same screen.",
        type: "select",
        source: "setting",
        default: "contact",
        choices: [
          { value: "contact", label: "Only their own tickets" },
          { value: "company", label: "Every ticket at their client" },
        ],
        affects: ["Portal ticket list", "Portal ticket detail", "Portal ticket replies"],
      },
      {
        id: "allowTicketCreation",
        label: "Customers may raise tickets",
        summary: "Show the new-ticket form in the portal and accept submissions.",
        detail: "With this off the portal is read-and-reply only, which is what a client that must go through the phone wants. One client can be refused the form on its own, from Client access on the same screen.",
        type: "boolean",
        source: "setting",
        default: true,
        affects: ["Portal ticket list", "Tickets raised in the portal"],
      },
      {
        id: "allowReplies",
        label: "Customers may reply",
        summary: "Let a customer add a public note to one of their tickets.",
        detail: "Replies are public notes. Internal notes never cross into the portal either way, whatever this is set to. One client can be refused replies on its own, from Client access on the same screen.",
        type: "boolean",
        source: "setting",
        default: true,
        affects: ["Portal ticket detail", "Ticket notes"],
      },
      {
        id: "codeExpiryMinutes",
        label: "Sign-in code lifetime",
        summary: "How long an emailed sign-in code stays usable.",
        detail: "Long enough for a mail hop, short enough that a code read over someone's shoulder is useless later.",
        type: "number",
        source: "setting",
        default: 10,
        min: 2,
        max: 60,
        unit: "minutes",
        affects: ["Portal sign-in"],
      },
      {
        id: "maxVerifyAttempts",
        label: "Sign-in attempts per code",
        summary: "Wrong guesses allowed before a code is burned.",
        detail: "Attempts are counted against the code, so a guesser spends their own budget rather than the customer's.",
        type: "number",
        source: "setting",
        default: 5,
        min: 1,
        max: 20,
        affects: ["Portal sign-in"],
      },
      {
        id: "codesPerWindow",
        label: "Codes per customer per window",
        summary: "How many sign-in codes one mailbox may request inside the window below.",
        detail: "The ceiling that stops the portal being used as a mail relay.",
        type: "number",
        source: "setting",
        default: 3,
        min: 1,
        max: 20,
        affects: ["Portal sign-in"],
      },
      {
        id: "codeWindowMinutes",
        label: "Code request window",
        summary: "The period the limit above is counted over.",
        type: "number",
        source: "setting",
        default: 15,
        min: 5,
        max: 120,
        unit: "minutes",
        affects: ["Portal sign-in"],
      },
      {
        id: "sessionHours",
        label: "Portal session lifetime",
        summary: "Hours a customer stays signed in before having to ask for a new code.",
        detail: "A customer session is not an all-day credential; the portal cookie is separate from the staff session and expires on its own schedule.",
        type: "number",
        source: "setting",
        default: 8,
        min: 1,
        max: 24,
        unit: "hours",
        affects: ["Portal sessions"],
      },
      {
        id: "maxDevices",
        label: "Signed-in devices per customer",
        summary: "How many browsers one customer may keep signed in at once.",
        detail: "The oldest is retired when the limit is reached, so a lost device cannot hold a slot forever.",
        type: "number",
        source: "setting",
        default: 5,
        min: 1,
        max: 20,
        affects: ["Portal sessions"],
      },
      {
        id: "accentColor",
        label: "Portal accent colour",
        summary: "The portal's default accent, used when the client has not been given one.",
        detail: "Per-client colours are set on the client record under Clients. Leave this blank to inherit the application's own theme.",
        type: "colour",
        source: "setting",
        default: "",
        affects: ["Portal header", "Portal buttons", "Portal sign-in page"],
      },
      {
        id: "logoUrl",
        label: "Portal logo",
        summary: "Default logo for the portal, used when the client has not been given one.",
        detail: "An absolute URL, or a path under the API's /uploads. Per-client logos are set on the client record.",
        type: "url",
        source: "setting",
        default: "",
        affects: ["Portal header", "Portal sign-in page"],
      },
      {
        id: "welcomeText",
        label: "Portal welcome message",
        summary: "The line under the portal title on the ticket list.",
        type: "text",
        source: "setting",
        default: "",
        affects: ["Portal ticket list"],
      },
      {
        id: "supportEmail",
        label: "Portal support address",
        summary: "Where the portal points a customer who cannot sign in.",
        detail: "Shown on the sign-in page and in the footer. Falls back to the company name and the relay's from-address when blank.",
        type: "text",
        source: "setting",
        default: "",
        affects: ["Portal sign-in page", "Portal footer"],
      },
    ],
  },

  // ── Service Alerts & Monitoring ──────────────────────────────────
  {
    id: "monitoring",
    label: "Service Alerts & Monitoring",
    summary: "Uptime monitors, outbound alert webhooks, and the social outage source.",
    icon: "Activity",
    readPermission: Permission.ServiceAlertManage,
    writePermission: Permission.ServiceAlertManage,
    governs: "What the outage board watches and where it can send an alert.",
    requirements: [
      {
        label: "An X (Twitter) bearer token",
        env: ["X_BEARER_TOKEN"],
        whenField: "socialSource",
        detail: "The social source reads nothing without a token, and says so on the board rather than staying silent.",
      },
    ],
    fields: [
      {
        id: "uptimeMonitors",
        label: "Uptime monitors",
        summary: "Website, SSL and DNS checks with their own schedules and history.",
        detail: "Off removes the monitor checks from the alert poll and makes the monitor routes answer 404. Nothing already recorded is deleted.",
        type: "boolean",
        source: "setting",
        env: "UPTIME_MONITORS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Service Alerts → Monitors", "Outage board"],
      },
      {
        id: "alertWebhooks",
        label: "Alert webhooks",
        summary: "Outbound endpoints that receive every alert event, with a delivery log.",
        detail: "Off makes the webhook routes answer 404 and stops deliveries. Endpoints already registered are kept.",
        type: "boolean",
        source: "setting",
        env: "ALERT_WEBHOOKS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Alert webhooks", "Webhook delivery log"],
      },
      {
        id: "socialSource",
        label: "Social outage source",
        summary: "Read provider posts as a signal that a service is down.",
        detail: "Off, or without a token, the source contributes nothing and the board relies on status feeds and monitors alone.",
        type: "boolean",
        source: "setting",
        env: "SERVICE_ALERTS_SOCIAL_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Outage board"],
      },
      {
        id: "xBearerToken",
        label: "X (Twitter) bearer token",
        summary: "The credential the social source authenticates with.",
        type: "text",
        source: "environment",
        env: "X_BEARER_TOKEN",
        default: "",
        secret: true,
        restartRequired: true,
        affects: ["Outage board"],
      },
      {
        id: "xApiBaseUrl",
        label: "X API base URL",
        summary: "Override the API host the social source calls.",
        type: "text",
        source: "environment",
        env: "X_API_BASE_URL",
        default: "https://api.x.com",
        restartRequired: true,
      },
      {
        id: "pollIntervalMinutes",
        label: "Alert poll interval",
        summary: "How often the alert monitor checks every source.",
        detail:
          "An alert is never resolved on the poll that raised it, and two consecutive clear polls are required, so this interval is also the shortest life an alert can have.",
        type: "number",
        source: "setting",
        env: "SERVICE_ALERT_POLL_MINUTES",
        default: 5,
        min: 1,
        max: 60,
        unit: "minutes",
        restartRequired: true,
        affects: ["Outage board freshness", "Alert resolution"],
      },
      {
        id: "staleAfterHours",
        label: "Give up on an unreadable alert after",
        summary: "The ceiling on how long an alert may stay open with no source confirming it.",
        detail: "Only reached when every configured source is unreadable, which is itself a signal worth keeping the alert for.",
        type: "number",
        source: "setting",
        env: "SERVICE_ALERT_STALE_HOURS",
        default: 72,
        min: 1,
        max: 720,
        unit: "hours",
        restartRequired: true,
        affects: ["Outage board"],
      },
    ],
  },

  // ── Knowledge Base & AI ──────────────────────────────────────────
  {
    id: "knowledge",
    label: "Knowledge Base & AI",
    summary: "Drafting articles from resolved tickets, choosing the model, and AI action proposals.",
    icon: "Sparkles",
    readPermission: Permission.KBManage,
    writePermission: Permission.KBManage,
    governs: "Where the product is allowed to use a language model, and which one.",
    requirements: [
      {
        label: "A reachable inference provider",
        whenField: "autoDraft",
        detail: "Drafting needs an endpoint and a model. Providers are configured under Administration → System Settings → Inference.",
      },
    ],
    fields: [
      {
        id: "autoDraft",
        label: "Draft articles from resolved tickets",
        summary: "Offer a knowledge base draft when a ticket is resolved, and allow drafting on demand.",
        detail:
          "Off, the drafting routes refuse with the reason, and resolving a ticket never drafts. Articles already drafted are untouched.",
        type: "boolean",
        source: "setting",
        env: "KB_AUTOGEN_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Knowledge Base", "Ticket resolution"],
      },
      {
        id: "draftModel",
        label: "Drafting model",
        summary: "The model used for knowledge base drafts, when that should differ from the interactive one.",
        detail: "Blank uses the deployment's inference model. Naming a cheaper deployment here keeps drafting off the interactive budget.",
        type: "text",
        source: "setting",
        env: "KB_AUTOGEN_MODEL",
        default: "",
        choicesFrom: "inferenceModels",
        affects: ["Knowledge Base drafts"],
      },
      {
        id: "aiActions",
        label: "AI action proposals",
        summary: "Risk-classified proposals an operator can review and approve.",
        detail: "Off makes the AI actions routes answer 404 and stops proposals being raised. Nothing is ever executed without approval either way.",
        type: "boolean",
        source: "setting",
        env: "AI_ACTIONS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["AI Actions"],
      },
    ],
  },

  // ── C7NC: connections & email ────────────────────────────────────
  {
    id: "integrations",
    label: "C7NC & Email",
    summary: "Server-side status verification, verification throttling, the email connectors, and M365 offboarding.",
    icon: "Cloud",
    readPermission: Permission.IntegrationManage,
    writePermission: Permission.IntegrationManage,
    governs: "Which outbound integrations are live and how hard they are allowed to work.",
    requirements: [
      {
        label: "An outbound mail relay",
        env: ["SMTP_HOST"],
        detail: "Ticket notification, portal sign-in codes and connector error mail all use the same relay.",
      },
      {
        label: "A connector redirect URI",
        env: ["EMAIL_OAUTH_REDIRECT_URI"],
        detail: "Cloud connector consent flows return to this address, which must be registered with the provider.",
      },
    ],
    fields: [
      {
        id: "liveStatus",
        label: "Live connector verification",
        summary: "Check connectors server-side instead of trusting the last recorded status.",
        detail:
          "Off, stored statuses are returned and no outbound call is made — the page still answers, so nothing needs to change on the screen.",
        type: "boolean",
        source: "setting",
        env: "CLOUDCONNECT_LIVE_STATUS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["C7NC", "Integration health"],
      },
      {
        id: "verifyIntervalSec",
        label: "Verification throttle",
        summary: "The shortest gap between two verifications of the same connector.",
        detail: "A floor of thirty seconds is enforced whatever is entered, so a busy page cannot hammer a provider.",
        type: "number",
        source: "setting",
        env: "CLOUDCONNECT_VERIFY_INTERVAL_SEC",
        default: 300,
        min: 30,
        max: 3600,
        unit: "seconds",
        affects: ["C7NC", "Integration health"],
      },
      {
        id: "emailConnectors",
        label: "Email connectors",
        summary: "Read and file mail into tickets from a connected mailbox.",
        detail: "Off stops the connector runtime and the routes answer 404, leaving the connectors configured but idle.",
        type: "boolean",
        source: "setting",
        env: "EMAIL_CONNECTORS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Email connectors", "Ticket creation from mail"],
      },
      {
        id: "emailCloudConnectors",
        label: "Cloud mailbox connectors",
        summary: "Microsoft 365 and Google connectors, which need an app registration.",
        detail: "Off, only on-premises IMAP and Exchange connectors are offered.",
        type: "boolean",
        source: "setting",
        env: "EMAIL_CONNECTORS_CLOUD_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Email connectors"],
      },
      {
        id: "graphApi",
        label: "Microsoft Graph delivery",
        summary: "Send through Graph rather than SMTP.",
        detail: "Off, outbound mail uses the SMTP relay.",
        type: "boolean",
        source: "setting",
        env: "EMAIL_GRAPH_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Outbound email"],
      },
      {
        id: "maxAttachmentBytes",
        label: "Largest inbound attachment",
        summary: "The size above which an emailed attachment is filed as a link rather than stored.",
        type: "number",
        source: "setting",
        env: "EMAIL_MAX_ATTACHMENT_BYTES",
        default: 26214400,
        min: 1048576,
        max: 104857600,
        step: 1048576,
        unit: "bytes",
        restartRequired: true,
        affects: ["Email connectors", "Ticket attachments"],
      },
      {
        id: "m365Offboarding",
        label: "Microsoft 365 offboarding",
        summary: "The offboarding checklist raised when a departure is recorded, and its report.",
        detail:
          "It disables nothing: the checklist is a piece of work with links into the Microsoft admin centres, and the inactivity report keeps working either way. Off, no checklist is ever raised.",
        type: "boolean",
        source: "setting",
        env: "M365_OFFBOARD_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Microsoft 365 offboarding", "Inactivity report"],
      },
      {
        id: "egressAllowPrivate",
        label: "Allow outbound calls to private addresses",
        summary: "Permit integrations to reach hosts on the local network.",
        detail:
          "Environment-only and off by default. Needed when a provider runs on the same private network; leaving it off is what stops a misconfigured URL being used to probe the internal network.",
        type: "boolean",
        source: "environment",
        env: "EGRESS_ALLOW_PRIVATE",
        envMatch: "is-true",
        default: false,
        restartRequired: true,
        affects: ["Every outbound integration"],
      },
    ],
  },

  // ── Billing & Invoicing ──────────────────────────────────────────
  {
    id: "billing",
    label: "Billing & Invoicing",
    summary: "Bill-through batches, time rules and their defaults, quotes, and generate-from-tickets.",
    icon: "Receipt",
    readPermission: Permission.BillingManage,
    writePermission: Permission.BillingManage,
    governs: "How work turns into money: what is billed automatically, what has to be approved, and how overtime counts.",
    fields: [
      {
        id: "invoiceBatch",
        label: "Bill-through batch invoicing",
        summary: "Preview a whole period, hold it, then approve it in one go.",
        detail:
          "Off, the batch routes answer 404 and invoicing stays one ticket at a time. The preview writes nothing, and only rows with no invoice are ever selected, so a batch cannot double-bill.",
        type: "boolean",
        source: "setting",
        env: "INVOICE_BATCH_ENABLED",
        envMatch: "is-true",
        default: false,
        affects: ["Billing → Invoices", "Bill-through preview"],
      },
      {
        id: "timeRules",
        label: "Time rules",
        summary: "Midnight splitting, overtime, and weighting overtime towards billing and allowances.",
        detail:
          "Off, every entry is billed at plain minutes. Entries recorded while it was off keep a null overtime figure, so 'not computed' stays distinguishable from 'computed as zero'.",
        type: "boolean",
        source: "setting",
        env: "TIME_RULES_ENABLED",
        envMatch: "is-true",
        default: false,
        affects: ["Time & Expenses", "Invoicing", "Agreement allowances"],
      },
      {
        id: "overtimeAfter",
        label: "Overtime cut-off",
        summary: "The clock time after which default overtime begins.",
        detail: "A service agreement can override this for one client; this is the default for agreements that do not.",
        type: "text",
        source: "setting",
        default: "18:00",
        affects: ["Time & Expenses", "Invoicing"],
      },
      {
        id: "overtimeMultiplier",
        label: "Default overtime multiplier",
        summary: "How overtime counts towards billing and allowance consumption.",
        detail: "The 1.5:1 rule: two hours of evening work consume three. An agreement can override it.",
        type: "number",
        source: "setting",
        default: 1.5,
        min: 1,
        max: 5,
        step: 0.05,
        affects: ["Time & Expenses", "Invoicing", "Agreement allowances"],
      },
      {
        id: "overtimeEnabled",
        label: "Count overtime by default",
        summary: "Whether overtime is computed at all when an agreement says nothing.",
        type: "boolean",
        source: "setting",
        default: true,
        affects: ["Time & Expenses", "Invoicing"],
      },
      {
        id: "billFromTickets",
        label: "Generate invoices from tickets",
        summary: "Build a draft invoice from a ticket's unbilled time and expenses.",
        detail: "Off makes the generate routes answer 404; invoicing from the invoice screen is unaffected.",
        type: "boolean",
        source: "setting",
        env: "BILLING_FROM_TICKETS_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Tickets", "Invoices"],
      },
      {
        id: "quotes",
        label: "Quotes",
        summary: "Quote a piece of work from the product catalog and send it for acceptance.",
        detail: "Off makes the quote routes answer 404. Quotes already raised are kept.",
        type: "boolean",
        source: "setting",
        env: "QUOTES_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Quotes", "Product Catalog", "Opportunities"],
      },
    ],
  },

  // ── Client Apps & Notifications ──────────────────────────────────
  {
    id: "apps",
    label: "Client Apps & Notifications",
    summary: "The Outlook add-in, push notification devices, and the companion clients this deployment serves.",
    icon: "Monitor",
    readPermission: Permission.SystemConfig,
    writePermission: Permission.SystemConfig,
    governs: "Which companion clients this deployment serves, and how it reaches a phone.",
    fields: [
      {
        id: "outlookAddin",
        label: "Outlook add-in",
        summary: "The add-in that files a message and its attachments as a ticket, from inside Outlook.",
        detail:
          "Governs both halves of it: the taskpane the mailbox loads, and the endpoint the taskpane calls. Off, both answer 404, so a mailbox that already has the add-in sideloaded is told the server does not support it rather than failing halfway through filing a message. On, the taskpane is served from the add-in directory and the endpoint accepts. Takes effect immediately; no restart.",
        type: "boolean",
        source: "setting",
        env: "OUTLOOK_ADDIN_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["/addin taskpane", "Outlook add-in endpoint", "Tickets created from Outlook"],
      },
      {
        id: "push",
        label: "Push notifications",
        summary: "Register devices and send push to them.",
        detail: "Off makes the push routes answer 404 and stops sending. Registered devices are kept.",
        type: "boolean",
        source: "setting",
        env: "PUSH_ENABLED",
        envMatch: "not-false",
        default: true,
        affects: ["Notifications", "Desktop client"],
      },
    ],
  },
];

/** Lookup by section id. */
export const CONFIG_SECTION_BY_ID: Record<string, ConfigSectionSpec> = Object.fromEntries(
  CONFIG_SECTIONS.map(section => [section.id, section]),
);

/** Every field, keyed `sectionId.fieldId`. */
export const CONFIG_FIELDS: Record<string, ConfigFieldSpec & { section: string }> = Object.fromEntries(
  CONFIG_SECTIONS.flatMap(section =>
    section.fields.map(field => [`${section.id}.${field.id}`, { ...field, section: section.id }]),
  ),
);

export function findConfigField(sectionId: string, fieldId: string): ConfigFieldSpec | undefined {
  return CONFIG_SECTION_BY_ID[sectionId]?.fields.find(f => f.id === fieldId);
}

/**
 * Reads an environment variable the way its field declares it should be read.
 *
 * `not-false` reproduces the `process.env.X !== "false"` test a flag that ships on used, and
 * `is-true` reproduces the `process.env.X === "true"` test a flag that ships off used. Keeping
 * both here rather than at each call site is what stops a conversion silently reversing one.
 */
export function readEnvironmentBoolean(value: string | undefined, match: "not-false" | "is-true"): boolean {
  if (match === "is-true") return value === "true";
  return value !== undefined && value !== "" && value !== "false";
}

/** Whether the field's environment variable is present at all. */
export function environmentSupplies(field: ConfigFieldSpec, env: Record<string, string | undefined>): boolean {
  if (!field.env) return false;
  return env[field.env] !== undefined && env[field.env] !== "";
}

/**
 * Resolves a field against the environment alone. Used by the API before any setting exists,
 * and by the probe suite to assert that converting a flag did not change what an existing
 * deployment resolves to.
 */
export function resolveEnvironmentValue(
  field: ConfigFieldSpec,
  env: Record<string, string | undefined>,
): boolean | number | string {
  const raw = field.env ? env[field.env] : undefined;
  if (raw === undefined || raw === "") return field.default;
  if (field.type === "boolean") return readEnvironmentBoolean(raw, field.envMatch ?? "not-false");
  if (field.type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : field.default;
  }
  return raw;
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

/**
 * Validates one field's new value. Returns the coerced value, or a message explaining what is
 * wrong with it, so the API and the form agree on what a legal value is.
 */
export function coerceConfigValue(
  field: ConfigFieldSpec,
  input: unknown,
): { ok: true; value: boolean | number | string } | { ok: false; message: string } {
  if (field.source === "environment") {
    return { ok: false, message: `${field.label} is set by the deployment and cannot be changed here` };
  }
  if (field.locked) {
    return { ok: false, message: `${field.label} is required by the product and cannot be changed` };
  }

  switch (field.type) {
    case "boolean": {
      if (typeof input === "boolean") return { ok: true, value: input };
      if (input === "true" || input === "1") return { ok: true, value: true };
      if (input === "false" || input === "0") return { ok: true, value: false };
      return { ok: false, message: `${field.label} must be on or off` };
    }
    case "number": {
      const parsed = typeof input === "number" ? input : Number(String(input ?? "").trim());
      if (!Number.isFinite(parsed)) return { ok: false, message: `${field.label} must be a number` };
      const rounded = field.step && field.step >= 1 ? Math.round(parsed) : parsed;
      if (field.min !== undefined && rounded < field.min) {
        return { ok: false, message: `${field.label} cannot be lower than ${field.min}${field.unit ? ` ${field.unit}` : ""}` };
      }
      if (field.max !== undefined && rounded > field.max) {
        return { ok: false, message: `${field.label} cannot be higher than ${field.max}${field.unit ? ` ${field.unit}` : ""}` };
      }
      return { ok: true, value: rounded };
    }
    case "colour": {
      const text = String(input ?? "").trim();
      if (text === "") return { ok: true, value: "" };
      if (!/^#[0-9a-fA-F]{6}$/.test(text)) return { ok: false, message: `${field.label} must be a hex colour such as #2563eb` };
      return { ok: true, value: text.toLowerCase() };
    }
    case "url": {
      const text = String(input ?? "").trim();
      if (text === "") return { ok: true, value: "" };
      if (!/^https?:\/\//i.test(text) && !text.startsWith("/")) {
        return { ok: false, message: `${field.label} must be an http(s) address or a path starting with /` };
      }
      return { ok: true, value: text };
    }
    case "select": {
      const text = String(input ?? "").trim();
      if (field.choices && field.choices.length > 0 && !field.choices.some(c => c.value === text)) {
        return { ok: false, message: `${field.label} must be one of the listed choices` };
      }
      return { ok: true, value: text };
    }
    default: {
      const text = String(input ?? "").trim();
      if (field.id === "overtimeAfter" && text !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
        return { ok: false, message: `${field.label} must be a 24-hour clock time such as 18:00` };
      }
      return { ok: true, value: text };
    }
  }
}

/** Unit-suffixed millisecond conversion for the time-based portal settings. */
export function configMinutesToMs(minutes: number): number {
  return Math.round(minutes * MINUTE_MS);
}

export function configHoursToMs(hours: number): number {
  return Math.round(hours * HOUR_MS);
}
