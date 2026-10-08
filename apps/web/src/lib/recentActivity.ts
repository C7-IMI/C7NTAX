/**
 * Recent activity: what this person changed, and where they were.
 *
 * The header's Recent menu used to be a placeholder. What it should show is **work, not browsing** —
 * a ticket updated, a client created, a setting changed — and each entry should take you back to the
 * exact place, not to the top of a section. So this module has two sources and one shape:
 *
 * 1. **Changes** come from the audit trail, filtered to the caller (`GET /api/system/audit-logs?mine`)
 *    and capped at five by the menu. The audit middleware already records every successful write with
 *    its actor, its entity and a redacted summary of the body, so nothing new is collected — the trail
 *    was being written all along and simply had no reader.
 * 2. **Visits** are the exception the operator asked for: a page you *stayed on* for two minutes is an
 *    activity, where a page you passed through is not. Those are observed in the browser and kept
 *    locally, because a dwell is a fact about this session rather than a record the server should own.
 *    The cost of that choice is that a visit does not follow you to another machine; the benefit is
 *    that the act of looking at a page is not written into the audit trail and turned into data.
 *
 * **What a link can and cannot do.** An audit row names an entity and an id, and some rows genuinely
 * do not identify a record — `POST /api/clients` used to store the literal `clients`, and
 * `POST /api/cloudconnect/<id>/offboard` stores `offboard`. So a link is resolved in that order:
 * the record when the id is one, the section that owns the entity otherwise, and the audit trail as
 * the last resort. A menu that pretended every row has a destination would send people to `404`s.
 */
import { CONFIG_FIELDS } from "@C7NTAX/shared";

export type RecentIcon =
  | "ticket" | "client" | "billing" | "asset" | "kumo" | "integration" | "ai"
  | "admin" | "alert" | "board" | "kb" | "report" | "settings" | "page";

export interface RecentActivity {
  /** Stable across reloads: `audit:<row id>` or `visit:<path>`. */
  id: string;
  kind: "change" | "visit";
  /** ISO timestamp of when it happened. */
  at: string;
  /** What happened, in a person's words: "Ticket updated", "Setting changed". */
  title: string;
  /** The thing it happened to, when we can name it: a subject, a record, a page. */
  detail?: string;
  /** Where to go: an app path, with the arrival target when there is one. */
  to: string;
  /** The region to scroll to and flash on arrival (`data-hl` value). */
  target?: string;
  icon: RecentIcon;
}

/** The shape the audit route returns, as much of it as this module reads. */
export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  changes?: Record<string, unknown> | null;
  userId: string;
  userName?: string;
  createdAt: string;
}

/**
 * Entities that are interface chrome rather than work — the order of your own favourites, the layout
 * of your own dashboard. They are real changes, and the audit trail keeps them; they are excluded here
 * because "you moved a sidebar item" is not somewhere anyone wants to be taken back to, and they would
 * crowd out the five entries the menu has room for.
 */
const CHROME_ENTITIES = new Set(["nav", "dashboard"]);

/** Entities whose route family differs from their audit name, and where each one lives. */
interface EntityHome {
  /** What to call one of these in a sentence. */
  label: string;
  icon: RecentIcon;
  /** The section to open when the row does not identify a single record. */
  section: string;
  /** The route for one record, given its id. Omitted when the entity has no detail page. */
  record?: (id: string) => string;
  /** The region to flash on the record's page. */
  target?: string;
}

