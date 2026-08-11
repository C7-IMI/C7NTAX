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
  Cancelled = "cancelled",
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
    key: "admin", label: "Administration",
    permissions: [Permission.UserManage, Permission.RoleManage, Permission.SystemConfig],
  },
];

/** Default role → permission mapping */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SystemRole.SuperAdmin]: Object.values(Permission),
  [SystemRole.Admin]: Object.values(Permission),
  [SystemRole.Manager]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign, Permission.TicketClose, Permission.TicketDelete,
    Permission.BoardView, Permission.BoardManage,
    Permission.ClientView, Permission.ClientCreate, Permission.ClientEdit,
    Permission.ContactView, Permission.ContactCreate, Permission.ContactEdit,
    Permission.OpportunityView, Permission.OpportunityCreate, Permission.OpportunityEdit,
    Permission.ProjectView, Permission.ProjectCreate, Permission.ProjectEdit, Permission.ProjectManage,
    Permission.BillingView, Permission.BillingManage, Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.PaymentView, Permission.PaymentProcess,
    Permission.ServiceAgreementView, Permission.ServiceAgreementManage,
    Permission.AssetView, Permission.AssetCreate, Permission.AssetEdit,
    Permission.ProcurementView, Permission.ProcurementCreate,
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
  ],
  [SystemRole.Technician]: [
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit,
    Permission.TicketViewAll, Permission.TicketClose,
    Permission.BoardView,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.AssetView,
    Permission.KBView,
    Permission.ScheduleView,
    Permission.ChatView,
    Permission.ReportView,
    Permission.IntegrationView,
    Permission.InferenceView,
  ],
  [SystemRole.Dispatcher]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign, Permission.TicketClose,
    Permission.BoardView, Permission.BoardManage,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.ScheduleView, Permission.ScheduleManage,
    Permission.ChatView,
    Permission.ReportView,
  ],
  [SystemRole.BillingManager]: [
    Permission.BillingView, Permission.BillingManage,
    Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.PaymentView, Permission.PaymentProcess,
    Permission.ServiceAgreementView, Permission.ServiceAgreementManage,
    Permission.ClientView, Permission.ContactView,
    Permission.ReportView, Permission.ReportExport, Permission.ReportCreate,
    Permission.ContractView, Permission.ContractCreate, Permission.ContractEdit,
    Permission.ProcurementView,
  ],
  [SystemRole.ClientAdmin]: [
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit, Permission.TicketClose,
    Permission.BoardView,
    Permission.ClientView, Permission.ContactView,
    Permission.ProjectView,
    Permission.BillingView,
    Permission.AssetView,
    Permission.KBView,
    Permission.ScheduleView,
    Permission.ChatView,
    Permission.ReportView,
    Permission.PTOView, Permission.PTORequest,
  ],
  [SystemRole.ClientUser]: [
    Permission.TicketView, Permission.TicketCreate,
    Permission.BoardView,
    Permission.ClientView,
    Permission.KBView,
    Permission.ChatView,
    Permission.BillingView,
  ],
  [SystemRole.ReadOnly]: [
    Permission.TicketView, Permission.BoardView, Permission.ClientView,
    Permission.ContactView, Permission.BillingView, Permission.ReportView,
    Permission.ProjectView, Permission.AssetView, Permission.KBView,
    Permission.ScheduleView, Permission.ChatView,
  ],
};

/** Ticket auto-close default days */
export const DEFAULT_AUTO_CLOSE_DAYS = 14;

/** Email follow-up interval defaults */
export const DEFAULT_FOLLOW_UP_INTERVAL_HOURS = 24;
