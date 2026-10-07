import { Router } from "express";
import type { NextFunction, Response } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { runReportConfig, describeReportCatalog, type ReportConfig } from "../services/reportRunner";
import { AppError } from "../middleware/errorHandler";
import {
  BAND_KINDS, CHART_FUNCTIONS, CHART_KINDS, ELEMENT_TYPES, FORMAT_LABELS, FUNCTIONS, PAGE_SIZES, STARTERS, VALUE_FORMATS,
  AGGREGATE_SCOPES, DOCUMENT_VERSION, createBlankDocument, createStarter,
} from "@C7NTAX/shared";
import {
  catalogForValidation, invalidateTemplateCache, listTemplateRefs, resolveParameters, runTemplateDocument, validateDocument,
} from "../services/reportTemplates";
import {
  agingReport, clientValueReport, contractProfitabilityReport, csatReport, monthlyReviewReport, parsePeriod,
  qbrReport, revenueReport, slaReport, ticketVolumeReport, timeTrackingReport, utilizationReport, weeklyReviewReport,
  type ReportPeriod,
} from "../services/reportData";
import type { AuthUser } from "../middleware/auth";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

/**
 * Every standard report answers `?from=&to=&clientId=&boardId=` and returns its own numbers plus
 * the period it actually applied, so the screen can print "All time" or the range it was given
 * rather than leaving the reader to guess. `parsePeriod` resolves the client against the account's
 * own scope — a query parameter can narrow a report but never widen it.
 */
const standardReport = (build: (user: AuthUser | undefined, period: ReportPeriod) => Promise<unknown>) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const period = await parsePeriod(req.query as Record<string, unknown>, req.user);
      res.json(await build(req.user, period));
    } catch (e) { next(e); }
  };

reportsRouter.get("/data/ticket-volume", requirePermission(Permission.ReportView), standardReport(ticketVolumeReport));
reportsRouter.get("/data/sla-compliance", requirePermission(Permission.ReportView), standardReport(slaReport));
reportsRouter.get("/data/technician-utilization", requirePermission(Permission.ReportView), standardReport(utilizationReport));
reportsRouter.get("/data/revenue-summary", requirePermission(Permission.ReportView), standardReport(revenueReport));
reportsRouter.get("/data/ticket-aging", requirePermission(Permission.ReportView), standardReport(agingReport));
reportsRouter.get("/data/time-tracking", requirePermission(Permission.ReportView), standardReport(timeTrackingReport));
reportsRouter.get("/data/csat", requirePermission(Permission.ReportView), standardReport(csatReport));
reportsRouter.get("/data/contract-profitability", requirePermission(Permission.ReportView), standardReport(contractProfitabilityReport));
reportsRouter.get("/data/client-value", requirePermission(Permission.ReportView), standardReport(clientValueReport));
reportsRouter.get("/data/quarterly-business-review", requirePermission(Permission.ReportView), standardReport(qbrReport));
reportsRouter.get("/data/monthly-business-review", requirePermission(Permission.ReportView), standardReport(monthlyReviewReport));
reportsRouter.get("/data/weekly-business-review", requirePermission(Permission.ReportView), standardReport(weeklyReviewReport));

