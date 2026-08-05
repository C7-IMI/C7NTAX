import { z } from "zod";
import {
  TicketStatus, TicketPriority, TicketSource,
  InvoiceStatus, BillingPeriod, SystemRole, Permission,
} from "./enums";

// ─── User & Auth ──────────────────────────────────────────────────────

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.nativeEnum(SystemRole),
  companyId: z.string().uuid().nullable(), // null = internal staff
  isActive: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaSecret: z.string().nullable(),
  mfaMethod: z.enum(["authenticator", "email", "none"]).default("none"),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(SystemRole),
  companyId: z.string().uuid().nullable().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  totpCode: z.string().length(6).optional(),
});

export const mfaSetupSchema = z.object({
  method: z.enum(["authenticator", "email"]),
  totpCode: z.string().length(6),
});

// ─── Company ──────────────────────────────────────────────────────────

export const companySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).nullable(),
  taxId: z.string().max(50).nullable(),
  phone: z.string().max(30).nullable(),
  website: z.string().url().nullable().or(z.literal("")),
  address: z.object({
    line1: z.string().max(200),
    line2: z.string().max(200).optional(),
    city: z.string().max(100),
    state: z.string().max(100),
    zip: z.string().max(20),
    country: z.string().max(100),
  }).nullable(),
  isActive: z.boolean(),
  autoCloseDays: z.number().int().min(1).max(90).default(14),
  followUpIntervalHours: z.number().int().min(1).max(168).default(24),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Company = z.infer<typeof companySchema>;

// ─── Ticket ───────────────────────────────────────────────────────────

export const ticketSchema = z.object({
  id: z.string().uuid(),
  ticketNumber: z.string(), // e.g. TKT-2024-0001
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable(),
  status: z.nativeEnum(TicketStatus),
  priority: z.nativeEnum(TicketPriority),
  source: z.nativeEnum(TicketSource),
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  assignedToId: z.string().uuid().nullable(),
  serviceBoardId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  subCategoryId: z.string().uuid().nullable(),
  estimatedHours: z.number().positive().nullable(),
  actualHours: z.number().positive().nullable(),
  dueDate: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  lastClientResponseAt: z.string().datetime().nullable(),
  followUpCount: z.number().int().min(0).default(0),
  autoCloseAt: z.string().datetime().nullable(),
  isOverdue: z.boolean().default(false),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Ticket = z.infer<typeof ticketSchema>;

export const createTicketSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.Medium),
  source: z.nativeEnum(TicketSource).default(TicketSource.Portal),
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  serviceBoardId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

export const updateTicketSchema = createTicketSchema.partial().extend({
  status: z.nativeEnum(TicketStatus).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  estimatedHours: z.number().positive().nullable().optional(),
  actualHours: z.number().positive().nullable().optional(),
});

// ─── Ticket Note ──────────────────────────────────────────────────────

export const ticketNoteSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  content: z.string().max(10000),
  isInternal: z.boolean().default(false),
  isEmail: z.boolean().default(false),
  emailFrom: z.string().email().nullable(),
  emailTo: z.string().email().nullable(),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export type TicketNote = z.infer<typeof ticketNoteSchema>;

// ─── Time Entry ───────────────────────────────────────────────────────

export const timeEntrySchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  userId: z.string().uuid(),
  hours: z.number().positive().max(24),
  note: z.string().max(2000).optional(),
  billable: z.boolean().default(true),
  date: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type TimeEntry = z.infer<typeof timeEntrySchema>;

// ─── Service Board ────────────────────────────────────────────────────

export const serviceBoardSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  isActive: z.boolean().default(true),
  defaultPriority: z.nativeEnum(TicketPriority).default(TicketPriority.Medium),
  defaultStatus: z.nativeEnum(TicketStatus).default(TicketStatus.New),
  emailConnectorEnabled: z.boolean().default(false),
  emailConnectorAddress: z.string().email().nullable(),
  emailConnectorProtocol: z.enum(["imap", "pop3", "exchange"]).nullable(),
  emailConnectorHost: z.string().nullable(),
  emailConnectorPort: z.number().int().nullable(),
  emailConnectorUsername: z.string().nullable(),
  emailConnectorPassword: z.string().nullable(),
  emailConnectorUseSSL: z.boolean().default(true),
  emailConnectorLastCheckedAt: z.string().datetime().nullable(),
  autoCloseDays: z.number().int().min(1).max(90).default(14),
  followUpIntervalHours: z.number().int().min(1).max(168).default(24),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ServiceBoard = z.infer<typeof serviceBoardSchema>;

// ─── Contact ──────────────────────────────────────────────────────────

export const contactSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(30).nullable(),
  mobile: z.string().max(30).nullable(),
  title: z.string().max(200).nullable(),
  isPrimary: z.boolean().default(false),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Contact = z.infer<typeof contactSchema>;

// ─── Service Agreement ────────────────────────────────────────────────

export const serviceAgreementSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
  billingPeriod: z.nativeEnum(BillingPeriod),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  nextInvoiceDate: z.string().datetime().nullable(),
  isActive: z.boolean().default(true),
  autoRenew: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ServiceAgreement = z.infer<typeof serviceAgreementSchema>;

// ─── Invoice ──────────────────────────────────────────────────────────

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  companyId: z.string().uuid(),
  serviceAgreementId: z.string().uuid().nullable(),
  status: z.nativeEnum(InvoiceStatus),
  amount: z.number().positive(),
  taxAmount: z.number().min(0).default(0),
  totalAmount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  dueDate: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
  followUpCount: z.number().int().min(0).default(0),
  lastFollowUpAt: z.string().datetime().nullable(),
  notes: z.string().max(5000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceLineItemSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  total: z.number().positive(),
  ticketId: z.string().uuid().nullable(),
  timeEntryId: z.string().uuid().nullable(),
});

export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

// ─── Integration ──────────────────────────────────────────────────────

export const integrationConfigSchema = z.object({
  id: z.string().uuid(),
  serviceName: z.string(),
  displayName: z.string(),
  isEnabled: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()),
  lastSyncAt: z.string().datetime().nullable(),
  syncStatus: z.enum(["idle", "syncing", "error", "disconnected"]).default("idle"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

// ─── API Response Wrappers ────────────────────────────────────────────

export const apiResponse = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    meta: z.object({
      page: z.number().int().optional(),
      pageSize: z.number().int().optional(),
      total: z.number().int().optional(),
    }).optional(),
  });

export const paginatedQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginatedQuery = z.infer<typeof paginatedQuery>;
