import { z } from "zod";

// ─── CRM / Sales Pipeline ───────────────────────────────────────────

export const opportunityStageEnum = z.enum(["prospect","qualified","proposal","negotiation","won","lost"]);
export type OpportunityStage = z.infer<typeof opportunityStageEnum>;

export const opportunitySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(300),
  companyId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  stage: opportunityStageEnum.default("prospect"),
  probability: z.number().int().min(0).max(100).default(0),
  amount: z.number().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  expectedCloseDate: z.string().datetime().nullable(),
  assignedToId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  customFields: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const salesActivitySchema = z.object({
  id: z.string().uuid(),
  opportunityId: z.string().uuid(),
  type: z.enum(["call","email","meeting","note"]),
  subject: z.string().min(1),
  body: z.string().nullable(),
  userId: z.string().uuid(),
  scheduledAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

// ─── Resource Scheduling ────────────────────────────────────────────

export const technicianSkillSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  skill: z.string(),
  level: z.number().int().min(1).max(5).default(1),
});

export const scheduleEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  ticketId: z.string().uuid().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.enum(["scheduled","in_progress","completed","cancelled"]).default("scheduled"),
  location: z.string().nullable(),
  travelTime: z.number().int().nullable(),
  color: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── Project Management ────────────────────────────────────────────

export const projectStatusEnum = z.enum(["planning","active","on_hold","completed","cancelled"]);

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(300),
  description: z.string().nullable(),
  companyId: z.string().uuid(),
  status: projectStatusEnum.default("planning"),
  priority: z.nativeEnum(z.enum(["low","medium","high","critical"])).default("medium"),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  budget: z.number().min(0).default(0),
  budgetSpent: z.number().min(0).default(0),
  currency: z.string().length(3).default("USD"),
  managerId: z.string().uuid().nullable(),
  customFields: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const projectPhaseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  sortOrder: z.number().int().default(0),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  status: z.enum(["pending","in_progress","completed"]).default("pending"),
});

export const projectTaskSchema = z.object({
  id: z.string().uuid(),
  phaseId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  sortOrder: z.number().int().default(0),
  status: z.enum(["pending","in_progress","completed","blocked"]).default("pending"),
  estimatedHours: z.number().positive().nullable(),
  actualHours: z.number().positive().nullable(),
  assignedToId: z.string().uuid().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  ticketId: z.string().uuid().nullable(),
});

export const taskDependencySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  dependsOnId: z.string().uuid(),
  type: z.enum(["finish_to_start","start_to_start","finish_to_finish"]).default("finish_to_start"),
  lagMinutes: z.number().int().default(0),
});
