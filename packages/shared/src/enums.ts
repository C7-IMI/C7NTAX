// ─── Core Enums & Constants ───────────────────────────────────────────

/** Ticket statuses matching AutoTask PSA workflow */
export enum TicketStatus {
  New = "new",
  InProgress = "in_progress",
  WaitingOnClient = "waiting_on_client",
  WaitingOnThirdParty = "waiting_on_third_party",
  OnHold = "on_hold",
  PendingApproval = "pending_approval",
  Resolved = "resolved",
  Closed = "closed",
  /**
   * The client answered a ticket that had been closed, and it is back in the queue.
   *
   * A status of its own rather than a return to `in_progress`: the difference between work that was
   * never finished and work that was declared finished and came back is the thing anybody reading a
   * queue wants to know, and folding the two together hides exactly the tickets that were closed too
   * early.
   */
  CustomerReopened = "customer_reopened",
  Cancelled = "cancelled",
}

/**
 * The statuses that mean the ticket is finished with — the ones a client reply brings back.
 *
 * Resolved counts as settled even though it is not closed: a client reading an email that says the
 * work is done is replying to the same finished conversation, and waiting for a separate "closed"
 * would mean the reply either silently vanishes or raises a duplicate ticket.
 */
export const SETTLED_TICKET_STATUSES: readonly string[] = [
  TicketStatus.Resolved,
  TicketStatus.Closed,
  TicketStatus.Cancelled,
];

/** Whether `status` is one a client reply should reopen. */
export function isSettledTicketStatus(status: string | null | undefined): boolean {
  return !!status && SETTLED_TICKET_STATUSES.includes(status);
}

/** Ticket priority levels */
export enum TicketPriority {
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}

/** Ticket source channels */
export enum TicketSource {
  Phone = "phone",
  Email = "email",
  Portal = "portal",
  Chat = "chat",
  Monitoring = "monitoring",
  WalkIn = "walk_in",
  Api = "api",
  Internal = "internal",
}

/** Billing / invoice statuses */
export enum InvoiceStatus {
  Draft = "draft",
  Sent = "sent",
  Partial = "partial",
  Paid = "paid",
  Overdue = "overdue",
  Void = "void",
  Collections = "collections",
}

/** Service agreement billing periods */
export enum BillingPeriod {
  OneTime = "one_time",
  Weekly = "weekly",
  Monthly = "monthly",
  Quarterly = "quarterly",
  SemiAnnually = "semi_annually",
  Annually = "annually",
}

/** User roles for RBAC */
export enum SystemRole {
  SuperAdmin = "super_admin",
  Admin = "admin",
  Manager = "manager",
  Technician = "technician",
  Dispatcher = "dispatcher",
  BillingManager = "billing_manager",
  ClientAdmin = "client_admin",
  ClientUser = "client_user",
  ReadOnly = "read_only",
  /**
   * A role that is a Super Admin **plus** the Developer section.
   *
   * It exists as its own system role rather than an extra permission on Super Admin because the
   * developer surface is not a widening of administration — it is the ability to take the instance
   * apart — and the person who holds it should be visible in Users & Roles as somebody who does.
   */
  DeveloperAdmin = "developer_admin",
}

/** Detailed permission keys — each maps to a discrete action */
export enum Permission {
  // ── Tickets ──
  TicketView = "ticket:view",
  TicketCreate = "ticket:create",
  TicketEdit = "ticket:edit",
  TicketDelete = "ticket:delete",
  TicketAssign = "ticket:assign",
  TicketClose = "ticket:close",
  TicketViewAll = "ticket:view_all",

  // ── Service Boards ──
  BoardView = "board:view",
  BoardManage = "board:manage",

  // ── Service Alerts ──
  ServiceAlertView = "servicealert:view",
  ServiceAlertManage = "servicealert:manage",

  // ── Clients / CRM ──
  ClientView = "client:view",
  ClientCreate = "client:create",
  ClientEdit = "client:edit",
  ClientDelete = "client:delete",
  ContactView = "contact:view",
  ContactCreate = "contact:create",
  ContactEdit = "contact:edit",
  ContactDelete = "contact:delete",

