import { Link, useLocation } from "react-router-dom";
import { BookOpen, HelpCircle, Settings2, ListOrdered, ChevronRight, Lightbulb, AlertTriangle } from "lucide-react";

// ── PSA-style documentation frame (structure modeled on Autotask / ConnectWise Asio / HaloPSA docs) ──
// Left rail: section navigation + on-page anchors. Content: steps, callouts, tables,
// and a "Related topics" cross-reference box.

export type HelpSection = {
  id: string;
  path: string;
  title: string;
  description: string;
  anchors: Array<{ id: string; label: string }>;
  blocks: HelpBlock[];
  related: Array<{ label: string; to: string; external?: boolean }>;
};

type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "tip"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] };

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    path: "/help/getting-started",
    title: "Getting Started",
    description: "Set up your workspace, create your first ticket, and learn the core workflow.",
    anchors: [
      { id: "first-login", label: "First login & profile" },
      { id: "core-workflow", label: "The core ticket workflow" },
      { id: "team-setup", label: "Team & boards setup" },
    ],
    blocks: [
      { kind: "h", text: "First login & profile" },
      { kind: "p", text: "Sign in with your email or username. If multi-factor authentication (MFA) is enabled for your account, complete the second step with your authenticator app or email code. SSO and passkey sign-in are available when your administrator has enabled them." },
      { kind: "steps", items: [
        "Sign in at the login page and complete MFA if prompted.",
        "Open My Account (top right) to review your profile and set your landing page.",
        "Choose your default landing page under Settings → Preferences.",
        "Browse the navigation pane to explore Dashboard, Tickets, Service Boards, Clients, Billing, and Kumo.",
      ] },
      { kind: "tip", text: "Press T anywhere outside a text field to jump straight to Tickets." },
      { kind: "h", text: "The core ticket workflow" },
      { kind: "p", text: "C7NTAX is built around the ticket lifecycle: create → triage → work → resolve → invoice." },
      { kind: "steps", items: [
        "Open Tickets and select New Ticket (or press T to open the list first).",
        "Pick the client, board, category, and priority. Priority is deduced automatically if you leave it unset.",
        "Add time entries as you work — billable entries flow into invoices.",
        "Resolve the ticket when work is complete; follow-ups and auto-close rules are configured per board.",
      ] },
      { kind: "h", text: "Team & boards setup" },
      { kind: "p", text: "Administrators configure service boards, SLA policies, and team permissions under Administration → Service Boards." },
      { kind: "steps", items: [
        "Create a service board for each team or client group.",
        "Attach an email connector so inbound mail becomes tickets automatically.",
        "Assign technicians via Users & Roles → Manage Users and Manage Roles.",
      ] },
      { kind: "note", text: "Board layouts, batch ticket actions, and drag-and-drop board customization are covered in Configuration." },
    ],
    related: [
      { label: "FAQ", to: "/help/faq" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "Help Index", to: "/help/index" },
      { label: "Tickets", to: "/tickets" },
      { label: "Service Boards", to: "/boards" },
    ],
  },
  {
    id: "faq",
    path: "/help/faq",
    title: "FAQ",
    description: "Answers to the most common questions about tickets, billing, integrations, and Kumo.",
    anchors: [
      { id: "tickets-faq", label: "Tickets" },
      { id: "billing-faq", label: "Billing & agreements" },
      { id: "integrations-faq", label: "Integrations & alerts" },
      { id: "kumo-faq", label: "Kumo & security" },
    ],
    blocks: [
      { kind: "h", text: "Tickets" },
      { kind: "p", text: "Q: Why was a ticket's priority changed automatically? — A: The priority deduction engine adjusts priority from keywords and SLA rules; you can override it manually." },
      { kind: "p", text: "Q: Can I acknowledge or close many tickets at once? — A: Yes. Select the checkboxes on the left of the ticket list, then apply a batch action from the bulk bar." },
      { kind: "p", text: "Q: Can emails create tickets automatically? — A: Yes. Configure a monitored mailbox or M365 Graph connector under Administration → Service Boards → Email connectors." },
      { kind: "h", text: "Billing & agreements" },
      { kind: "p", text: "Q: How do I invoice unbilled ticket time? — A: Open the Finance Dashboard and use Generate draft invoice (or the billing flow) — a draft is created and time entries are linked." },
      { kind: "p", text: "Q: What agreement types are supported? — A: Block hours, all-you-can-eat (Cyber Care), and variable hourly spot billing. Overtime rules, midnight splits, and block-hour deductions follow the agreement engine." },
      { kind: "h", text: "Integrations & alerts" },
      { kind: "p", text: "Q: Where do I fix a broken integration? — A: CloudConnect shows live connection status; fix credentials inline and re-test without leaving the page." },
      { kind: "p", text: "Q: Can outages open tickets automatically? — A: Alert webhooks deliver alert.opened / alert.resolved events; wire them to your ticket automation." },
      { kind: "h", text: "Kumo & security" },
      { kind: "p", text: "Q: Are passwords encrypted? — A: Yes — Kumo stores passwords AES-256 encrypted, with TOTP and access logs." },
      { kind: "p", text: "Q: Who changed a shared document? — A: Each Kumo item shows an audit trail with the last modified date and user." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "CloudConnect", to: "/cloudconnect" },
      { label: "Finance Dashboard", to: "/billing/dashboard" },
      { label: "Kumo", to: "/kumo" },
    ],
  },
  {
    id: "configuration",
    path: "/help/configuration",
    title: "Configuration",
    description: "Reference for the settings, dialogs, and options available in C7NTAX.",
    anchors: [
      { id: "boards-config", label: "Service boards" },
      { id: "alerts-config", label: "Service alerts & uptime" },
      { id: "integrations-config", label: "CloudConnect connectors" },
      { id: "identity-config", label: "Identity: MFA, SSO, passkeys" },
    ],
    blocks: [
      { kind: "h", text: "Service boards" },
      { kind: "p", text: "Administration → Service Boards configures boards, SLA policies, categories, and email connectors. Drag board tiles to reorder and pin preferred elements to the top; the layout is saved per board." },
      { kind: "h", text: "Service alerts & uptime" },
      { kind: "p", text: "Service Alerts monitors vendor status feeds (RSS + DownDetector). Uptime Monitors adds website, SSL-expiry, and DNS checks — each with expected status codes and SSL warning thresholds." },
      { kind: "table", headers: ["Monitor kind", "Checks", "Config"], rows: [
        ["website", "HTTP status against expectStatus", "expectStatus (default 200)"],
        ["ssl", "Certificate expiry in days", "sslWarnDays (default 30)"],
        ["dns", "A-record resolution", "target hostname in monitorUrl"],
      ] },
      { kind: "h", text: "CloudConnect connectors" },
      { kind: "p", text: "CloudConnect hosts 16 connector types (M365, Pax8, ITGlue, Proofpoint, Avanan, SentinelOne, QuickBooks, Flexpoint, and more). Each connector has a Test Connection action; status chips update live and credentials can be fixed and re-tested inline." },
      { kind: "h", text: "Identity: MFA, SSO, passkeys" },
      { kind: "p", text: "MFA uses TOTP (authenticator apps) with email fallback. Administrators can enable SSO (OIDC — Keycloak, Entra ID, Okta, Auth0) via environment configuration, and users can register passkeys for passwordless sign-in." },
      { kind: "warn", text: "Feature flags default off: SSO_ENABLED, PASSKEY_ENABLED, UPTIME_MONITORS_ENABLED, ALERT_WEBHOOKS_ENABLED, AI_ACTIONS_ENABLED, EMAIL_GRAPH_ENABLED, PUSH_ENABLED, AUTH_HARDENING_ENABLED. Enable per environment." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Help Index", to: "/help/index" },
      { label: "Service Alerts", to: "/service-alerts" },
      { label: "Uptime Monitors", to: "/service-alerts/monitors" },
      { label: "CloudConnect", to: "/cloudconnect" },
      { label: "Settings", to: "/settings" },
    ],
  },
  {
    id: "index",
    path: "/help/index",
    title: "Index",
    description: "A searchable-style index of every help topic and its related product area.",
    anchors: [
      { id: "by-topic", label: "Topics A–Z" },
      { id: "by-area", label: "By product area" },
    ],
    blocks: [
      { kind: "h", text: "Topics A–Z" },
      { kind: "table", headers: ["Topic", "Section", "Product area"], rows: [
        ["Batch ticket actions", "FAQ → Tickets", "Tickets"],
        ["Billing from tickets", "FAQ → Billing", "Billing"],
        ["Board drag-and-drop layout", "Configuration → Service boards", "Service Boards"],
        ["Email → ticket (IMAP / M365 Graph)", "FAQ → Tickets", "Email connectors"],
        ["Feature flags", "Configuration → Identity", "System"],
        ["MFA, SSO, passkeys", "Configuration → Identity", "Authentication"],
        ["Overtime & block-hour rules", "FAQ → Billing", "Billing"],
        ["Outage board & webhooks", "FAQ → Integrations", "Service Alerts"],
        ["Quotes → invoices", "Configuration → Service boards", "Billing"],
        ["Uptime monitors (website/SSL/DNS)", "Configuration → Service alerts", "Service Alerts"],
      ] },
      { kind: "h", text: "By product area" },
      { kind: "table", headers: ["Area", "Where"], rows: [
        ["Tickets & boards", "Tickets, Service Boards, Administration → Service Boards"],
        ["Clients & contacts", "Clients, Contacts"],
        ["Billing & agreements", "Finance Dashboard, Invoices, Agreements, Payments, Time & Expenses"],
        ["Integrations", "CloudConnect, Service Alerts, Administration → System"],
        ["Knowledge & documentation", "Knowledge Base, Kumo (Assets, Passwords, Configurations, Documents)"],
        ["Reporting", "Reporting → Dashboards, Standard Reports, Analytics"],
      ] },
      { kind: "note", text: "This index is maintained alongside feature delivery; add a row whenever a new surface ships." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "FAQ", to: "/help/faq" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "What's New", to: "/admin/changelog" },
    ],
  },
];

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "h": return <h2 id={slugify(block.text)} className="text-base font-semibold text-white mt-6 mb-2">{block.text}</h2>;
    case "p": return <p className="text-sm text-gray-300 leading-relaxed mb-3">{block.text}</p>;
    case "steps": return (
      <ol className="list-decimal list-inside space-y-2 mb-3">
        {block.items.map((s, i) => <li key={i} className="text-sm text-gray-300 leading-relaxed">{s}</li>)}
      </ol>
    );
    case "note": return <div className="bg-cyber-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300"><span className="font-semibold text-cyber-400">Note: </span>{block.text}</div>;
    case "tip": return <div className="bg-green-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300 flex gap-2"><Lightbulb size={16} className="text-green-400 shrink-0 mt-0.5" /><span>{block.text}</span></div>;
    case "warn": return <div className="bg-amber-600/10 rounded-md px-3 py-2 my-3 text-sm text-gray-300 flex gap-2"><AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" /><span>{block.text}</span></div>;
    case "table": return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-sm border-collapse">
          <thead><tr>{block.headers.map((h, i) => <th key={i} className="text-left text-gray-400 font-semibold border-b border-surface-border px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {block.rows.map((r, ri) => <tr key={ri} className="border-b border-surface-border/50">{r.map((c, ci) => <td key={ci} className="text-gray-300 px-3 py-2">{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    );
    default: return null;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function HelpDocPage({ section }: { section: HelpSection }) {
  const pageAnchors = section.blocks.filter((b): b is Extract<HelpBlock, { kind: "h" }> => b.kind === "h").map((h) => ({ id: slugify(h.text), label: h.text }));
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-56 shrink-0">
        <div className="card p-3 sticky top-20">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Help sections</p>
          {HELP_SECTIONS.map((s) => (
            <Link key={s.id} to={s.path} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${s.id === section.id ? "bg-cyber-600/20 text-cyber-400" : "text-gray-300 hover:text-white hover:bg-surface-lighter"}`}>
              {s.id === "getting-started" && <BookOpen size={14} />}
              {s.id === "faq" && <HelpCircle size={14} />}
              {s.id === "configuration" && <Settings2 size={14} />}
              {s.id === "index" && <ListOrdered size={14} />}
              {s.title}
            </Link>
          ))}
          <div className="border-t border-surface-border/50 mt-2 pt-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">On this page</p>
            {pageAnchors.map((a) => (
              <a key={a.id} href={`#${a.id}`} className="block px-2 py-1 text-xs text-gray-400 hover:text-white rounded">{a.label}</a>
            ))}
          </div>
        </div>
      </aside>
      <article className="flex-1 card p-6">
        <h1 className="text-xl font-bold text-white">{section.title}</h1>
        <p className="text-sm text-gray-400 mt-1 mb-4">{section.description}</p>
        {section.blocks.map((b, i) => <Block key={i} block={b} />)}
        <div className="border-t border-surface-border/50 mt-6 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Related topics</p>
          <div className="flex flex-wrap gap-2">
            {section.related.map((r) => (
              <Link key={r.to + r.label} to={r.to} className="text-xs px-2.5 py-1 rounded-full bg-surface-lighter text-gray-300 hover:text-white hover:bg-cyber-600/20 inline-flex items-center gap-1">
                {r.label} <ChevronRight size={12} />
              </Link>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}

export function HelpGettingStarted() { const s = HELP_SECTIONS[0]!; useLocation(); return <HelpDocPage section={s} />; }
export function HelpFaq() { const s = HELP_SECTIONS[1]!; useLocation(); return <HelpDocPage section={s} />; }
export function HelpConfiguration() { const s = HELP_SECTIONS[2]!; useLocation(); return <HelpDocPage section={s} />; }
export function HelpIndex() { const s = HELP_SECTIONS[3]!; useLocation(); return <HelpDocPage section={s} />; }
