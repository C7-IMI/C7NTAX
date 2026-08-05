import { z } from "zod";

// ─── Inventory / Asset Tracking ─────────────────────────────────────

export const assetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(300),
  assetTag: z.string(),
  serialNumber: z.string().nullable(),
  model: z.string().nullable(),
  manufacturer: z.string().nullable(),
  type: z.enum(["hardware","software","license","peripheral","network","other"]),
  status: z.enum(["available","assigned","retired","lost","rma"]).default("available"),
  purchaseDate: z.string().datetime().nullable(),
  purchasePrice: z.number().positive().nullable(),
  warrantyExpiry: z.string().datetime().nullable(),
  location: z.string().nullable(),
  companyId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  customFields: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const assetAssignmentSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  assignedToId: z.string().uuid().nullable(),
  ticketId: z.string().uuid().nullable(),
  checkedOutAt: z.string().datetime(),
  checkedInAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});

// ─── Contract / Renewal Management ────────────────────────────────

export const contractSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(300),
  contractNumber: z.string(),
  companyId: z.string().uuid(),
  type: z.enum(["service","support","license","sla","nda","other"]),
  status: z.enum(["draft","active","expiring","expired","terminated"]).default("active"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  renewalDate: z.string().datetime().nullable(),
  autoRenew: z.boolean().default(false),
  value: z.number().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  billingPeriod: z.enum(["monthly","quarterly","annual"]).nullable(),
  serviceAgreementId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const contractMilestoneSchema = z.object({
  id: z.string().uuid(),
  contractId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  dueDate: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  amount: z.number().positive().nullable(),
  status: z.enum(["pending","completed"]).default("pending"),
});

// ─── Procurement / Purchase Orders ─────────────────────────────────

export const vendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  contactName: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  taxId: z.string().nullable(),
  paymentTerms: z.enum(["net30","net60","due_on_receipt"]).nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  poNumber: z.string(),
  vendorId: z.string().uuid(),
  status: z.enum(["draft","submitted","approved","ordered","received","cancelled"]).default("draft"),
  subtotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  orderedAt: z.string().datetime().nullable(),
  expectedAt: z.string().datetime().nullable(),
  receivedAt: z.string().datetime().nullable(),
  approvedById: z.string().uuid().nullable(),
  createdById: z.string().uuid(),
  notes: z.string().nullable(),
});

export const poLineItemSchema = z.object({
  id: z.string().uuid(),
  poId: z.string().uuid(),
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().positive(),
  total: z.number().positive(),
  assetId: z.string().uuid().nullable(),
});