  // ── Billing ──
  BillingView = "billing:view",
  BillingManage = "billing:manage",
  InvoiceCreate = "invoice:create",
  InvoiceSend = "invoice:send",
  PaymentView = "payment:view",
  PaymentProcess = "payment:process",
  ServiceAgreementView = "agreement:view",
  ServiceAgreementManage = "agreement:manage",

  // ── Projects ──
  ProjectView = "project:view",
  ProjectCreate = "project:create",
  ProjectEdit = "project:edit",
  ProjectDelete = "project:delete",
  ProjectManage = "project:manage",

  // ── Assets / Inventory ──
  AssetView = "asset:view",
  AssetCreate = "asset:create",
  AssetEdit = "asset:edit",
  AssetDelete = "asset:delete",

  // ── Procurement ──
  ProcurementView = "procurement:view",
  ProcurementCreate = "procurement:create",
  ProcurementApprove = "procurement:approve",

  // ── Product catalog ──
  ProductView = "product:view",
  ProductCreate = "product:create",
  ProductEdit = "product:edit",
  ProductDelete = "product:delete",
  /// Cost, margin, price changes and stock adjustments — the commercial half of the catalog.
  ProductManage = "product:manage",

  // ── Knowledge Base ──
  KBView = "kb:view",
  KBCreate = "kb:create",
  KBEdit = "kb:edit",
  KBDelete = "kb:delete",
  KBManage = "kb:manage",

  // ── Opportunities / Pipeline ──
  OpportunityView = "opportunity:view",
  OpportunityCreate = "opportunity:create",
  OpportunityEdit = "opportunity:edit",
  OpportunityDelete = "opportunity:delete",

  // ── Reports ──
  ReportView = "report:view",
  ReportExport = "report:export",
  ReportCreate = "report:create",

  // ── Integrations ──
  IntegrationView = "integration:view",
  IntegrationManage = "integration:manage",

  // ── Admin ──
  UserManage = "user:manage",
  RoleManage = "role:manage",
  SystemConfig = "system:config",

  // ── Schedule / Calendar ──
  ScheduleView = "schedule:view",
  ScheduleManage = "schedule:manage",

  // ── Contracts ──
  ContractView = "contract:view",
  ContractCreate = "contract:create",
  ContractEdit = "contract:edit",
  ContractDelete = "contract:delete",

  // ── Surveys ──
  SurveyView = "survey:view",
  SurveyCreate = "survey:create",
  SurveyManage = "survey:manage",

  // ── Chat ──
  ChatView = "chat:view",
  ChatManage = "chat:manage",

  // ── Workflows / Automations ──
  WorkflowView = "workflow:view",
  WorkflowCreate = "workflow:create",
  WorkflowEdit = "workflow:edit",
  WorkflowDelete = "workflow:delete",
  WorkflowManage = "workflow:manage",

  // ── PTO / Time Off ──
  PTOView = "pto:view",
  PTORequest = "pto:request",
  PTOApprove = "pto:approve",

  // ── Security / MFA ──
  SecurityManage = "security:manage",
  MFAEnforce = "mfa:enforce",

  /*
   * ── Instance — the Super-Admin tier ──
   *
   * These three are separated from everything else because their blast radius is the **whole
   * deployment** rather than a record: one wrong value locks every account out, weakens every account,
   * or overwrites state nobody can recover. See `SUPER_ADMIN_ONLY` for the rule and why the tier has to
   * exist at all.
   *
   * The split inside the tier is by *kind of decision*, not by audience — one role holds all three
   * today. It is by kind because the reason each is protected is different, and the reason is what a
   * reviewer needs to read: `InstanceSecurity` is about who may get in, `InstanceConfig` about what the
   * application is for everybody, `InstanceMaintenance` about operations that pause, force or destroy.
   */
  InstanceSecurity = "instance:security",
  InstanceConfig = "instance:config",
  InstanceMaintenance = "instance:maintenance",