/** The options a report's own filters offer: the clients and boards the account can see. */
reportsRouter.get("/data/options", requirePermission(Permission.ReportView), async (req: AuthRequest, res, next) => {
  try {
    const scoped = req.user?.companyId;
    const [clients, boards] = await Promise.all([
      scoped
        ? prisma.company.findMany({ where: { id: scoped }, select: { id: true, name: true } })
        : prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.serviceBoard.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    res.json({ clients, boards });
  } catch (e) { next(e); }
});

/**
 * The designer's catalog (PLAN-020). Everything the designer offers — sources, fields, operators,
 * functions, band kinds, page sizes, formats and the starter documents — comes from here, and every
 * part of it is the same whitelist the runner enforces. There is no second list to drift.
 */
reportsRouter.get("/designer/catalog", requirePermission(Permission.ReportView), async (_req: AuthRequest, res, next) => {
  try {
    const catalog = describeReportCatalog();
    res.json({
      documentVersion: DOCUMENT_VERSION,
      sources: catalog.sources,
      operators: catalog.operators,
      functions: FUNCTIONS,
      bandKinds: BAND_KINDS,
      elementTypes: ELEMENT_TYPES,
      chartKinds: CHART_KINDS,
      chartFunctions: CHART_FUNCTIONS,
      pageSizes: PAGE_SIZES,
      formats: VALUE_FORMATS.map(key => ({ key, label: FORMAT_LABELS[key] })),
      aggregateScopes: AGGREGATE_SCOPES,
      starters: STARTERS,
      // The saved reports a sub-report element may point at, so the inspector can offer them by name.
      templates: await listTemplateRefs(),
      branding: [
        { key: "brand-mark", label: "C7NTAX mark", path: "/icon-192.png" },
        { key: "brand-wordmark", label: "C7NTAX wordmark", path: "/brand/wordmark-on-dark.png" },
      ],
    });
  } catch (e) { next(e); }
});

/** A starter document for a source, so a new report is never an empty page. */
reportsRouter.get("/designer/starter", requirePermission(Permission.ReportView), (req: AuthRequest, res, next) => {
  try {
    const catalog = describeReportCatalog();
    const sourceKey = String(req.query.source ?? "tickets");
    const source = catalog.sources.find(candidate => candidate.key === sourceKey);
    if (!source) throw new AppError(`"${sourceKey}" is not a data source this product can report on.`, 400);
    const kind = String(req.query.kind ?? "list");
    const starter = STARTERS.find(candidate => candidate.kind === kind);
    if (!starter) throw new AppError(`"${kind}" is not one of the starter layouts.`, 400);
    const name = typeof req.query.name === "string" && req.query.name.trim() ? req.query.name.trim() : `${source.label} — ${starter.label}`;
    const document = kind === "blank" ? createBlankDocument(name, source.key as never) : createStarter(starter.kind, source, name);
    res.json({ document, issues: validateDocument(document, name).issues });
  } catch (e) { next(e); }
});

/** Live validation for the designer: it posts the document it is editing and shows what comes back. */
reportsRouter.post("/designer/validate", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "Untitled report";
    const templates = await listTemplateRefs();
    const validation = validateDocument(req.body?.document ?? req.body, name, templates);
    res.json({ issues: validation.issues, document: validation.document, catalog: catalogForValidation(), templates });
  } catch (e) { next(e); }
});

/**
 * A preview of a draft document: validate, then run its data source so the designer can lay the real
 * rows out. Reading a report is enough to preview it; writing one is not required.
 */
reportsRouter.post("/designer/preview", requirePermission(Permission.ReportView), async (req: AuthRequest, res, next) => {
  try {
    const period = await parsePeriod((req.body ?? {}) as Record<string, unknown>, req.user);
    const supplied = { ...(req.body?.parameters ?? {}) } as Record<string, unknown>;
    if (typeof req.body?.from === "string") supplied.from = req.body.from;
    if (typeof req.body?.to === "string") supplied.to = req.body.to;
    if (period.clientId) supplied.clientId = period.clientId;

    const run = await runTemplateDocument(req.body?.document ?? req.body, {
      name: typeof req.body?.name === "string" ? req.body.name : undefined,
      parameters: supplied,
      clientId: period.clientId,
    });
    if (run.validation.errors.length) {
      throw new AppError(`${run.validation.errors.length} problem${run.validation.errors.length === 1 ? "" : "s"} in this template: ${run.validation.errors[0]!.message}`, 422);
    }
    res.json({
      report: req.body?.name ?? run.validation.document.name,
      document: run.validation.document,
      parameters: run.parameters,
      period,
      columns: run.columns,
      rows: run.rows,
      data: run.rows,
      truncated: run.truncated,
      limit: run.limit,
      notes: run.notes,
      issues: run.validation.issues,
      subreports: run.subreports,
      templates: await listTemplateRefs(),
    });
  } catch (e) { next(e); }
});

reportsRouter.get("/", requirePermission(Permission.ReportView), async (_req: AuthRequest, res, next) => {
  try {
    const reports = await prisma.report.findMany({ orderBy: { name: "asc" } });
    const [authors, schedules] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: [...new Set(reports.map(r => r.createdById))] } }, select: { id: true, firstName: true, lastName: true } }),
      prisma.reportSchedule.findMany({ where: { reportId: { in: reports.map(r => r.id) } } }),
    ]);
    const authorById = new Map(authors.map(a => [a.id, a]));
    res.json(reports.map(r => ({ ...r, createdBy: authorById.get(r.createdById) ?? null, schedules: schedules.filter(s => s.reportId === r.id) })));
  }
  catch (e) { next(e); }
});

reportsRouter.post("/", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    if (!req.body?.name || typeof req.body.name !== "string" || !req.body.name.trim()) throw new AppError("A report needs a name");
    const type = req.body.type || "custom";
    // A template is validated before it is stored: an invalid document is a report that can never run.
    if (type === "template") await assertTemplateIsValid(req.body.config?.document, req.body.name);
    const r = await prisma.report.create({
      data: {
        name: req.body.name.trim(),
        description: req.body.description || null,
        type,
        config: req.body.config || {},
        createdById: req.user!.userId,
      },
    });
    if (r.type === "template") invalidateTemplateCache();
    res.status(201).json(r);
  } catch (e) { next(e); }
});

