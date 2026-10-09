import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, BarChart3, Bot, Building2, Clock, Database, DollarSign, FolderKanban,
  HelpCircle, Home, Settings2, Shield, SquareTerminal, Ticket,
} from "lucide-react";
import type { NavNode } from "../components/Layout";

/**
 * The modern navigation pane: a stable rail of domains, and the destinations inside one of them.
 *
 * Two things this module deliberately does **not** do.
 *
 * 1. **It does not own any labels or routes.** Domains are declared as *lists of node ids*, and every
 *    label, route, icon and permission is read back out of `NAV_TREE` at build time. Adding a section
 *    to the tree and forgetting it here leaves it in `unsorted` — visible on screen, counted in the
 *    domain that collects the leftovers — rather than silently absent from the navigation, which is
 *    the failure mode a hand-written second tree always has.
 * 2. **It does not change what a page is called.** Five rows are renamed for scanning, because the
 *    same word appears twice in the tree ("Service Boards" is both a destination and its settings
 *    page) or says too little ("Dashboard", under Kumo). The rename is confined to this pane: the page
 *    header and the breadcrumb trail still read the real name from the tree, so nothing needs to know
 *    that the pane and the page spell a thing differently.
 */

export interface NavDestination {
  /** The `NAV_TREE` node id, or a synthetic id for a route the tree does not list. */
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  /** Rendered indented beneath its parent — a page that lives inside a hub rather than beside it. */
  child?: boolean;
  note?: string;
  /** Filled in by the caller: the live service-alert count. */
  badge?: number;
}

export interface NavDomain {
  id: string;
  label: string;
  icon: LucideIcon;
  /** One line saying what the domain is for. Shown above its rows. */
  what: string;
  items: NavDestination[];
}

interface DomainSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  what: string;
  /** Nodes, in reading order. `children` are rendered indented under the node that owns them. */
  rows: Array<{ id: string; children?: string[]; note?: string }>;
}

/** Routes that exist but are not in `NAV_TREE`, placed explicitly so the pane can show them. */
const EXTRA_NODES: Record<string, { to: string; label: string; icon: LucideIcon }> = {
  activity: { to: "/activity", label: "My Activity", icon: Clock },
  settings: { to: "/settings", label: "My Preferences", icon: Settings2 },
  "settings-ai": { to: "/settings/ai", label: "AI Inference", icon: Bot },
  "mfa-setup": { to: "/mfa-setup", label: "Two-Factor Authentication", icon: Shield },
  console: { to: "/console", label: "Console", icon: SquareTerminal },
};

/**
 * The favourites section's own id. Nothing navigates to it — it is the pane's list of pinned nodes —
 * but both panes and the context menus have to agree on what it is called, so it lives with the
 * model rather than inside the pane that happens to draw it first.
 */
export const FAVORITES_NODE_ID = "favorites";

