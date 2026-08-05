import { z } from "zod";

// ─── Live Chat ─────────────────────────────────────────────────────

export const chatSessionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active","waiting","closed"]).default("active"),
  companyId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  guestName: z.string().nullable(),
  guestEmail: z.string().email().nullable(),
  assignedToId: z.string().uuid().nullable(),
  ticketId: z.string().uuid().nullable(),
  startedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  senderType: z.enum(["user","technician","bot"]),
  senderId: z.string().uuid().nullable(),
  content: z.string().min(1),
  contentType: z.enum(["text","image","file","system"]).default("text"),
  isRead: z.boolean().default(false),
  createdAt: z.string().datetime(),
});

// ─── Workflow Rules ────────────────────────────────────────────────

export const workflowRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  entity: z.enum(["ticket","invoice","project","user"]),
  trigger: z.enum(["on_create","on_update","on_status_change","scheduled"]),
  conditions: z.array(z.record(z.unknown())).default([]),
  isActive: z.boolean().default(true),
  priority: z.number().int().default(0),
  actions: z.array(z.object({
    type: z.enum(["send_email","update_field","create_ticket","add_note","webhook","assign","wait"]),
    config: z.record(z.unknown()).default({}),
    sortOrder: z.number().int().default(0),
  })).default([]),
});

// ─── Reports ───────────────────────────────────────────────────────

export const reportSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  type: z.enum(["ticket_summary","revenue","sla","time","custom"]),
  config: z.record(z.unknown()).default({}),
  isSystem: z.boolean().default(false),
  createdById: z.string().uuid(),
});

export const reportScheduleSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  frequency: z.enum(["daily","weekly","monthly"]),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  timeOfDay: z.string(), // HH:MM
  recipients: z.array(z.string().email()),
  format: z.enum(["pdf","csv","excel"]).default("pdf"),
  isActive: z.boolean().default(true),
});

// ─── Field-Level Security ──────────────────────────────────────────

export const fieldPermissionSchema = z.object({
  id: z.string().uuid(),
  entity: z.enum(["ticket","invoice","company","user","project","asset","contract"]),
  field: z.string(),
  roleName: z.string(),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
});

// ─── SSO ───────────────────────────────────────────────────────────

export const ssoConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.enum(["saml","oidc","azure_ad","okta","onelogin","google"]),
  isActive: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
  domains: z.array(z.string()).default([]),
});

// ─── I18N ──────────────────────────────────────────────────────────

export const localeSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  name: z.string(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  direction: z.enum(["ltr","rtl"]).default("ltr"),
});

export const translationSchema = z.object({
  id: z.string().uuid(),
  localeCode: z.string(),
  key: z.string(),
  value: z.string(),
  namespace: z.string().default("common"),
});

// ─── Currency ──────────────────────────────────────────────────────

export const currencySchema = z.object({
  code: z.string().length(3),
  name: z.string(),
  symbol: z.string(),
  decimalPlaces: z.number().int().min(0).max(4).default(2),
  isActive: z.boolean().default(true),
});

export const exchangeRateSchema = z.object({
  id: z.string().uuid(),
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.number().positive(),
  updatedAt: z.string().datetime(),
});

// ─── Data Retention ────────────────────────────────────────────────

export const retentionPolicySchema = z.object({
  id: z.string().uuid(),
  entity: z.enum(["ticket","invoice","audit_log","notification","chat_session"]),
  retentionDays: z.number().int().min(1),
  archiveAction: z.enum(["archive","delete","anonymize"]).default("archive"),
  condition: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  lastRunAt: z.string().datetime().nullable(),
});

// ─── Calendar Sync ─────────────────────────────────────────────────

export const calendarSyncConfigSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(["google","outlook","caldav"]),
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  tokenExpiry: z.string().datetime().nullable(),
  calendarId: z.string().nullable(),
  syncScheduleEntries: z.boolean().default(true),
  syncPto: z.boolean().default(true),
  isActive: z.boolean().default(true),
  lastSyncAt: z.string().datetime().nullable(),
});

// ─── Bulk Operations ───────────────────────────────────────────────

export const bulkOperationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["ticket_update","ticket_assign","invoice_generate","email_send","csv_import"]),
  status: z.enum(["pending","running","completed","failed"]).default("pending"),
  entity: z.enum(["ticket","invoice","company","user"]),
  config: z.record(z.unknown()).default({}),
  totalCount: z.number().int().default(0),
  successCount: z.number().int().default(0),
  failureCount: z.number().int().default(0),
  errors: z.array(z.unknown()).default([]),
  createdById: z.string().uuid(),
});

// ─── Webhook ───────────────────────────────────────────────────────

export const webhookConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  url: z.string().url(),
  secret: z.string(),
  events: z.array(z.enum(["ticket.created","ticket.updated","ticket.closed","invoice.sent","invoice.paid","project.completed"])),
  isActive: z.boolean().default(true),
  retryCount: z.number().int().default(3),
  createdAt: z.string().datetime(),
});
