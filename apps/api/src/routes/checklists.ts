/**
 * Checklists — repeatable procedures held against a client.
 *
 * A checklist is a name, an optional rich-text description, an owner and due
 * date, plus an ordered list of tasks. Tasks carry their own assignee, due date
 * and completion, so the same checklist can be worked by several people, and
 * "My tasks" can gather everything assigned to one person across every client.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { sanitizeEmailHtml } from "../services/emailHtml";

export const checklistsRouter = Router();
checklistsRouter.use(authenticate);

const USER_SELECT = { select: { id: true, firstName: true, lastName: true, email: true } } as const;
const MAX_DESCRIPTION = 200_000;

/** Rich text is allowed in descriptions and task notes, but only our safe subset. */
function safeRichText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_DESCRIPTION) throw new AppError("That description is too long", 400);
  return sanitizeEmailHtml(trimmed);
}

function toDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new AppError(`${field} is not a valid date`, 400);
  return parsed;
}

/** Progress as the list screens show it: "3 of 5" plus a percentage for the bar. */
function withProgress<T extends { tasks: { completedAt: Date | null }[] }>(checklist: T) {
  const total = checklist.tasks.length;
  const done = checklist.tasks.filter((t) => t.completedAt).length;
  return { ...checklist, taskCount: total, completedCount: done, progress: total ? Math.round((done / total) * 100) : 0 };
}

/** Ticking the last task completes the checklist's owner view, so keep updatedAt honest. */
async function touchChecklist(checklistId: string) {
  await prisma.checklist.update({ where: { id: checklistId }, data: { updatedAt: new Date() } }).catch(() => {});
}

async function loadChecklist(id: string, select?: Record<string, unknown>) {
  const checklist = await prisma.checklist.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      assignedTo: USER_SELECT,
      createdBy: USER_SELECT,
      tasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { assignedTo: USER_SELECT } },
      ...(select ?? {}),
    },
  });
  if (!checklist) throw new AppError("Checklist not found", 404);
  return checklist;
}

// ── List ────────────────────────────────────────────────────────────
checklistsRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, assignedToId, search, limit = "200" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) where.name = { contains: search, mode: "insensitive" };

    const checklists = await prisma.checklist.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Number(limit),
      include: {
        company: { select: { id: true, name: true } },
        assignedTo: USER_SELECT,
        tasks: { select: { id: true, completedAt: true } },
      },
    });
    res.json({ data: checklists.map(withProgress), total: checklists.length });
  } catch (e) { next(e); }
});

// ── My tasks: every task assigned to me, across clients ─────────────
checklistsRouter.get("/my-tasks", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, includeCompleted } = req.query as Record<string, string>;
    const tasks = await prisma.checklistTask.findMany({
      where: {
        assignedToId: req.user!.userId,
        ...(includeCompleted === "true" ? {} : { completedAt: null }),
        ...(companyId ? { checklist: { companyId } } : {}),
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      include: {
        assignedTo: USER_SELECT,
        checklist: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
      },
    });
    res.json({ data: tasks, total: tasks.length });
  } catch (e) { next(e); }
});

// ── Single checklist ────────────────────────────────────────────────
checklistsRouter.get("/:id", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    res.json(withProgress(await loadChecklist(String(req.params.id))));
  } catch (e) { next(e); }
});

// ── Create ──────────────────────────────────────────────────────────
checklistsRouter.post("/", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    const companyId = typeof req.body?.companyId === "string" ? req.body.companyId : "";
    if (!name) throw new AppError("A checklist name is required", 400);
    const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null;
    if (!company) throw new AppError("A client is required", 400);

    // New checklists can be created from a task list typed into the dialog.
    const taskTitles: string[] = Array.isArray(req.body?.tasks)
      ? req.body.tasks.map((t: unknown) => (typeof t === "string" ? t : (t as { title?: string })?.title)).filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
      : [];

    const checklist = await prisma.checklist.create({
      data: {
        name,
        companyId: company.id,
        description: safeRichText(req.body?.description),
        assignedToId: typeof req.body?.assignedToId === "string" && req.body.assignedToId ? req.body.assignedToId : null,
        dueDate: toDate(req.body?.dueDate, "dueDate") ?? null,
        createdById: req.user!.userId,
        tasks: {
          create: taskTitles.map((title, index) => ({
            title: title.trim().slice(0, 300),
            position: index,
            assignedToId: typeof req.body?.assignedToId === "string" && req.body.assignedToId ? req.body.assignedToId : null,
          })),
        },
      },
    });
    res.status(201).json(withProgress(await loadChecklist(checklist.id)));
  } catch (e) { next(e); }
});