/**
 * Rows renamed for the pane, with the reason. Every one of them is either the second use of the same
 * words in the tree or a label that only works when you already know where you are.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  "kumo-dashboard": "Overview",                     // "Dashboard" again, this time inside Kumo
  "admin-boards": "Service Board Settings",        // vs the Service Boards destination
  "admin-service-alerts": "Alert Settings",        // vs the Service Alerts destination
  "help-configuration": "Configuration Reference",  // vs Administration → Configuration
  "billing-reports": "Billing Reports",            // vs Reporting, which is a domain of reports
};

const DOMAIN_SPECS: DomainSpec[] = [
  {
    id: "today",
    label: "Today",
    icon: Home,
    what: "Where you are, and what you have just done.",
    rows: [{ id: "home" }, { id: "dashboard" }, { id: "activity" }],
  },
  {
    id: "desk",
    label: "Service Desk",
    icon: Ticket,
    what: "The queue, the boards it sits on, and the articles you answer with.",
    rows: [
      { id: "tickets" },
      { id: "boards" },
      { id: "kb" },
    ],
  },
  {
    id: "clients",
    label: "Clients",
    icon: Building2,
    what: "The people you serve: who they are, what they own, and what they can see.",
    rows: [
      { id: "clients-list" },
      { id: "clients-contacts" },
      { id: "assets-inventory" },
      { id: "assets-procurement" },
      { id: "admin-portal", note: "settings" },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    icon: FolderKanban,
    what: "The work you have committed to, and the time it takes.",
    rows: [{ id: "projects-list" }, { id: "calendar" }, { id: "pto" }],
  },
  {
    id: "revenue",
    label: "Revenue",
    icon: DollarSign,
    what: "The pipeline, what was sold, what is owed, and what it cost.",
    rows: [
      { id: "pipeline" },
      { id: "billing-quotes" },
      { id: "billing-invoices" },
      { id: "billing-agreements" },
      { id: "billing-payments" },
      { id: "billing-time" },
      { id: "billing-dashboard" },
      { id: "billing-reports" },
      { id: "admin-products", note: "pricing" },
    ],
  },
  {
    id: "insight",
    label: "Insight",
    icon: BarChart3,
    what: "How the business is doing, and what the model has proposed.",
    rows: [
      { id: "reports-dashboard" },
      { id: "reports-standard" },
      { id: "reports-reviews" },
      { id: "reports-analytics" },
      { id: "reports-custom" },
      { id: "admin-ai-actions" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    icon: Shield,
    what: "How this instance is wired: connections, access, and every setting behind them.",
    rows: [
      { id: "c7nc-overview" },
      { id: "c7nc-services" },
      { id: "c7nc-models" },
      { id: "c7nc-email" },
      { id: "c7nc-flexpoint" },
      { id: "c7nc-apps" },
      { id: "users-list" },
      { id: "users-roles" },
      { id: "admin-api" },
      { id: "admin-sso" },
      { id: "admin-logs" },
      { id: "admin-system" },
      // Thirteen setting rows become one destination. The hub already exists and already presents
      // these as sections; the navigation was the only place that insisted on listing them all.
      { id: "admin-configuration", children: ["admin-boards", "admin-service-alerts"] },
    ],
  },
  {
    /**
     * Service Alerts keeps a parent-level row, and it sits as a section of its own rather than being
     * buried in the settings drawer.
     *
     * The reason is the badge. This is the only row in the navigation that reports the state of the
     * instance rather than the shape of it: burying it one level inside a domain means the count is
     * invisible until somebody opens that domain, which is the wrong trade for the one alarming
     * number on the screen. The two rows that raise the alerts came with it rather than staying
     * behind in the settings drawer, because a monitor and the alert it opens are one story.
     */
    id: "alerts",
    label: "Service Alerts",
    icon: AlertTriangle,
    what: "What is currently wrong, and the checks and endpoints that raise it.",
    rows: [
      { id: "service-alerts" },
      { id: "admin-monitors" },
      { id: "admin-webhooks" },
    ],
  },
  {
    /**
     * Kumo goes last, at the foot of the spine and just above the utilities.
     *
     * Two reasons, and the second one is the one that shows. It is a product inside this one rather
     * than a part of the service-desk flow — the mark it carries says so — so it reads better beside
     * the utilities than in the middle of the delivery rows. And where it stood, between Platform and
     * Service alerts, a wordmark the height of a heading sat above two ordinary rows and made them
     * look like its children; at the end it abuts the utilities, which are separated by their own
     * heading, so nothing can be mistaken for its contents.
     */
    id: "kumo",
    label: "Kumo",
    icon: Database,
    what: "The documentation app inside this one: passwords, configurations, documents and checks.",
    rows: [
      { id: "kumo-dashboard" },
      { id: "kumo-organizations" },
      { id: "kumo-assets" },
      { id: "kumo-passwords" },
      { id: "kumo-configs" },
      { id: "kumo-documents" },
      { id: "kumo-checklists" },
      { id: "kumo-domains" },
    ],
  },
];

/** The utilities at the foot of the rail. Assistant joins the spine when the setting says so. */
const UTILITY_SPECS: Record<string, DomainSpec> = {
  assistant: {
    id: "assistant",
    label: "Assistant",
    icon: Bot,
    what: "Ask about what is on screen, and see what it looked up.",
    rows: [{ id: "assistant" }],
  },
  help: {
    id: "help",
    label: "Help",
    icon: HelpCircle,
    what: "How to use this instance, and what changed in it.",
    rows: [
      { id: "help-home" },
      { id: "help-getting-started" },
      { id: "help-faq" },
      { id: "help-index" },
      { id: "help-configuration" },
      { id: "admin-changelog" },
    ],
  },
  prefs: {
    id: "prefs",
    label: "My Settings",
    icon: Settings2,
    what: "Your account and your preferences.",
    rows: [{ id: "settings" }, { id: "settings-ai" }, { id: "mfa-setup" }],
  },
  console: {
    id: "console",
    label: "Console",
    icon: SquareTerminal,
    what: "The command surface.",
    rows: [{ id: "console" }],
  },
};