const ENTITY_HOMES: Record<string, EntityHome> = {
  tickets: { label: "Ticket", icon: "ticket", section: "/tickets", record: (id) => `/tickets/${id}`, target: "ticket-activity" },
  company: { label: "Client", icon: "client", section: "/clients", record: (id) => `/clients/${id}`, target: "client-details" },
  clients: { label: "Client", icon: "client", section: "/clients", record: (id) => `/clients/${id}`, target: "client-details" },
  contact: { label: "Contact", icon: "client", section: "/clients/contacts" },
  billing: { label: "Billing", icon: "billing", section: "/billing" },
  invoices: { label: "Invoice", icon: "billing", section: "/billing" },
  quotes: { label: "Quote", icon: "billing", section: "/quotes" },
  contracts: { label: "Contract", icon: "billing", section: "/billing/agreements" },
  procurement: { label: "Purchase order", icon: "asset", section: "/procurement" },
  products: { label: "Product", icon: "asset", section: "/admin/products" },
  inventory: { label: "Asset", icon: "asset", section: "/assets", record: (id) => `/assets/${id}` },
  assets: { label: "Asset", icon: "asset", section: "/assets", record: (id) => `/assets/${id}` },
  boards: { label: "Service board", icon: "board", section: "/boards" },
  board_categories: { label: "Board category", icon: "board", section: "/boards" },
  "service-alerts": { label: "Service alert", icon: "alert", section: "/service-alerts" },
  alert_webhooks: { label: "Alert webhook", icon: "alert", section: "/admin/webhooks" },
  kb: { label: "Knowledge base article", icon: "kb", section: "/kb" },
  reports: { label: "Report", icon: "report", section: "/reports" },
  cloudconnect: { label: "Connection", icon: "integration", section: "/c7nc/services" },
  c7nc: { label: "Connection", icon: "integration", section: "/c7nc/services" },
  flexpoint: { label: "FlexPoint", icon: "integration", section: "/c7nc/flexpoint" },
  "email-connectors": { label: "Mail connector", icon: "integration", section: "/c7nc/email" },
  "outlook-addin": { label: "Outlook add-in", icon: "integration", section: "/c7nc/outlook-addin" },
  "oauth-app": { label: "OAuth application", icon: "integration", section: "/c7nc/apps" },
  oauth_app: { label: "OAuth application", icon: "integration", section: "/c7nc/apps" },
  inference: { label: "AI connection", icon: "ai", section: "/settings/ai" },
  "ai-actions": { label: "AI action", icon: "ai", section: "/ai-actions" },
  chat: { label: "Chat session", icon: "ai", section: "/assistant" },
  users: { label: "User", icon: "admin", section: "/users" },
  roles: { label: "Role", icon: "admin", section: "/roles" },
  "api-keys": { label: "API key", icon: "admin", section: "/admin/api" },
  api_key: { label: "API key", icon: "admin", section: "/admin/api" },
  kumo_passwords: { label: "Kumo password", icon: "kumo", section: "/kumo/passwords" },
  kumo_documents: { label: "Kumo document", icon: "kumo", section: "/kumo/documents" },
  kumo_assets: { label: "Kumo asset", icon: "kumo", section: "/kumo/assets" },
  kumo_links: { label: "Kumo link", icon: "kumo", section: "/kumo/configs" },
  kumo: { label: "Kumo item", icon: "kumo", section: "/kumo" },
  projects: { label: "Project", icon: "ticket", section: "/projects" },
  crm: { label: "Opportunity", icon: "client", section: "/opportunities" },
  pto: { label: "Leave request", icon: "admin", section: "/pto" },
  schedule: { label: "Schedule", icon: "admin", section: "/calendar" },
  checklists: { label: "Checklist", icon: "ticket", section: "/kumo/checklists" },
  system_config: { label: "Setting", icon: "settings", section: "/admin/system" },
  system: { label: "System", icon: "settings", section: "/admin/system" },
  sso: { label: "Single sign-on", icon: "settings", section: "/admin/sso" },
  configuration: { label: "Configuration", icon: "settings", section: "/admin/configuration" },
  portal: { label: "Customer portal", icon: "settings", section: "/admin/portal" },
  workflows: { label: "Automation rule", icon: "admin", section: "/admin" },
  events: { label: "Event", icon: "alert", section: "/admin/logs" },
  bulk: { label: "Bulk operation", icon: "admin", section: "/admin/logs" },
};

/** Where a row with nothing better to say goes: the trail it came from. */
const AUDIT_TRAIL = "/admin/logs";

