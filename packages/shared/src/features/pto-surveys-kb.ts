import { z } from "zod";

// ─── Time-Off / PTO ─────────────────────────────────────────────────

export const ptoRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(["vacation","sick","personal","bereavement","other"]),
  status: z.enum(["pending","approved","denied","cancelled"]).default("pending"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  hours: z.number().positive(),
  reason: z.string().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  deniedReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const holidaySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  date: z.string().datetime(),
  recurring: z.boolean().default(true),
  country: z.string().default("US"),
  region: z.string().nullable(),
});

// ─── Surveys / NPS ──────────────────────────────────────────────────

export const surveySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  type: z.enum(["csat","nps","ces","custom"]).default("csat"),
  isActive: z.boolean().default(true),
  sendOnResolve: z.boolean().default(false),
  sendDelayHours: z.number().int().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const surveyQuestionSchema = z.object({
  id: z.string().uuid(),
  surveyId: z.string().uuid(),
  text: z.string().min(1),
  type: z.enum(["rating","text","choice","nps"]).default("rating"),
  required: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  choices: z.array(z.string()).default([]),
});

export const surveyResponseSchema = z.object({
  id: z.string().uuid(),
  surveyId: z.string().uuid(),
  ticketId: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  npsScore: z.number().int().min(0).max(10).nullable(),
  completedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const surveyAnswerSchema = z.object({
  id: z.string().uuid(),
  responseId: z.string().uuid(),
  questionId: z.string().uuid(),
  value: z.string(),
});

// ─── Knowledge Base ─────────────────────────────────────────────────

export const kbArticleSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  slug: z.string(),
  content: z.string(),
  excerpt: z.string().nullable(),
  status: z.enum(["draft","published","archived"]).default("draft"),
  visibility: z.enum(["internal","public"]).default("internal"),
  categoryId: z.string().uuid().nullable(),
  authorId: z.string().uuid(),
  viewCount: z.number().int().default(0),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const kbCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string(),
  description: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number().int().default(0),
});

export const kbArticleVersionSchema = z.object({
  id: z.string().uuid(),
  articleId: z.string().uuid(),
  version: z.number().int(),
  content: z.string(),
  changeNote: z.string().nullable(),
  authorId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