reportsRouter.patch("/:id", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new AppError("Report not found", 404);
    const updates: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
    if (req.body?.description !== undefined) updates.description = req.body.description || null;
    if (typeof req.body?.type === "string") updates.type = req.body.type;
    if (req.body?.config !== undefined) updates.config = req.body.config;
    const nextType = (updates.type as string | undefined) ?? report.type;
    const nextConfig = (updates.config as { document?: unknown } | undefined) ?? (report.config as { document?: unknown } | null);
    if (nextType === "template") await assertTemplateIsValid(nextConfig?.document, (updates.name as string | undefined) ?? report.name);
    const updated = await prisma.report.update({ where: { id: report.id }, data: updates });
    if (nextType === "template" || report.type === "template") invalidateTemplateCache();
    res.json(updated);
  } catch (e) { next(e); }
});

/**
 * Refuses a template that does not pass the same validation the render path applies. The first problem
 * is in the message so a plain HTTP client still learns something useful, and the full list travels in
 * `details` for the designer to highlight.
 */
async function assertTemplateIsValid(raw: unknown, name: string): Promise<void> {
  const validation = validateDocument(raw, name, await listTemplateRefs());
  if (!validation.errors.length) return;
  const first = validation.errors[0]!;
  throw new AppError(
    `This template has ${validation.errors.length} problem${validation.errors.length === 1 ? "" : "s"}: ${first.message}${first.path ? ` (${first.path})` : ""}`,
    422,
    validation.errors,
  );
}

reportsRouter.delete("/:id", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new AppError("Report not found", 404);
    // A system report is seeded rather than written, so removing it would silently change what the
    // console ships with. Schedules go with the report they belong to.
    if (report.isSystem) throw new AppError(`${report.name} ships with the product and cannot be deleted`, 409);
    await prisma.reportSchedule.deleteMany({ where: { reportId: report.id } });
    await prisma.report.delete({ where: { id: report.id } });
    if (report.type === "template") invalidateTemplateCache();
    res.json({ deleted: true, name: report.name });
  } catch (e) { next(e); }
});

/** Copies a report so a variation is a two-field edit rather than a retype. */
reportsRouter.post("/:id/duplicate", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new AppError("Report not found", 404);
    const copy = await prisma.report.create({
      data: {
        name: `${report.name} (copy)`.slice(0, 120),
        description: report.description,
        type: report.type,
        config: report.config ?? {},
        createdById: req.user!.userId,
      },
    });
    if (copy.type === "template") invalidateTemplateCache();
    res.status(201).json(copy);
  } catch (e) { next(e); }
});

reportsRouter.post("/schedules/:scheduleId/run", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const schedule = await prisma.reportSchedule.findUnique({ where: { id: req.params.scheduleId } });
    if (!schedule) throw new AppError("Schedule not found", 404);
    res.json(await prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastSentAt: new Date() } }));
  } catch (e) { next(e); }
});