  // ── Inference / AI ──
  InferenceView = "inference:view",
  InferenceManage = "inference:manage",

  // ── Kumo / IT Documentation ──
  KumoView = "kumo:view",
  KumoManage = "kumo:manage",
  KumoViewAll = "kumo:view_all",
  KumoAssetView = "kumo:asset:view",
  KumoAssetCreate = "kumo:asset:create",
  KumoAssetEdit = "kumo:asset:edit",
  KumoAssetDelete = "kumo:asset:delete",
  KumoAssetManageTemplates = "kumo:asset:template:manage",
  KumoPasswordsView = "kumo:passwords:view",
  KumoPasswordsCreate = "kumo:passwords:create",
  KumoPasswordsEdit = "kumo:passwords:edit",
  KumoPasswordsDelete = "kumo:passwords:delete",
  KumoPasswordsReveal = "kumo:passwords:reveal",
  KumoConfigView = "kumo:config:view",
  KumoConfigCreate = "kumo:config:create",
  KumoConfigEdit = "kumo:config:edit",
  KumoConfigDelete = "kumo:config:delete",
  KumoDocumentView = "kumo:doc:view",
  KumoDocumentCreate = "kumo:doc:create",
  KumoDocumentEdit = "kumo:doc:edit",
  KumoDocumentDelete = "kumo:doc:delete",
  KumoDocumentPublish = "kumo:doc:publish",
  KumoLinkView = "kumo:link:view",
  KumoLinkManage = "kumo:link:manage",
  /**
   * The console (PLAN-028). A **capability**, not a widening: every command it offers runs an existing
   * route under the same permissions, so this grants no operation anybody could not already perform in
   * the application. What it controls is *reach* — whether this person gets a command surface at all —
   * which is why it is the one permission that decides whether a control is drawn rather than whether a
   * request succeeds. Internal staff roles hold it; the client-facing and read-only roles do not.
   */
  ConsoleUse = "console:use",

  /**
   * The Email Studio — seeing and controlling what this instance sends.
   *
   * `email:view` opens the Studio (the message list, the editor, the preview, the delivery log);
   * `email:manage` may change a template, the brand kit or the delivery rules. Separate for the same
   * reason `report:view` and `report:create` are: reading what a customer will receive is a different
   * decision from deciding it, and the person who checks the wording of an invoice is often not the
   * person who owns it.
   */
  EmailView = "email:view",
  EmailManage = "email:manage",

  /**
   * Branding — whose paper this is.
   *
   * `branding:view` opens the settings and their previews; `branding:manage` changes the logo, the
   * icon, the colours, the letterhead and what a printed page wears. Separate for the reason the other
   * pairs are: knowing what the company's letterhead looks like is not the same decision as owning it,
   * and the logo on a document a client keeps is worth a deliberate grant rather than an inherited one.
   *
   * Deliberately **not** a Developer capability. An instance is expected to be branded before it goes
   * live, so an ordinary administrator who cannot set the company's own logo would be unable to do the
   * setup the product assumes — withholding this from Admin would break the common case to guard
   * nothing.
   */
  BrandingView = "branding:view",
  BrandingManage = "branding:manage",

  /**
   * The Developer section — the surface for changes that are not normally available, including the
   * purge that empties the instance of its data.
   *
   * A **capability** in the same sense as `console:use`: it decides whether the section is drawn at
   * all, in the navigation, in the command palette, behind a typed URL and in the Help. What makes it
   * different is who holds it. Everything else in this list widens what somebody may do *inside* the
   * application; these two can remove its contents, so they are held by exactly two roles — **Super
   * Admin**, the break-glass role that sees everything, and **Developer Admin**, a role that can run
   * the section but cannot administer it — and are deliberately subtracted from **Admin**. An ordinary
   * administrator therefore has no Developer rail row, no Developer permission to tick, no Developer
   * page at `/developer` and no Developer walkthrough to read: hidden rather than unarmed.
   */
  DeveloperView = "developer:view",
  /**
   * May run the section's destructive operations: the purge and the danger zone behind it.
   *
   * Separate from `DeveloperView` because looking and destroying are different decisions — a role can
   * be trusted with the environment inspector and the deployment checklist without being trusted to
   * empty the database.
   */
  DeveloperPurge = "developer:purge",
}