// ── Update ──────────────────────────────────────────────────────────
checklistsRouter.patch("/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    await loadChecklist(id);
    const data: Record<string, unknown> = {};
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim().slice(0, 200);
      if (!name) throw new AppError("A checklist name is required", 400);
      data.name = name;
    }
    if (req.body?.description !== undefined) data.description = safeRichText(req.body.description);
    if (req.body?.assignedToId !== undefined) data.assignedToId = req.body.assignedToId || null;
    if (req.body?.companyId !== undefined) {
      const company = await prisma.company.findUnique({ where: { id: String(req.body.companyId) }, select: { id: true } });
      if (!company) throw new AppError("Client not found", 404);
      data.companyId = company.id;
    }
    const due = toDate(req.body?.dueDate, "dueDate");
    if (due !== undefined) data.dueDate = due;
    if (!Object.keys(data).length) throw new AppError("Nothing to update", 400);

    await prisma.checklist.update({ where: { id }, data });
    res.json(await loadChecklist(id));
  } catch (e) { next(e); }
});

// ── Duplicate (IT Glue's copy action: same procedure, nothing ticked) ─
checklistsRouter.post("/:id/duplicate", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const source = await loadChecklist(String(req.params.id));
    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 200) : `${source.name} (copy)`;
    const copy = await prisma.checklist.create({
      data: {
        name,
        companyId: typeof req.body?.companyId === "string" && req.body.companyId ? req.body.companyId : source.companyId,
        description: source.description,
        assignedToId: source.assignedToId,
        dueDate: source.dueDate,
        createdById: req.user!.userId,
        tasks: {
          create: source.tasks.map((task, index) => ({
            title: task.title,
            notes: task.notes,
            position: index,
            assignedToId: task.assignedToId,
            dueDate: task.dueDate,
          })),
        },
      },
    });
    res.status(201).json(withProgress(await loadChecklist(copy.id)));
  } catch (e) { next(e); }
});

// ── Delete ──────────────────────────────────────────────────────────
checklistsRouter.delete("/:id", requirePermission(Permission.TicketDelete), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.checklist.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new AppError("Checklist not found", 404);
    await prisma.checklist.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// ── Tasks ───────────────────────────────────────────────────────────
checklistsRouter.post("/:id/tasks", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    await loadChecklist(id);
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 300) : "";
    if (!title) throw new AppError("A task name is required", 400);
    const last = await prisma.checklistTask.findFirst({ where: { checklistId: id }, orderBy: { position: "desc" }, select: { position: true } });
    const task = await prisma.checklistTask.create({
      data: {
        checklistId: id,
        title,
        position: (last?.position ?? -1) + 1,
        assignedToId: typeof req.body?.assignedToId === "string" && req.body.assignedToId ? req.body.assignedToId : null,
        dueDate: toDate(req.body?.dueDate, "dueDate") ?? null,
      },
      include: { assignedTo: USER_SELECT },
    });
    await touchChecklist(id);
    res.status(201).json(task);
  } catch (e) { next(e); }
});

checklistsRouter.patch("/:id/tasks/:taskId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const taskId = String(req.params.taskId);
    const existing = await prisma.checklistTask.findUnique({ where: { id: taskId }, select: { id: true, checklistId: true } });
    if (!existing || existing.checklistId !== id) throw new AppError("Task not found", 404);

    const data: Record<string, unknown> = {};
    if (typeof req.body?.title === "string") {
      const title = req.body.title.trim().slice(0, 300);
      if (!title) throw new AppError("A task name is required", 400);
      data.title = title;
    }
    if (req.body?.notes !== undefined) data.notes = safeRichText(req.body.notes);
    if (req.body?.assignedToId !== undefined) data.assignedToId = req.body.assignedToId || null;
    if (req.body?.position !== undefined) data.position = Number(req.body.position) || 0;
    const due = toDate(req.body?.dueDate, "dueDate");
    if (due !== undefined) data.dueDate = due;
    if (req.body?.completed !== undefined) {
      const completed = Boolean(req.body.completed);
      data.completedAt = completed ? new Date() : null;
      data.completedById = completed ? req.user!.userId : null;
    }
    if (!Object.keys(data).length) throw new AppError("Nothing to update", 400);

    const task = await prisma.checklistTask.update({ where: { id: taskId }, data, include: { assignedTo: USER_SELECT } });
    await touchChecklist(id);
    res.json(task);
  } catch (e) { next(e); }
});

checklistsRouter.delete("/:id/tasks/:taskId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const taskId = String(req.params.taskId);
    const existing = await prisma.checklistTask.findUnique({ where: { id: taskId }, select: { checklistId: true } });
    if (!existing || existing.checklistId !== id) throw new AppError("Task not found", 404);
    await prisma.checklistTask.delete({ where: { id: taskId } });
    await touchChecklist(id);
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

/** Reorder after a drag or a move — the ids arrive in their new order. */
checklistsRouter.post("/:id/tasks/reorder", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const order: string[] = Array.isArray(req.body?.taskIds) ? req.body.taskIds.filter((t: unknown): t is string => typeof t === "string") : [];
    if (!order.length) throw new AppError("taskIds is required", 400);
    const tasks = await prisma.checklistTask.findMany({ where: { checklistId: id }, select: { id: true } });
    const known = new Set(tasks.map((t) => t.id));
    let position = 0;
    for (const taskId of order) {
      if (!known.has(taskId)) continue;
      await prisma.checklistTask.update({ where: { id: taskId }, data: { position } });
      position += 1;
    }
    await touchChecklist(id);
    res.json(await loadChecklist(id));
  } catch (e) { next(e); }
});