reportsRouter.delete("/schedules/:scheduleId", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const schedule = await prisma.reportSchedule.findUnique({ where: { id: req.params.scheduleId } });
    if (!schedule) throw new AppError("Schedule not found", 404);
    await prisma.reportSchedule.delete({ where: { id: schedule.id } });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

reportsRouter.get("/:id/run", requirePermission(Permission.ReportView), async (req: AuthRequest, res, next) => {
  try {
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw new AppError("Report not found", 404);

    const period = await parsePeriod(req.query as Record<string, unknown>, req.user);

    // A designed report runs its own document: the rows come from the data source it declares, and the
    // document travels with them so the designer's layout engine lays out the same rows the API ran.
    if (report.type === "template") {
      const supplied = { ...(req.query as Record<string, unknown>) };
      if (period.clientId) supplied.clientId = period.clientId;
      const run = await runTemplateDocument((report.config as { document?: unknown } | null)?.document, {
        name: report.name,
        parameters: supplied,
        clientId: period.clientId,
      });
      if (run.validation.errors.length) {
        throw new AppError(`This template has ${run.validation.errors.length} problem${run.validation.errors.length === 1 ? "" : "s"}: ${run.validation.errors[0]!.message}`, 422);
      }
      res.json({
        report: report.name, type: report.type, generatedAt: new Date().toISOString(), period,
        document: run.validation.document, parameters: run.parameters,
        columns: run.columns, rows: run.rows, data: run.rows,
        truncated: run.truncated, limit: run.limit, notes: run.notes, issues: run.validation.issues,
        subreports: run.subreports,
      });
      return;
    }

    // A stored config is the point of the custom type, so it is what runs. The built-in types keep
    // their fixed shapes because saved reports and schedules already use them.
    if (report.type === "custom") {
      const source = (report.config as ReportConfig | undefined)?.source;
      const scope = source === "time_entries"
        ? (period.clientId ? { ticket: { companyId: period.clientId } } : {})
        : (period.clientId ? { companyId: period.clientId } : {});
      const result = await runReportConfig((report.config ?? {}) as ReportConfig, scope);
      res.json({ report: report.name, type: report.type, generatedAt: new Date().toISOString(), period, ...result, data: result.rows });
      return;
    }

    const built = await runBuiltIn(report.type, req.user, period);
    if (built) {
      res.json({ report: report.name, type: report.type, generatedAt: new Date().toISOString(), period, ...built });
      return;
    }
    res.json({
      report: report.name, type: report.type, generatedAt: new Date().toISOString(), period,
      columns: [], data: [],
      note: `No runner is registered for the report type "${report.type}". Pick a source in the editor or change the type.`,
    });
  }
  catch (e) { next(e); }
});

/**
 * A saved report of a standard type runs the same code as the Standard Reports screen, so a saved
 * report can never show a different number from the screen it was saved from.
 */
async function runBuiltIn(type: string, user: AuthUser | undefined, period: ReportPeriod): Promise<Record<string, unknown> | null> {
  const runners: Record<string, (u: AuthUser | undefined, p: ReportPeriod) => Promise<unknown>> = {
    ticket_summary: ticketVolumeReport,
    ticket_volume: ticketVolumeReport,
    sla: slaReport,
    revenue: revenueReport,
    utilization: utilizationReport,
    aging: agingReport,
    csat: csatReport,
    time: timeTrackingReport,
    time_tracking: timeTrackingReport,
    contract: contractProfitabilityReport,
    contract_profitability: contractProfitabilityReport,
    client_value: clientValueReport,
    qbr: qbrReport,
    quarterly_business_review: qbrReport,
    weekly_review: weeklyReviewReport,
    weekly_business_review: weeklyReviewReport,
    monthly_review: monthlyReviewReport,
    monthly_business_review: monthlyReviewReport,
  };
  const runner = runners[type];
  if (!runner) return null;
  const result = await runner(user, period);

  // A saved report's reader expects rows. A structured payload keeps its headline list as the rows
  // and carries the rest of the object alongside, rather than being flattened into something the
  // report's own columns no longer describe.
  const headline = pickHeadline(result);
  if (headline) {
    const summary = Object.fromEntries(Object.entries(result as Record<string, unknown>).filter(([k]) => k !== "period"));
    return { columns: Object.keys(headline[0] ?? {}), data: headline, summary };
  }
  return { columns: Object.keys(result as object), data: [], summary: result };
}

/**
 * The list a structured report is *about*, used when a saved report needs rows. The preferred keys
 * come first so a saved satisfaction report shows its clients rather than its 0–10 distribution,
 * and anything unlisted falls back to the first array of objects the payload holds.
 */
function pickHeadline(result: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (!result || typeof result !== "object") return null;
  const payload = result as Record<string, unknown>;
  const preferred = [
    "clients", "byClient", "technicians", "agreements", "byTechnician", "byAssignee", "byTicket",
    "byBoard", "byStatus", "byPriority", "trend", "byDate", "monthlyRevenue", "aging", "breaches",
  ];
  for (const key of preferred) {
    const value = payload[key];
    if (Array.isArray(value) && value.length && typeof value[0] === "object") return value as Array<Record<string, unknown>>;
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length && typeof value[0] === "object") return value as Array<Record<string, unknown>>;
  }
  return null;
}

reportsRouter.post("/:id/schedules", requirePermission(Permission.ReportCreate), async (req: AuthRequest, res, next) => {
  try {
    const { frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, format } = req.body ?? {};
    if (!["daily", "weekly", "monthly"].includes(String(frequency))) throw new AppError("frequency must be daily, weekly or monthly");
    if (!timeOfDay) throw new AppError("timeOfDay is required");
    const report = await prisma.report.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!report) throw new AppError("Report not found", 404);
    const s = await prisma.reportSchedule.create({
      data: {
        reportId: report.id,
        frequency,
        dayOfWeek: dayOfWeek === undefined || dayOfWeek === null || dayOfWeek === "" ? null : Number(dayOfWeek),
        dayOfMonth: dayOfMonth === undefined || dayOfMonth === null || dayOfMonth === "" ? null : Number(dayOfMonth),
        timeOfDay,
        recipients: Array.isArray(recipients) ? recipients.filter((r: unknown) => typeof r === "string" && r.includes("@")) : [],
        format: format || "pdf",
      },
    });
    res.status(201).json(s);
  } catch (e) { next(e); }
});