/** Permission categories for UI grouping — order matters */
export const PERMISSION_CATEGORIES: { key: string; label: string; permissions: Permission[] }[] = [
  {
    key: "tickets", label: "Tickets",
    permissions: [Permission.TicketView, Permission.TicketViewAll, Permission.TicketCreate, Permission.TicketEdit, Permission.TicketDelete, Permission.TicketAssign, Permission.TicketClose],
  },
  {
    key: "boards", label: "Service Boards",
    permissions: [Permission.BoardView, Permission.BoardManage],
  },
  {
    key: "servicealerts", label: "Service Alerts",
    permissions: [Permission.ServiceAlertView, Permission.ServiceAlertManage],
  },
  {
    key: "clients", label: "Clients & CRM",
    permissions: [Permission.ClientView, Permission.ClientCreate, Permission.ClientEdit, Permission.ClientDelete, Permission.ContactView, Permission.ContactCreate, Permission.ContactEdit, Permission.ContactDelete],
  },
  {
    key: "opportunities", label: "Opportunities",
    permissions: [Permission.OpportunityView, Permission.OpportunityCreate, Permission.OpportunityEdit, Permission.OpportunityDelete],
  },
  {
    key: "projects", label: "Projects",
    permissions: [Permission.ProjectView, Permission.ProjectCreate, Permission.ProjectEdit, Permission.ProjectDelete, Permission.ProjectManage],
  },
  {
    key: "billing", label: "Billing",
    permissions: [Permission.BillingView, Permission.BillingManage, Permission.InvoiceCreate, Permission.InvoiceSend, Permission.PaymentView, Permission.PaymentProcess, Permission.ServiceAgreementView, Permission.ServiceAgreementManage],
  },
  {
    key: "assets", label: "Assets & Inventory",
    permissions: [Permission.AssetView, Permission.AssetCreate, Permission.AssetEdit, Permission.AssetDelete],
  },
  {
    key: "procurement", label: "Procurement",
    permissions: [Permission.ProcurementView, Permission.ProcurementCreate, Permission.ProcurementApprove],
  },
  {
    key: "products", label: "Product Catalog",
    permissions: [Permission.ProductView, Permission.ProductCreate, Permission.ProductEdit, Permission.ProductDelete, Permission.ProductManage],
  },
  {
    key: "kb", label: "Knowledge Base",
    permissions: [Permission.KBView, Permission.KBCreate, Permission.KBEdit, Permission.KBDelete, Permission.KBManage],
  },
  {
    key: "schedule", label: "Schedule & Calendar",
    permissions: [Permission.ScheduleView, Permission.ScheduleManage],
  },
  {
    key: "contracts", label: "Contracts",
    permissions: [Permission.ContractView, Permission.ContractCreate, Permission.ContractEdit, Permission.ContractDelete],
  },
  {
    key: "surveys", label: "Surveys",
    permissions: [Permission.SurveyView, Permission.SurveyCreate, Permission.SurveyManage],
  },
  {
    key: "chat", label: "Chat & Messaging",
    permissions: [Permission.ChatView, Permission.ChatManage],
  },
  {
    key: "workflows", label: "Workflows & Automations",
    permissions: [Permission.WorkflowView, Permission.WorkflowCreate, Permission.WorkflowEdit, Permission.WorkflowDelete, Permission.WorkflowManage],
  },
  {
    key: "reports", label: "Reports & Analytics",
    permissions: [Permission.ReportView, Permission.ReportExport, Permission.ReportCreate],
  },
  {
    key: "integrations", label: "Integrations",
    permissions: [Permission.IntegrationView, Permission.IntegrationManage],
  },
  {
    key: "pto", label: "PTO & Time Off",
    permissions: [Permission.PTOView, Permission.PTORequest, Permission.PTOApprove],
  },
  {
    key: "inference", label: "AI & Inference",
    permissions: [Permission.InferenceView, Permission.InferenceManage],
  },
  {
    key: "security", label: "Security & MFA",
    permissions: [Permission.SecurityManage, Permission.MFAEnforce],
  },
  {
    key: "kumo", label: "Kumo IT Documentation",
    permissions: [
      Permission.KumoView, Permission.KumoManage, Permission.KumoViewAll,
      Permission.KumoAssetView, Permission.KumoAssetCreate, Permission.KumoAssetEdit, Permission.KumoAssetDelete, Permission.KumoAssetManageTemplates,
      Permission.KumoPasswordsView, Permission.KumoPasswordsCreate, Permission.KumoPasswordsEdit, Permission.KumoPasswordsDelete, Permission.KumoPasswordsReveal,
      Permission.KumoConfigView, Permission.KumoConfigCreate, Permission.KumoConfigEdit, Permission.KumoConfigDelete,
      Permission.KumoDocumentView, Permission.KumoDocumentCreate, Permission.KumoDocumentEdit, Permission.KumoDocumentDelete, Permission.KumoDocumentPublish,
      Permission.KumoLinkView, Permission.KumoLinkManage,
    ],
  },
  {
    key: "instance", label: "Instance (Super Admin only)",
    permissions: [Permission.InstanceSecurity, Permission.InstanceConfig, Permission.InstanceMaintenance],
  },
  {
    key: "admin", label: "Administration",
    permissions: [Permission.UserManage, Permission.RoleManage, Permission.SystemConfig],
  },
  {
    /*
     * Its own category rather than a line under Administration: the console is a *working surface* an
     * administrator decides who gets, not an administrative right. Grouping it here also means the
     * permission pickers show it as one sentence — "may this person use the console?" — instead of
     * hiding it among the settings permissions it has nothing to do with.
     */
    key: "console", label: "Console",
    permissions: [Permission.ConsoleUse],
  },
  {
    /*
     * Its own category, and the one the Developer section is gated on: this is the switch that decides
     * whether the section appears in the navigation for a role. Two entries rather than one because
     * looking and destroying are different decisions — a role may be trusted with the deployment
     * checklist and the environment inspector without being trusted to empty the database.
     */
    key: "developer", label: "Developer",
    permissions: [Permission.DeveloperView, Permission.DeveloperPurge],
  },
  {
    /*
     * Its own category because the Studio is a surface in its own right — the words on every message
     * this system sends, including the ones a customer reads — rather than a line under
     * Administration's settings.
     */
    key: "email", label: "Email",
    permissions: [Permission.EmailView, Permission.EmailManage],
  },
  /*
   * Its own category because it is neither an email setting nor a report setting: it is the identity
   * every document and every message inherits — the logo, the letterhead, the colours and the footer —
   * and the pages that own it sit in the Branding section rather than under either.
   */
  { key: "branding", label: "Branding", permissions: [Permission.BrandingView, Permission.BrandingManage] },
];

