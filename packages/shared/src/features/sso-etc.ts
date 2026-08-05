import { z } from "zod";

// ─── SSO / SAML / OIDC ─────────────────────────────────────────────

export const ssoConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.enum(["saml","oidc","azure_ad","okta","onelogin","google"]),
  isActive: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
  domains: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── I18N / Multi-Language ─────────────────────────────────────────

export const localeSchema = z.object({
  id: z.string().uuid(),
  code: z.string().length(2).or(z.string().length(5)), // en, en-US
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

// ─── Currency / Multi-Currency ─────────────────────────────────────

export const currencySchema = z.object({
  code: z.string().length(3),
  name: z.string(),
  symbol: z.string(),
  decimalPlaces: z.number().int().default(2),
  isActive: z.boolean().default(true),
});

export const exchangeRateSchema = z.object({
  id: z.string().uuid(),
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.number().positive(),
});

// ─── Data Retention ────────────────────────────────────────────────

export const retentionPolicySchema = z.object({
  id: z.string().uuid(),
  entity: z.enum(["ticket","invoice","audit_log","notification","chat_session"]),
  retentionDays: z.number().int().positive(),
  archiveAction: z.enum(["archive","delete","anonymize"]).default("archive"),
  condition: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

// ─── Calendar Sync ─────────────────────────────────────────────────

export const calendarSyncConfigSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(["google","outlook","caldav"]),
  syncScheduleEntries: z.boolean().default(true),
  syncPto: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

// ─── Field-Level Security ──────────────────────────────────────────

export const fieldPermissionSchema = z.object({
  id: z.string().uuid(),
  entity: z.enum(["ticket","invoice","company","user","project"]),
  field: z.string(),
  roleName: z.string(),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
});

// ─── Report ─────────────────────────────────────────────────────────

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
  timeOfDay: z.string(),
  recipients: z.array(z.string().email()),
  format: z.enum(["pdf","csv","excel"]).default("pdf"),
  isActive: z.boolean().default(true),
});
