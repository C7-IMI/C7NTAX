import {
  TicketStatus,
  TicketPriority,
  TicketSource,
  InvoiceStatus,
  BillingPeriod,
  SystemRole,
  Permission,
} from "./enums";

// ─── User ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  systemRole: SystemRole;
  companyId: string | null; // null = internal staff; set = client user
  mfaEnabled: boolean;
  mfaSecret: string | null;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSession {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ─── Company (Client) ────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Contact ─────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  title: string | null;
  isPrimary: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service Board ───────────────────────────────────────────────────

export interface ServiceBoard {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: TicketPriority;
  autoCloseDays: number; // days before auto-close on "waiting on client"
  isActive: boolean;
  teams: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Ticket ─────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  ticketNumber: number; // auto-increment per board
  boardId: string;
  companyId: string;
  contactId: string | null;
  assignedToId: string | null;
  createdById: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  title: string;
  description: string | null;
  resolution: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  waitingSince: Date | null;
  autoClosedAt: Date | null;
  dueDate: Date | null;
  isOverdue: boolean;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketNote {
  id: string;
  ticketId: string;
  authorId: string;
  content: string;
  isInternal: boolean;
  isEmailMirror: boolean; // true if originated from email
  createdAt: Date;
}

export interface TicketAttachment {
  id: string;
  ticketId: string;
  noteId: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  uploadedById: string;
  createdAt: Date;
}

export interface TicketTimeEntry {
  id: string;
  ticketId: string;
  userId: string;
  hours: number;
  note: string | null;
  isBillable: boolean;
  billingRateId: string | null;
  dateWorked: Date;
  createdAt: Date;
}

export interface TicketTag {
  id: string;
  ticketId: string;
  tag: string;
}

// ─── Email Connector ────────────────────────────────────────────────

export interface EmailConnector {
  id: string;
  boardId: string;
  name: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  imapUsername: string;
  imapPasswordEncrypted: string;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  smtpUsername: string;
  smtpPasswordEncrypted: string;
  pollingIntervalSeconds: number;
  isActive: boolean;
  lastPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service Agreement & Billing ─────────────────────────────────────

export interface ServiceAgreement {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  billingPeriod: BillingPeriod;
  amount: number;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  nextInvoiceDate: Date | null;
  autoRenew: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  companyId: string;
  serviceAgreementId: string | null;
  status: InvoiceStatus;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  currency: string;
  dueDate: Date;
  sentAt: Date | null;
  paidAt: Date | null;
  followUpCount: number;
  lastFollowUpAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  sortOrder: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference: string | null;
  processedAt: Date;
  createdAt: Date;
}

// ─── Integration ─────────────────────────────────────────────────────

export interface IntegrationConnection {
  id: string;
  serviceName: IntegrationService;
  displayName: string;
  credentialsEncrypted: string; // JSON blob encrypted at rest
  configJson: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum IntegrationService {
  Flexpoint = "flexpoint",
  Quickbooks = "quickbooks",
  Pax8 = "pax8",
  Avanan = "avanan",
  Proofpoint = "proofpoint",
  SentinelOne = "sentinel_one",
  ITGlue = "itglue",
  Microsoft365 = "microsoft_365",
  Azure = "azure",
  Aws = "aws",
}

// ─── Notification ────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  link: string | null;
  createdAt: Date;
}

export enum NotificationType {
  TicketAssigned = "ticket_assigned",
  TicketUpdated = "ticket_updated",
  TicketClosed = "ticket_closed",
  InvoiceSent = "invoice_sent",
  InvoiceOverdue = "invoice_overdue",
  SystemAlert = "system_alert",
  FollowUpDue = "follow_up_due",
}

// ─── API Envelope ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