/** Where Assistant sits when it is part of the spine rather than the foot of the rail. */
const ASSISTANT_SPINE_AFTER = "today";

export interface NavPaneModel {
  domains: NavDomain[];
  utilities: NavDomain[];
  /** Destinations in `NAV_TREE` that no domain claims. Normally empty; shown when it is not. */
  unsorted: NavDestination[];
}

/**
 * Turn the tree into the pane's model.
 *
 * `tree` must already be permission-filtered (the caller does that), so this only has to know the
 * shape. Anything it cannot place is returned in `unsorted` rather than dropped.
 */
export function buildNavPane(
  tree: NavNode[],
  options: { assistantInRail?: boolean } = {},
): NavPaneModel {
  const byId = new Map<string, NavNode>();
  const walk = (nodes: NavNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);

  const claimed = new Set<string>();

  const toDestination = (id: string, extra?: { child?: boolean; note?: string }): NavDestination | null => {
    const node = byId.get(id);
    if (node && !node.children && node.to) {
      claimed.add(id);
      return {
        id,
        to: node.to,
        label: LABEL_OVERRIDES[id] ?? node.label,
        icon: node.icon,
        ...(extra?.child ? { child: true } : {}),
        ...(extra?.note ? { note: extra.note } : {}),
      };
    }
    const extraNode = EXTRA_NODES[id];
    if (extraNode) {
      claimed.add(id);
      return {
        id,
        to: extraNode.to,
        label: extraNode.label,
        icon: extraNode.icon,
        ...(extra?.child ? { child: true } : {}),
        ...(extra?.note ? { note: extra.note } : {}),
      };
    }
    return null;
  };

  const buildDomain = (spec: DomainSpec): NavDomain => {
    const items: NavDestination[] = [];
    for (const row of spec.rows) {
      const destination = toDestination(row.id, { note: row.note });
      if (!destination) continue;
      items.push(destination);
      for (const childId of row.children ?? []) {
        const child = toDestination(childId, { child: true, note: "in the hub" });
        if (child) items.push(child);
      }
    }
    return { id: spec.id, label: spec.label, icon: spec.icon, what: spec.what, items };
  };

  const spineSpecs = [...DOMAIN_SPECS];
  if (options.assistantInRail) {
    const assistant = UTILITY_SPECS.assistant;
    if (assistant) {
      const after = spineSpecs.findIndex((spec) => spec.id === ASSISTANT_SPINE_AFTER);
      // `at` is -1 only if the anchor domain was removed, in which case the end of the spine is the
      // sensible place rather than index 0.
      spineSpecs.splice(after < 0 ? spineSpecs.length : after + 1, 0, assistant);
    }
  }

  // A group with nothing in it is not a group: a permission can empty a whole domain, and an empty
  // rail row that opens an empty column is worse than no row.
  const domains = spineSpecs.map(buildDomain).filter((domain) => domain.items.length > 0);

  const utilityIds = options.assistantInRail
    ? ["help", "prefs", "console"]
    : ["assistant", "help", "prefs", "console"];
  const utilities = utilityIds
    .map((id) => UTILITY_SPECS[id])
    .filter((spec): spec is DomainSpec => !!spec)
    .map(buildDomain)
    .filter((domain) => domain.items.length > 0);

  const unsorted: NavDestination[] = [];
  for (const node of byId.values()) {
    if (node.children || !node.to || claimed.has(node.id)) continue;
    unsorted.push({ id: node.id, to: node.to, label: node.label, icon: node.icon });
  }

  return { domains, utilities, unsorted };
}

/* ── Learned ordering ───────────────────────────────────────────────────────────────────────────
 * Which rows a person actually opens, and when. Kept per browser because it is a property of how
 * somebody works rather than a record the server needs — the same reasoning the Recent menu uses for
 * dwells.
 *
 * The rule that matters is what happens with no data: **nothing is demoted until the person has
 * opened something in that domain.** A pane that hides rows on first run, on the strength of a guess,
 * is a worse first run than the tree it replaced. Only once there is real usage does a row that has
 * never been opened fold away, and then only in a domain long enough to need it.
 */
const USAGE_KEY = "c7_nav_use";
const ORDER_KEY = "c7_nav_roworder";
const DOMAIN_KEY = "c7_nav_domain";
const QUIET_KEY = "c7_nav_quiet_open";