/** A UUID, or a ticket number — the two shapes an id takes in this application. */
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecordId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 8 && !value.includes("/") && (
    RECORD_ID.test(value) || /^[A-Z0-9]+-[A-Z0-9-]+$/i.test(value)
  );
}

/** Keys a person would recognise a record by, best first. */
const NAME_KEYS = ["title", "subject", "name", "ticketNumber", "invoiceNumber", "quoteNumber", "email", "label", "key", "hostname", "assetTag"];

function nameFromChanges(changes: Record<string, unknown> | null | undefined): string | undefined {
  if (!changes) return undefined;
  for (const key of NAME_KEYS) {
    const value = changes[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * The verb for an action, in English.
 *
 * The audit middleware records `entity:create|update|delete`, and a handful of routes record their own
 * more specific action (`oauth_app.imported`, `api_key.rotated`). Both spellings are read here, because
 * a menu that says "api_key.revoked updated" is worse than one that says nothing.
 */
function verbFor(action: string): string {
  const specific: Record<string, string> = {
    "oauth_app.imported": "imported",
    "oauth_app.deployed": "deployed",
    "api_key.created": "created",
    "api_key.revoked": "revoked",
    "api_key.rotated": "rotated",
  };
  if (specific[action]) return specific[action] as string;
  const suffix = action.split(":")[1] ?? "update";
  return suffix === "create" ? "created" : suffix === "delete" ? "deleted" : "updated";
}

/**
 * A setting change, resolved to the screen and the field that owns it.
 *
 * The audit row for `PUT /api/system/config/<key>` stores the **key** as its entity id, and the
 * configuration screen is generated from the registry — so a stored key can be turned into
 * `/admin/configuration/<section>?hl=field:<fieldId>` and the exact control can be flashed. Which is
 * the whole point of the highlight for a settings change: "you changed a setting" is useless,
 * "you changed the idle timeout, here it is" is not.
 */
function configDestination(key: string): { to: string; target?: string; detail: string } {
  const field = Object.values(CONFIG_FIELDS).find((candidate) => candidate.id === key);
  if (field) {
    return {
      to: `/admin/configuration/${field.section}`,
      target: `field:${field.id}`,
      detail: field.label,
    };
  }
  return { to: "/admin/system", detail: key };
}

/**
 * One audit row as an activity, or `null` when it is chrome rather than work.
 *
 * Deliberately total: every branch returns something a person can read, because a menu that quietly
 * drops rows it did not understand looks like activity that never happened.
 */
export function activityFromAudit(row: AuditRow): RecentActivity | null {
  const entity = row.entity;
  if (CHROME_ENTITIES.has(entity)) return null;

  const home = ENTITY_HOMES[entity];
  const verb = verbFor(row.action);
  const detail = nameFromChanges(row.changes);
  const what = home?.label ?? entity;

  // A setting is its own case: the destination depends on which setting it was.
  if (entity === "system_config" || entity === "system") {
    const destination = configDestination(row.entityId);
    return {
      id: `audit:${row.id}`,
      kind: "change",
      at: row.createdAt,
      title: `Setting ${verb}`,
      detail: destination.detail,
      to: destination.to,
      ...(destination.target ? { target: destination.target } : {}),
      icon: "settings",
    };
  }

  // An AI action is proposed and then decided, and the decision is the interesting half.
  if (entity === "ai-actions") {
    const decision = row.changes?.decision;
    return {
      id: `audit:${row.id}`,
      kind: "change",
      at: row.createdAt,
      title: typeof decision === "string" ? `AI action ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision}` : "AI action raised",
      ...(detail ? { detail } : {}),
      to: home?.section ?? AUDIT_TRAIL,
      icon: "ai",
    };
  }

  const record = home?.record && isRecordId(row.entityId) ? home.record(row.entityId) : null;
  const to = record ?? home?.section ?? AUDIT_TRAIL;

  return {
    id: `audit:${row.id}`,
    kind: "change",
    at: row.createdAt,
    title: `${what} ${verb}`,
    ...(detail ? { detail } : {}),
    to,
    ...(record && home?.target ? { target: home.target } : {}),
    icon: home?.icon ?? "page",
  };
}

/** Turn a tail of audit rows into activities, newest first, dropping chrome and duplicates. */
export function activitiesFromAudit(rows: readonly AuditRow[], limit = 5): RecentActivity[] {
  const out: RecentActivity[] = [];
  for (const row of rows) {
    const activity = activityFromAudit(row);
    if (!activity) continue;
    // Two rows for the same destination within the same second are one activity to a reader — a
    // ticket saved twice in a row is not two separate places to go back to.
    if (out.some((existing) => existing.to === activity.to && existing.title === activity.title)) continue;
    out.push(activity);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Visits ──────────────────────────────────────────────────────────────
/**
 * A visit is kept locally: `{ path, label, at }`, capped, per user.
 *
 * `label` is stored rather than derived on read so a visit still reads correctly after a page is
 * renamed, and so the store does not need the nav tree to be useful.
 */
export interface VisitRecord {
  path: string;
  label: string;
  at: string;
}

const VISIT_KEY_PREFIX = "c7_recent_visits";
const VISIT_LIMIT = 20;

const visitKey = (userKey: string): string => `${VISIT_KEY_PREFIX}:${userKey}`;

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readVisits(userKey: string): VisitRecord[] {
  const visits = safeRead<VisitRecord[]>(visitKey(userKey), []);
  return Array.isArray(visits) ? visits.filter((v) => v && typeof v.path === "string") : [];
}

/** Record a dwell. One entry per path — going back to a page moves it to the top rather than adding a row. */
export function recordVisit(userKey: string, path: string, label: string): VisitRecord[] {
  const visits = readVisits(userKey).filter((visit) => visit.path !== path);
  visits.unshift({ path, label, at: new Date().toISOString() });
  const capped = visits.slice(0, VISIT_LIMIT);
  try {
    localStorage.setItem(visitKey(userKey), JSON.stringify(capped));
  } catch {
    /* a full quota costs the history, not the application */
  }
  return capped;
}

export function clearVisits(userKey: string): void {
  try {
    localStorage.removeItem(visitKey(userKey));
  } catch {
    /* nothing to do */
  }
}

/** A stored visit as an activity. */
export function activityFromVisit(visit: VisitRecord): RecentActivity {
  return {
    id: `visit:${visit.path}`,
    kind: "visit",
    at: visit.at,
    title: "Viewed",
    detail: visit.label,
    to: visit.path,
    target: "page-heading",
    icon: "page",
  };
}

/** Merge changes and visits, newest first, capped. */
export function mergeRecent(
  changes: readonly RecentActivity[],
  visits: readonly VisitRecord[],
  limit = 5,
): RecentActivity[] {
  const merged = [...changes, ...visits.map(activityFromVisit)];
  // A page you changed and then stayed on is one thing, not two: the change came first and it is the
  // more useful entry, so the visit is dropped rather than shown beside it.
  const changedPaths = new Set(changes.map((change) => change.to.split("?")[0]));
  return merged
    .filter((activity, index, all) => {
      if (activity.kind !== "visit") return true;
      if (changedPaths.has(activity.to)) return false;
      return all.findIndex((other) => other.id === activity.id) === index;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

/**
 * How long a page has to hold someone's attention before simply being on it counts as an activity.
 *
 * The operator's rule, and a good one: passing through a section is not an activity, but *reading* it
 * is — and two minutes is long enough that it cannot be a mis-click or a redirect.
 */
export const DWELL_MS = 2 * 60 * 1000;

/** "3m ago", "just now", "2h ago", "yesterday", then a date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The URL an activity is opened with: the path plus the arrival target. */
export function activityHref(activity: RecentActivity): string {
  if (!activity.target) return activity.to;
  const separator = activity.to.includes("?") ? "&" : "?";
  return `${activity.to}${separator}hl=${encodeURIComponent(activity.target)}`;
}