/**
 * The permissions that only a Super Admin and the Developer Admin role hold.
 *
 * Named here rather than written twice, because they are subtracted from the Admin blanket grant and
 * added to exactly two roles — and a permission added to the developer surface later must not silently
 * be inherited by everybody who can administer the instance.
 *
 * **Super Admin keeps them; Admin does not.** That asymmetry is the decision in this section. A Super
 * Admin is the break-glass role and sees everything, including the Developer section and the
 * administration of the Developer Admin role itself. Every other kind of administrator — Admin, Client
 * Admin, Manager, and anybody else — sees no Developer rail row, no Developer permission in a picker,
 * no Developer page behind a typed URL and no Developer walkthrough in the Help. Read the note on
 * `DeveloperView` for the reasoning.
 */
const DEVELOPER_PERMISSIONS: Permission[] = [Permission.DeveloperView, Permission.DeveloperPurge];

/**
 * The permissions only a Super Admin may hold.
 *
 * **Why this exists.** `Admin` and `Super Admin` used to differ by two developer permissions and
 * nothing else, which meant an ordinary administrator could turn multi-factor authentication on *and
 * enforce it* for the whole instance, raise the session ceiling, switch authentication hardening off,
 * enable the test-bypass exemption, change what every client sees in the portal, or pause the
 * instance's background workers. Those are all decisions about the deployment itself — an operator's
 * decisions — and an administrator is a tier below that, not equal to it.
 *
 * **What it is not.** This is not "administrators are untrusted": everything an administrator needs to
 * do their job stays theirs. Crucially, the per-account half of multi-factor authentication stays with
 * `mfa:enforce` and `security:manage`, because an administrator resetting one person's second factor is
 * ordinary support, while deciding that *everybody* must have one is policy.
 *
 * **The rule that has to hold.** A non-Super-Admin must not be able to grant one of these — not to
 * themselves, not to a role they are building, and not through an API key. That is enforced in three
 * places rather than one, because hiding a permission in a picker is presentation and not a control:
 *
 *   1. here, so `Admin` does not hold them (and a stored role row that lists one does not either);
 *   2. `computePermissions` subtracts them for any role that is not Super Admin or Developer Admin, so
 *      a stored permission list cannot smuggle one in;
 *   3. the user and role editors omit them from the grantable catalogue *and* their route handlers
 *      refuse them by name, so a request that never went through the picker is refused too.
 *
 * An API key needs no special case: a key's scopes are intersected with its owner's permissions on
 * every request, so once its owner does not hold a tier permission the key cannot carry it.
 */