/** A domain longer than this may fold its never-opened rows, once there is usage to justify it. */
export const FOLD_THRESHOLD = 8;

export type RowOrder = "learned" | "az";

export interface UseRecord {
  /** How many times the row has been opened. */
  n: number;
  /** When it was last opened, epoch ms. */
  at: number;
}

export function readNavUsage(): Record<string, UseRecord> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, UseRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Recorded on navigation, not on render, so a row the pane merely lists is not counted as used. */
export function recordNavUse(id: string, usage: Record<string, UseRecord>): Record<string, UseRecord> {
  const current = usage[id] ?? { n: 0, at: 0 };
  const next = { ...usage, [id]: { n: current.n + 1, at: Date.now() } };
  try {
    // Bounded so the store cannot grow without limit if the tree ever does.
    const trimmed = Object.entries(next)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 200);
    localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* a full quota costs the ordering, not the application */
  }
  return next;
}

/**
 * Frequency weighted by recency: a row opened ten times last year scores below one opened twice
 * today, which is what makes the ordering feel like it is following you rather than counting.
 */
export function navScore(record: UseRecord | undefined): number {
  if (!record) return 0;
  const days = (Date.now() - record.at) / 86_400_000;
  return record.n * Math.exp(-days / 21);
}

export interface OrderedRows {
  /** Rows to show, in the order to show them. */
  visible: NavDestination[];
  /** Rows folded into the "everything else" group. Empty when nothing is folded. */
  folded: NavDestination[];
}

/**
 * Order and fold one domain's rows.
 *
 * Pinned rows are removed by the caller before this runs, so a favourite is not also listed here.
 *
 * **Nothing is folded until something in the domain has been opened.** With no usage every row is
 * equally "not opened yet", so folding would be a guess — and a pane that hides rows on first run, on
 * the strength of a guess, is a worse first run than the tree it replaced. The fold appears once there
 * is something real to rank against, which is also the first moment it means anything.
 *
 * Rows are ranked as **units**: a hub and the pages inside it travel together and are folded together.
 * Treating a child as an independent row put "Service board settings" above the parent it belongs to
 * and then folded that parent away, which reads as a page that came from nowhere.
 */
interface RowUnit {
  parent: NavDestination;
  children: NavDestination[];
}

function toUnits(items: readonly NavDestination[]): RowUnit[] {
  const units: RowUnit[] = [];
  for (const item of items) {
    const last = units[units.length - 1];
    // A child always follows the row that owns it, so the unit on top is the right one to join.
    if (item.child && last) last.children.push(item);
    else units.push({ parent: item, children: [] });
  }
  return units;
}

const flattenUnits = (units: readonly RowUnit[]): NavDestination[] =>
  units.flatMap((unit) => [unit.parent, ...unit.children]);

const unitUse = (unit: RowUnit, usage: Record<string, UseRecord>): number =>
  Math.max(...[unit.parent, ...unit.children].map((item) => navScore(usage[item.id])));

export function orderRows(
  items: NavDestination[],
  usage: Record<string, UseRecord>,
  order: RowOrder,
): OrderedRows {
  const units = toUnits(items);

  if (order === "az") {
    return {
      visible: flattenUnits([...units].sort((a, b) => a.parent.label.localeCompare(b.parent.label))),
      folded: [],
    };
  }

  const used = units.filter((unit) => [unit.parent, ...unit.children].some((item) => usage[item.id]));
  if (used.length === 0) return { visible: items, folded: [] };

  const unused = units.filter((unit) => !used.includes(unit));
  used.sort((a, b) => unitUse(b, usage) - unitUse(a, usage));

  // What is left of the budget after the rows actually in use, spent on whole units.
  let budget = Math.max(0, FOLD_THRESHOLD - used.reduce((n, unit) => n + 1 + unit.children.length, 0));
  const kept: RowUnit[] = [];
  for (const unit of unused) {
    const size = 1 + unit.children.length;
    if (size <= budget) { kept.push(unit); budget -= size; }
  }
  const folded = unused.filter((unit) => !kept.includes(unit));

  return { visible: flattenUnits([...used, ...kept]), folded: flattenUnits(folded) };
}

export const NAV_STORAGE_KEYS = {
  usage: USAGE_KEY,
  order: ORDER_KEY,
  domain: DOMAIN_KEY,
  quietOpen: QUIET_KEY,
} as const;
