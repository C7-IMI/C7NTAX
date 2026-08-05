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
  // Tickets
  TicketView = "ticket:view",
  TicketCreate = "ticket:create",
  TicketEdit = "ticket:edit",
  TicketDelete = "ticket:delete",
  TicketAssign = "ticket:assign",
  TicketClose = "ticket:close",
  TicketViewAll = "ticket:view_all", // override company scope

  // Service Boards
  BoardView = "board:view",
  BoardManage = "board:manage",

  // Clients / CRM
  ClientView = "client:view",
  ClientCreate = "client:create",
  ClientEdit = "client:edit",
  ClientDelete = "client:delete",

  // Billing
  BillingView = "billing:view",
  BillingManage = "billing:manage",
  InvoiceCreate = "invoice:create",
  InvoiceSend = "invoice:send",

  // Admin
  UserManage = "user:manage",
  RoleManage = "role:manage",
  SystemConfig = "system:config",

  // Integrations
  IntegrationView = "integration:view",
  IntegrationManage = "integration:manage",

  // Reports
  ReportView = "report:view",
  ReportExport = "report:export",
}

/** Default role → permission mapping */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SystemRole.Admin]: Object.values(Permission),
  [SystemRole.Manager]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign, Permission.TicketClose,
    Permission.BoardView, Permission.BoardManage,
    Permission.ClientView, Permission.ClientCreate, Permission.ClientEdit,
    Permission.BillingView, Permission.BillingManage, Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.IntegrationView, Permission.IntegrationManage,
    Permission.ReportView, Permission.ReportExport,
    Permission.UserManage,
  ],
  [SystemRole.Technician]: [
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit,
    Permission.TicketViewAll,
    Permission.BoardView,
    Permission.ClientView,
    Permission.IntegrationView,
    Permission.ReportView,
  ],
  [SystemRole.Dispatcher]: [
    Permission.TicketViewAll, Permission.TicketView, Permission.TicketCreate,
    Permission.TicketEdit, Permission.TicketAssign,
    Permission.BoardView,
    Permission.ClientView,
    Permission.ReportView,
  ],
  [SystemRole.BillingManager]: [
    Permission.BillingView, Permission.BillingManage,
    Permission.InvoiceCreate, Permission.InvoiceSend,
    Permission.ClientView,
    Permission.ReportView, Permission.ReportExport,
  ],
  [SystemRole.ClientAdmin]: [
    Permission.TicketView, Permission.TicketCreate, Permission.TicketEdit, Permission.TicketClose,
    Permission.BoardView,
    Permission.ClientView,
    Permission.BillingView,
    Permission.ReportView,
  ],
  [SystemRole.ClientUser]: [
    Permission.TicketView, Permission.TicketCreate,
    Permission.BoardView,
    Permission.ClientView,
    Permission.BillingView,
  ],
  [SystemRole.ReadOnly]: [
    Permission.TicketView, Permission.BoardView, Permission.ClientView,
    Permission.BillingView, Permission.ReportView,
  ],
};

/** Ticket auto-close default days */
export const DEFAULT_AUTO_CLOSE_DAYS = 14;

/** Email follow-up interval defaults */
export const DEFAULT_FOLLOW_UP_INTERVAL_HOURS = 24;