export const SUPER_ADMIN_ONLY: Permission[] = [
  Permission.InstanceSecurity,
  Permission.InstanceConfig,
  Permission.InstanceMaintenance,
];

/** Whether holding this permission is reserved to the Super Admin tier. */
export function isSuperAdminOnly(permission: Permission): boolean {
  return SUPER_ADMIN_ONLY.includes(permission);
}

/** Default role → permission mapping */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  /*
   * Super Admin and Admin are **not** the same thing here, and this is the one place in the product
   * where they are deliberately different. A Super Admin holds everything: the developer surface *and*
   * the instance tier. **Admin** holds everything except both — so it is a real tier below, not an
   * alias. The Developer section is invisible to an ordinary administrator (no rail row, no permission
   * in a picker, no route behind a typed URL), and the switches that decide what the whole deployment
   * does are not his to throw.
   *
   * `Developer Admin` deliberately still holds everything, instance tier included. It is the role that
   * can operate the developer surface, it already held every instance switch before this tier existed,
   * and narrowing it here would be a change nobody asked for. If it should be narrowed, that is a
   * separate decision about that role rather than a consequence of this one.
   */
  [SystemRole.SuperAdmin]: Object.values(Permission),
  [SystemRole.Admin]: Object.values(Permission).filter(
    p => !DEVELOPER_PERMISSIONS.includes(p) && !SUPER_ADMIN_ONLY.includes(p),
  ),
  [SystemRole.DeveloperAdmin]: Object.values(Permission),
  [SystemRole.Manager]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign, Permission.TicketClose, Permission.TicketDelete,
    Permission.BoardView, Permission.BoardManage,
    Permission.ServiceAlertView, Permission.ServiceAlertManage,
    Permission.ClientView, Permission.ClientCreate, Permission.ClientEdit,
    Permission.ContactView, Permission.ContactCreate, Permission.ContactEdit,
    Permission.OpportunityView, Permission.OpportunityCreate, Permission.OpportunityEdit,
    Permission.ProjectView, Permission.ProjectCreate, Permission.ProjectEdit, Permission.ProjectManage,
    Permission.BillingView, Permission.BillingManage, Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.PaymentView, Permission.PaymentProcess,
    Permission.ServiceAgreementView, Permission.ServiceAgreementManage,
    Permission.AssetView, Permission.AssetCreate, Permission.AssetEdit,
    Permission.ProcurementView, Permission.ProcurementCreate,
    Permission.ProductView, Permission.ProductCreate, Permission.ProductEdit, Permission.ProductManage,
    Permission.KBView, Permission.KBCreate, Permission.KBEdit,
    Permission.ScheduleView, Permission.ScheduleManage,
    Permission.ContractView, Permission.ContractCreate, Permission.ContractEdit,
    Permission.SurveyView, Permission.SurveyCreate,
    Permission.ChatView, Permission.ChatManage,
    Permission.WorkflowView, Permission.WorkflowCreate, Permission.WorkflowEdit,
    Permission.ReportView, Permission.ReportExport, Permission.ReportCreate,
    Permission.IntegrationView, Permission.IntegrationManage,
    Permission.PTOView, Permission.PTORequest, Permission.PTOApprove,
    Permission.InferenceView,
    Permission.UserManage,
    // Staff get the console; see the note on `ConsoleUse` for why it is a capability and not a widening.
    Permission.ConsoleUse,
    // A manager runs the desk and answers for what customers received, so they may read the Studio and
    // the delivery log. Changing the words is `email:manage`, which they do not hold.
    Permission.EmailView,
  ],
  [SystemRole.Technician]: [
    // Deliberately no TicketViewAll: internal technicians already see every ticket
    // because they carry no companyId, while a technician scoped to one client must
    // not see the rest. Granting it here would silently widen that case.
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit,
    Permission.TicketClose,
    Permission.BoardView,
    Permission.ServiceAlertView,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.AssetView,
    Permission.ProductView,
    Permission.KBView,
    Permission.ScheduleView,
    Permission.ChatView,
    Permission.ReportView,
    Permission.IntegrationView,
    Permission.InferenceView,
    Permission.ConsoleUse,
  ],
  [SystemRole.Dispatcher]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign, Permission.TicketClose,
    Permission.BoardView, Permission.BoardManage,
    Permission.ServiceAlertView,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.ProductView,
    Permission.ScheduleView, Permission.ScheduleManage,
    Permission.ChatView,
    Permission.ReportView,
    Permission.ConsoleUse,
  ],
  [SystemRole.BillingManager]: [
    Permission.BillingView, Permission.BillingManage,
    Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.PaymentView, Permission.PaymentProcess,
    Permission.ServiceAgreementView, Permission.ServiceAgreementManage,
    Permission.ClientView, Permission.ContactView,
    Permission.ServiceAlertView,
    Permission.ReportView, Permission.ReportExport, Permission.ReportCreate,
    Permission.ContractView, Permission.ContractCreate, Permission.ContractEdit,
    Permission.ProcurementView,
    // Billing reads the catalog to price and invoice; it does not maintain it.
    Permission.ProductView,
    // Billing owns the invoice notices, so it may read what the Studio will send — and see the
    // delivery log when a customer says the invoice never arrived. Wording stays with EmailManage.
    Permission.EmailView,
  ],
  [SystemRole.ClientAdmin]: [
    // A client-facing role: no internal chat and no internal HR surfaces. Everything
    // else it holds is data about its own company (scoping is enforced server-side).
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit, Permission.TicketClose,
    Permission.BoardView,
    Permission.ServiceAlertView,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.BillingView,
    Permission.AssetView,
    Permission.KBView,
    Permission.ScheduleView,
    Permission.ReportView,
  ],
  [SystemRole.ClientUser]: [
    // Client-facing, like ClientAdmin: no internal chat.
    Permission.TicketView, Permission.TicketCreate,
    Permission.BoardView,
    Permission.ServiceAlertView,
    Permission.ClientView,
    Permission.KBView,
    Permission.BillingView,
  ],
  [SystemRole.ReadOnly]: [
    Permission.TicketView, Permission.BoardView, Permission.ClientView,
    Permission.ServiceAlertView,
    Permission.ContactView, Permission.BillingView, Permission.ReportView,
    Permission.ProjectView, Permission.AssetView, Permission.KBView,
    Permission.ScheduleView, Permission.ChatView,
    Permission.ProductView,
  ],
};

/** Ticket auto-close default days */
export const DEFAULT_AUTO_CLOSE_DAYS = 14;

/** Email follow-up interval defaults */
export const DEFAULT_FOLLOW_UP_INTERVAL_HOURS = 24;
