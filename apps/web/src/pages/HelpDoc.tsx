import { Link, useLocation } from "react-router-dom";
import { BookOpen, HelpCircle, Settings2, ListOrdered, ChevronRight, Lightbulb, AlertTriangle, Wrench } from "lucide-react";

// ── PSA-style documentation frame (structure modeled on Autotask / ConnectWise Asio / HaloPSA docs) ──
// Sections are grouped: "core" (the four Help subsections) and "walkthroughs" (step-by-step
// feature guides). Every feature walkthrough must be listed in the Index section and linked
// from related sections. MAINTENANCE RULE: whenever a feature is added, updated, changed, or
// removed, its walkthrough here and its Index rows must be updated in the same change.

export type HelpSection = {
  id: string;
  path: string;
  group: "core" | "walkthroughs";
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
  // ════════════════════════════ CORE ════════════════════════════
  {
    id: "getting-started", group: "core",
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
      { kind: "p", text: "Sign in with your email or username. If multi-factor authentication (MFA) is enabled for your account, complete the second step with your authenticator app or email code. SSO and passkey sign-in are available when your administrator has enabled them (see the MFA, SSO & Passkeys walkthrough)." },
      { kind: "steps", items: [
        "Sign in at the login page and complete MFA if prompted.",
        "Open My Account (top right) to review your profile.",
        "Choose your default landing page under Settings → Preferences.",
        "Browse the navigation pane to explore Dashboard, Tickets, Service Boards, Clients, Billing, and Kumo.",
      ] },
      { kind: "tip", text: "Press T anywhere outside a text field to jump straight to Tickets." },
      { kind: "h", text: "The core ticket workflow" },
      { kind: "p", text: "C7NTAX is built around the ticket lifecycle: create → triage → work → resolve → invoice." },
      { kind: "steps", items: [
        "Open Tickets and select New Ticket (or press T to open the list first).",
        "Pick the client, board, category, and priority. Priority is deduced automatically if you leave it unset.",
        "Add time entries as you work — billable entries flow into invoices (see Billing & Agreements walkthrough).",
        "Resolve the ticket when work is complete; follow-ups and auto-close rules are configured per board.",
      ] },
      { kind: "h", text: "Team & boards setup" },
      { kind: "p", text: "Administrators configure service boards, SLA policies, and team permissions under Administration → Service Boards." },
      { kind: "steps", items: [
        "Create a service board for each team or client group.",
        "Attach an email connector so inbound mail becomes tickets automatically (see Email-to-Ticket Setup walkthrough).",
        "Assign technicians via Users & Roles → Manage Users and Manage Roles.",
      ] },
      { kind: "note", text: "Board layouts, batch ticket actions, and keyboard shortcuts are covered in the UI Shortcuts & Batch Actions walkthrough." },
    ],
    related: [
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Billing & Agreements", to: "/help/walkthroughs/billing-agreements" },
      { label: "FAQ", to: "/help/faq" },
      { label: "Help Index", to: "/help/index" },
      { label: "Tickets", to: "/tickets" },
    ],
  },
  {
    id: "faq", group: "core",
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
      { kind: "p", text: "Q: How do I invoice unbilled ticket time? — A: Open the Finance Dashboard and use Generate draft invoice — a draft is created and time entries are linked." },
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
    id: "configuration", group: "core",
    path: "/help/configuration",
    title: "Configuration",
    description: "Reference for the settings, dialogs, and options available in C7NTAX.",
    anchors: [
      { id: "boards-config", label: "Service boards" },
      { id: "alerts-config", label: "Service alerts & uptime" },
      { id: "integrations-config", label: "CloudConnect connectors" },
      { id: "identity-config", label: "Identity: MFA, SSO, passkeys" },
      { id: "flags-config", label: "Feature flags" },
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
      { kind: "h", text: "Feature flags" },
      { kind: "table", headers: ["Flag", "Enables", "Default"], rows: [
        ["SSO_ENABLED", "OIDC SSO login", "off"],
        ["PASSKEY_ENABLED", "WebAuthn passkeys", "off"],
        ["UPTIME_MONITORS_ENABLED", "website/SSL/DNS checks", "off"],
        ["ALERT_WEBHOOKS_ENABLED", "Alert webhook endpoints", "off"],
        ["AI_ACTIONS_ENABLED", "Risk-classified AI actions", "off"],
        ["EMAIL_GRAPH_ENABLED", "M365 Graph mail transport", "off"],
        ["OUTLOOK_ADDIN_ENABLED", "Outlook add-in batch endpoint", "off"],
        ["PUSH_ENABLED", "Push device registration", "off"],
        ["BILLING_FROM_TICKETS_ENABLED", "Generate invoice from ticket time", "off"],
        ["AUTH_HARDENING_ENABLED", "15-min JWT + rehash-on-login", "off"],
      ] },
      { kind: "warn", text: "Flags default off. Enable per environment and verify the feature before broad rollout." },
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
    id: "index", group: "core",
    path: "/help/index",
    title: "Index",
    description: "Every help topic, walkthrough, and product area — grouped by feature set.",
    anchors: [
      { id: "getting-started-set", label: "Getting started & UI" },
      { id: "ticketing-set", label: "Ticketing & email" },
      { id: "billing-set", label: "Billing & agreements" },
      { id: "monitoring-set", label: "Monitoring & alerts" },
      { id: "integrations-set", label: "Integrations" },
      { id: "ai-set", label: "AI" },
      { id: "identity-set", label: "Identity & security" },
      { id: "kumo-set", label: "Kumo & knowledge" },
    ],
    blocks: [
      { kind: "h", text: "Getting started & UI" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["First login & profile", "/help/getting-started"],
        ["Core ticket workflow", "/help/getting-started"],
        ["Team & boards setup", "/help/getting-started"],
        ["Keyboard shortcuts & batch actions", "/help/walkthroughs/shortcuts"],
        ["Custom reports, PDF export & weekly scheduling", "/help/walkthroughs/custom-reports"],
      ] },
      { kind: "h", text: "Ticketing & email" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Email-to-Ticket Setup (IMAP / M365 Graph)", "/help/walkthroughs/email-tickets"],
        ["Outlook Add-in", "/help/walkthroughs/outlook-addin"],
        ["Batch ticket operations", "/help/walkthroughs/shortcuts"],
      ] },
      { kind: "h", text: "Billing & agreements" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Quotes & convert to invoice", "/help/walkthroughs/quotes-invoices"],
        ["Generate invoice from ticket time", "/help/walkthroughs/billing-agreements"],
        ["Agreement types, overtime & block-hour rules", "/help/walkthroughs/billing-agreements"],
      ] },
      { kind: "h", text: "Monitoring & alerts" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Service Alerts (RSS / DownDetector)", "/help/walkthroughs/service-alerts"],
        ["Uptime Monitors (website / SSL / DNS)", "/help/walkthroughs/uptime-monitors"],
        ["Alert Webhooks", "/help/walkthroughs/alert-webhooks"],
      ] },
      { kind: "h", text: "Integrations" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["CloudConnect connectors & QuickBooks", "/help/walkthroughs/cloudconnect"],
        ["Email connectors", "/help/walkthroughs/email-tickets"],
      ] },
      { kind: "h", text: "AI" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["AI Actions (risk-classified)", "/help/walkthroughs/ai-actions"],
      ] },
      { kind: "h", text: "Identity & security" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["MFA, SSO & Passkeys", "/help/walkthroughs/identity-security"],
        ["Feature flags", "/help/configuration"],
      ] },
      { kind: "h", text: "Kumo & knowledge" },
      { kind: "table", headers: ["Topic", "Where"], rows: [
        ["Kumo: passwords, documents & audit", "/help/walkthroughs/kumo"],
        ["Knowledge Base", "/kb"],
      ] },
      { kind: "note", text: "MAINTENANCE RULE: whenever a feature is added, updated, changed, or removed, update its walkthrough and Index rows in the same change so documentation stays accurate." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "FAQ", to: "/help/faq" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "What's New", to: "/admin/changelog" },
    ],
  },

  // ════════════════════════════ WALKTHROUGHS ════════════════════════════
  {
    id: "email-tickets", group: "walkthroughs",
    path: "/help/walkthroughs/email-tickets",
    title: "Email-to-Ticket Setup (IMAP / M365 Graph)",
    description: "Configure monitored mailboxes so inbound email becomes tickets automatically.",
    anchors: [{ id: "imap-setup", label: "IMAP connector" }, { id: "graph-setup", label: "M365 Graph connector" }, { id: "usage", label: "Usage" }],
    blocks: [
      { kind: "h", text: "IMAP connector" },
      { kind: "steps", items: [
        "Open Administration → Service Boards → Email connectors.",
        "Select Add connector and pick the target service board.",
        "Enter the mailbox host, port (993), username, and password; folder defaults to INBOX.",
        "Set the poll interval (seconds) and save. Inbound mail is polled and deduplicated by Message-ID.",
      ] },
      { kind: "h", text: "M365 Graph connector" },
      { kind: "steps", items: [
        "Set EMAIL_GRAPH_ENABLED=true in the environment and restart the API.",
        "Create an app registration in Entra ID with Mail.Read and grant client credentials.",
        "Create a connector with Transport = graph, the mailbox address as user, Tenant ID, Client ID, and Client Secret.",
        "The runtime obtains a Graph token and polls unread messages in the configured folder.",
      ] },
      { kind: "note", text: "Both transports share the same dedup store, so switching a mailbox from IMAP to Graph will not re-create old tickets." },
      { kind: "h", text: "Usage" },
      { kind: "p", text: "New mail creates a ticket with priority deduced from content; replies update the original ticket by matching the conversation. Auto-replies are ignored." },
    ],
    related: [
      { label: "Outlook Add-in", to: "/help/walkthroughs/outlook-addin" },
      { label: "CloudConnect Integrations", to: "/help/walkthroughs/cloudconnect" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "quotes-invoices", group: "walkthroughs",
    path: "/help/walkthroughs/quotes-invoices",
    title: "Quotes & Convert to Invoice",
    description: "Create quotes from your service catalog and convert accepted quotes into draft invoices.",
    anchors: [{ id: "create-quote", label: "Create a quote" }, { id: "convert", label: "Convert to invoice" }],
    blocks: [
      { kind: "h", text: "Create a quote" },
      { kind: "steps", items: [
        "Open Quotes from the navigation.",
        "Enter the title, select the client, and add one or more line items (description, quantity, unit price).",
        "Save — the quote is created in draft status with totals computed.",
      ] },
      { kind: "h", text: "Convert to invoice" },
      { kind: "steps", items: [
        "Open the quote and select Convert to invoice.",
        "A draft invoice is created from the quote's line items with a new invoice number.",
        "Review the invoice under Billing → Invoices before sending.",
      ] },
      { kind: "tip", text: "Quotes never email clients automatically — conversion only creates a draft invoice." },
    ],
    related: [
      { label: "Billing & Agreements", to: "/help/walkthroughs/billing-agreements" },
      { label: "Help Index", to: "/help/index" },
      { label: "Billing", to: "/billing" },
    ],
  },
  {
    id: "billing-agreements", group: "walkthroughs",
    path: "/help/walkthroughs/billing-agreements",
    title: "Billing, Agreements & Overtime Rules",
    description: "Agreement types, bill-through billing, overtime, midnight splits, and block-hour deductions.",
    anchors: [{ id: "agreement-types", label: "Agreement types" }, { id: "time-rules", label: "Time rules" }, { id: "bill-through", label: "Generate from tickets" }],
    blocks: [
      { kind: "h", text: "Agreement types" },
      { kind: "table", headers: ["Type", "Behavior"], rows: [
        ["Block hours", "Prepaid hours; overtime deducts 1.5 block hours per 1 hour of overtime"],
        ["All-you-can-eat (Cyber Care)", "Flat coverage; no per-hour billing"],
        ["Variable hourly (spot)", "Per-hour rates: $100 / $250 / $275 / $400 tiers"],
      ] },
      { kind: "h", text: "Time rules" },
      { kind: "steps", items: [
        "Set TIME_RULES_ENABLED=true to activate the agreement/time engine.",
        "Entries ending after 6:00 PM are calculated at time-and-a-half (×1.5).",
        "Entries crossing midnight are split into two distinct entries linked by splitFrom.",
        "Block-hour agreements deduct 1.5 block hours for every 1 hour of overtime applied.",
      ] },
      { kind: "h", text: "Generate from tickets" },
      { kind: "steps", items: [
        "Open the Finance Dashboard.",
        "Enter the Company ID and select Generate draft invoice.",
        "Unbilled billable time entries become draft invoice line items and are linked to the invoice.",
      ] },
      { kind: "warn", text: "Generated invoices are drafts only — they are never emailed or synced until you send them." },
    ],
    related: [
      { label: "Quotes & Convert to Invoice", to: "/help/walkthroughs/quotes-invoices" },
      { label: "Help Index", to: "/help/index" },
      { label: "Finance Dashboard", to: "/billing/dashboard" },
    ],
  },
  {
    id: "uptime-monitors", group: "walkthroughs",
    path: "/help/walkthroughs/uptime-monitors",
    title: "Uptime Monitors (Website / SSL / DNS)",
    description: "Configure website, SSL-expiry, and DNS checks with alerting.",
    anchors: [{ id: "add-monitor", label: "Add a monitor" }, { id: "behavior", label: "Behavior" }],
    blocks: [
      { kind: "h", text: "Add a monitor" },
      { kind: "steps", items: [
        "Set UPTIME_MONITORS_ENABLED=true and restart the API.",
        "Open Service Alerts → Uptime Monitors.",
        "Enter a name, choose the kind (Website / SSL expiry / DNS), and enter the target URL.",
        "Website: set the expected status (default 200). SSL: set the warning threshold in days (default 30).",
        "Select Add monitor.",
      ] },
      { kind: "h", text: "Behavior" },
      { kind: "p", text: "Checks run on the 5-minute monitor tick. Failures open an active alert; alerts auto-resolve after two consecutive successful polls (anti-flap streak), mirroring the vendor feed rules." },
      { kind: "note", text: "Manual alerts are never auto-resolved by monitor checks." },
    ],
    related: [
      { label: "Service Alerts", to: "/help/walkthroughs/service-alerts" },
      { label: "Alert Webhooks", to: "/help/walkthroughs/alert-webhooks" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "service-alerts", group: "walkthroughs",
    path: "/help/walkthroughs/service-alerts",
    title: "Service Alerts & Outage Monitoring",
    description: "Monitor vendor status feeds (RSS + DownDetector) and track incidents.",
    anchors: [{ id: "add-service", label: "Add a monitored service" }, { id: "lifecycle", label: "Alert lifecycle" }],
    blocks: [
      { kind: "h", text: "Add a monitored service" },
      { kind: "steps", items: [
        "Open Service Alerts → Settings (Administration → Service Alerts).",
        "Add a service with its category, status page URL, DownDetector URL, and/or RSS feed URL.",
        "Keep monitorEnabled on and set a sort order.",
        "The monitor polls every 5 minutes and classifies outage/degraded vs restored keywords.",
      ] },
      { kind: "h", text: "Alert lifecycle" },
      { kind: "p", text: "Outage items open an active alert (severity outage or degraded). Auto-resolution requires two consecutive all-clear polls and a minimum alert age — a single transient fetch gap cannot flap an alert. Manual alerts are never auto-resolved." },
    ],
    related: [
      { label: "Uptime Monitors", to: "/help/walkthroughs/uptime-monitors" },
      { label: "Alert Webhooks", to: "/help/walkthroughs/alert-webhooks" },
      { label: "Help Index", to: "/help/index" },
      { label: "Service Alerts", to: "/service-alerts" },
    ],
  },
  {
    id: "alert-webhooks", group: "walkthroughs",
    path: "/help/walkthroughs/alert-webhooks",
    title: "Alert Webhooks",
    description: "Register webhook endpoints to receive alert events and inspect delivery logs.",
    anchors: [{ id: "register", label: "Register a webhook" }, { id: "deliveries", label: "Delivery log" }],
    blocks: [
      { kind: "h", text: "Register a webhook" },
      { kind: "steps", items: [
        "Set ALERT_WEBHOOKS_ENABLED=true and restart the API.",
        "Open Alert Webhooks (Administration → Webhooks).",
        "Enter a name and the endpoint URL; select Register.",
        "The webhook is subscribed to alert.opened and alert.resolved events.",
      ] },
      { kind: "h", text: "Delivery log" },
      { kind: "p", text: "Each delivery is recorded with event, status (pending/delivered/failed), and attempt count. Use the log to verify your receiver before wiring ticket automation." },
      { kind: "tip", text: "Pair webhooks with ticket automation so outages open tickets automatically." },
    ],
    related: [
      { label: "Service Alerts", to: "/help/walkthroughs/service-alerts" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "ai-actions", group: "walkthroughs",
    path: "/help/walkthroughs/ai-actions",
    title: "AI Actions (Risk-Classified)",
    description: "Propose, review, and audit AI-suggested actions with risk-tier controls.",
    anchors: [{ id: "tiers", label: "Risk tiers" }, { id: "decide", label: "Approve or reject" }],
    blocks: [
      { kind: "h", text: "Risk tiers" },
      { kind: "table", headers: ["Tier", "Behavior"], rows: [
        ["low / medium", "Execute on approval"],
        ["high", "Requires approval before execution"],
        ["critical", "Blocked automatically — cannot be approved"],
      ] },
      { kind: "h", text: "Approve or reject" },
      { kind: "steps", items: [
        "Set AI_ACTIONS_ENABLED=true and restart the API.",
        "Open AI Actions to see pending proposals with their risk tier and summary.",
        "Select Approve or Reject; high-risk actions stay in approved state until executed.",
        "Every decision and proposal is written to the audit trail.",
      ] },
    ],
    related: [
      { label: "Help Index", to: "/help/index" },
      { label: "Configuration", to: "/help/configuration" },
    ],
  },
  {
    id: "identity-security", group: "walkthroughs",
    path: "/help/walkthroughs/identity-security",
    title: "MFA, SSO & Passkeys",
    description: "Configure multi-factor authentication, OIDC single sign-on, and WebAuthn passkeys.",
    anchors: [{ id: "mfa", label: "MFA" }, { id: "sso", label: "SSO (OIDC)" }, { id: "passkeys", label: "Passkeys" }, { id: "hardening", label: "Hardening flag" }],
    blocks: [
      { kind: "h", text: "MFA" },
      { kind: "steps", items: [
        "Open MFA Setup from Settings and scan the QR code with your authenticator app.",
        "Enter the 6-digit code to verify; backup codes are provided.",
        "At login, complete MFA with the app code or the emailed code.",
      ] },
      { kind: "h", text: "SSO (OIDC)" },
      { kind: "steps", items: [
        "Set SSO_ENABLED=true and configure SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET, and SSO_REDIRECT_URI (defaults to the web origin callback).",
        "Restart the API; the login page shows a Sign in with SSO button when enabled.",
        "First-time SSO users are provisioned automatically with an admin role and verified email.",
        "Existing password/MFA login remains available as fallback.",
      ] },
      { kind: "h", text: "Passkeys" },
      { kind: "steps", items: [
        "Set PASSKEY_ENABLED=true and restart the API.",
        "Sign in with your password once, then register a passkey from the login page.",
        "Subsequent sign-ins use the passkey; the credential counter is updated on every assertion.",
      ] },
      { kind: "h", text: "Hardening flag" },
      { kind: "p", text: "AUTH_HARDENING_ENABLED switches JWTs to a 15-minute expiry and upgrades password hashes to bcrypt cost 12 on next login (rehash-on-login — no forced resets)." },
    ],
    related: [
      { label: "Configuration", to: "/help/configuration" },
      { label: "Help Index", to: "/help/index" },
      { label: "Settings", to: "/settings" },
    ],
  },
  {
    id: "outlook-addin", group: "walkthroughs",
    path: "/help/walkthroughs/outlook-addin",
    title: "Outlook Add-in",
    description: "Convert selected Outlook messages into C7NTAX tickets from the mailbox.",
    anchors: [{ id: "enable", label: "Enable & install" }, { id: "use", label: "Use" }],
    blocks: [
      { kind: "h", text: "Enable & install" },
      { kind: "steps", items: [
        "Set OUTLOOK_ADDIN_ENABLED=true and restart the API.",
        "Sideload the Office Web Add-in manifest (Administration → System → Outlook add-in asset).",
        "Sign in to the add-in with your C7NTAX credentials.",
      ] },
      { kind: "h", text: "Use" },
      { kind: "steps", items: [
        "Select one or more messages in Outlook.",
        "Choose Create tickets — one ticket per message.",
        "Duplicate messages are skipped using the Message-ID dedup store, so re-running the action never creates duplicates.",
      ] },
    ],
    related: [
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Help Index", to: "/help/index" },
    ],
  },
  {
    id: "cloudconnect", group: "walkthroughs",
    path: "/help/walkthroughs/cloudconnect",
    title: "CloudConnect Integrations",
    description: "Connect third-party services, test connections, and fix credentials inline.",
    anchors: [{ id: "connect", label: "Add a connector" }, { id: "test-fix", label: "Test & fix inline" }, { id: "quickbooks", label: "QuickBooks Online" }],
    blocks: [
      { kind: "h", text: "Add a connector" },
      { kind: "steps", items: [
        "Open CloudConnect.",
        "Pick a connector type (M365, Pax8, ITGlue, Proofpoint, Avanan, SentinelOne, QuickBooks, Flexpoint, and more).",
        "Enter the required credentials for that type and save.",
      ] },
      { kind: "h", text: "Test & fix inline" },
      { kind: "steps", items: [
        "Select Test Connection — field-level results appear in the dialog.",
        "Fix any failing fields in place and re-test without leaving the page.",
        "Connection status chips refresh live so broken integrations are visible immediately.",
      ] },
      { kind: "h", text: "QuickBooks Online" },
      { kind: "p", text: "QuickBooks uses Client ID, Client Secret, Realm ID, and Access Token. Enter all four, then test. Sync pushes invoices and payments through the billing flow." },
    ],
    related: [
      { label: "Email-to-Ticket Setup", to: "/help/walkthroughs/email-tickets" },
      { label: "Billing & Agreements", to: "/help/walkthroughs/billing-agreements" },
      { label: "Help Index", to: "/help/index" },
      { label: "CloudConnect", to: "/cloudconnect" },
    ],
  },
  {
    id: "kumo", group: "walkthroughs",
    path: "/help/walkthroughs/kumo",
    title: "Kumo: Passwords, Documents & Audit",
    description: "Store passwords and documents, and audit who changed what and when.",
    anchors: [{ id: "passwords", label: "Passwords" }, { id: "documents", label: "Documents & files" }, { id: "audit", label: "Audit trail" }],
    blocks: [
      { kind: "h", text: "Passwords" },
      { kind: "steps", items: [
        "Open Kumo → Passwords and select Add.",
        "Enter the credential details; values are stored AES-256 encrypted.",
        "Attach TOTP where available for rotating codes.",
      ] },
      { kind: "h", text: "Documents & files" },
      { kind: "steps", items: [
        "Open Kumo → Documents and select Upload.",
        "Choose the file (PDFs supported); it is stored and listed with metadata.",
        "Organize with folders and template fields for consistent SOPs.",
      ] },
      { kind: "h", text: "Audit trail" },
      { kind: "p", text: "Every Kumo item shows an audit log with the action, the user who made the change, and the last modified date." },
    ],
    related: [
      { label: "Help Index", to: "/help/index" },
      { label: "Kumo", to: "/kumo" },
      { label: "Knowledge Base", to: "/kb" },
    ],
  },
  {
    id: "custom-reports", group: "walkthroughs",
    path: "/help/walkthroughs/custom-reports",
    title: "Custom Reports & Scheduling",
    description: "Build custom reports, run them on demand, export dashboard PDFs, and schedule weekly deliveries.",
    anchors: [{ id: "create-report", label: "Create a report" }, { id: "run-report", label: "Run a report" }, { id: "export-schedule", label: "Export & schedule" }],
    blocks: [
      { kind: "h", text: "Create a report" },
      { kind: "steps", items: [
        "Open Reporting → Analytics → Custom Report Builder (or /reports/custom).",
        "Enter a name, pick a type (ticket_summary, revenue, or custom), and optionally a config JSON object.",
        "Select Create report — it appears in Your reports.",
      ] },
      { kind: "h", text: "Run a report" },
      { kind: "steps", items: [
        "In the report list, select Run.",
        "Results render in a table below (up to 500 rows for built-in types).",
      ] },
      { kind: "h", text: "Export & schedule" },
      { kind: "steps", items: [
        "Analytics → Quick Actions → Export Dashboard PDF downloads a summary PDF.",
        "Schedule Weekly Report opens a dialog: choose the report, day of week, time, and recipients (comma-separated), then Schedule.",
        "Schedules are stored per report and delivered in PDF format.",
      ] },
    ],
    related: [
      { label: "Help Index", to: "/help/index" },
      { label: "Configuration", to: "/help/configuration" },
      { label: "Reports", to: "/reports" },
      { label: "Custom Report Builder", to: "/reports/custom" },
    ],
  },
  {
    id: "shortcuts", group: "walkthroughs",
    path: "/help/walkthroughs/shortcuts",
    title: "UI Shortcuts & Batch Actions",
    description: "Keyboard shortcuts, batch ticket operations, and list conventions.",
    anchors: [{ id: "keys", label: "Keyboard shortcuts" }, { id: "batch", label: "Batch actions" }],
    blocks: [
      { kind: "h", text: "Keyboard shortcuts" },
      { kind: "table", headers: ["Key", "Action"], rows: [
        ["T", "Jump to Tickets (when not typing in a field)"],
      ] },
      { kind: "h", text: "Batch actions" },
      { kind: "steps", items: [
        "Open Tickets and tick the checkboxes on the left of the rows.",
        "Choose the batch action (acknowledge, close, and more) from the bulk bar.",
        "Confirm — results are applied to all selected tickets with a summary toast.",
      ] },
      { kind: "tip", text: "Lists use skeleton loaders while fetching; animations respect reduced-motion preferences." },
    ],
    related: [
      { label: "Getting Started", to: "/help/getting-started" },
      { label: "Help Index", to: "/help/index" },
      { label: "Tickets", to: "/tickets" },
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

function SectionIcon({ id }: { id: string }) {
  if (id === "getting-started") return <BookOpen size={14} />;
  if (id === "faq") return <HelpCircle size={14} />;
  if (id === "configuration") return <Settings2 size={14} />;
  if (id === "index") return <ListOrdered size={14} />;
  return <Wrench size={14} />;
}

function HelpDocPage({ section }: { section: HelpSection }) {
  const pageAnchors = section.blocks.filter((b): b is Extract<HelpBlock, { kind: "h" }> => b.kind === "h").map((h) => ({ id: slugify(h.text), label: h.text }));
  const core = HELP_SECTIONS.filter((s) => s.group === "core");
  const walkthroughs = HELP_SECTIONS.filter((s) => s.group === "walkthroughs");
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <aside className="lg:w-56 shrink-0">
        <div className="card p-3 sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Help sections</p>
          {core.map((s) => (
            <Link key={s.id} to={s.path} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${s.id === section.id ? "bg-cyber-600/20 text-cyber-400" : "text-gray-300 hover:text-white hover:bg-surface-lighter"}`}>
              <SectionIcon id={s.id} />{s.title}
            </Link>
          ))}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-2">Walkthroughs</p>
          {walkthroughs.map((s) => (
            <Link key={s.id} to={s.path} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${s.id === section.id ? "bg-cyber-600/20 text-cyber-400" : "text-gray-300 hover:text-white hover:bg-surface-lighter"}`}>
              <SectionIcon id={s.id} />{s.title}
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
export function HelpWalkthrough() {
  const { pathname } = useLocation();
  const s = HELP_SECTIONS.find((x) => x.path === pathname) || HELP_SECTIONS[0]!;
  return <HelpDocPage section={s} />;
}
