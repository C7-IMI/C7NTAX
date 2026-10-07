import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { normaliseLayout, widgetsFor } from "../services/dashboardLayout";

/**
 * The signed-in user's dashboard layout (PLAN-015 Phase B #4).
 *
 * Every route here acts on the caller's own row — there is no id in the path that could point at
 * somebody else's dashboard — so no permission check applies beyond being signed in. The widget
 * catalogue is filtered by the caller's permissions, which is what stops an account from saving a
 * widget it cannot load the data for.
 */
export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

async function currentLayout(userId: string, permissions: string[]) {
  const available = widgetsFor(permissions);
  const saved = await prisma.userDashboardConfig.findUnique({ where: { userId }, select: { widgets: true, updatedAt: true } });
  return {
    widgets: normaliseLayout(saved?.widgets, available),
    catalogue: available,
    personalised: !!saved,
    updatedAt: saved?.updatedAt ?? null,
  };
}

dashboardRouter.get("/layout", async (req: AuthRequest, res, next) => {
  try {
    res.json(await currentLayout(req.user!.userId, req.user!.permissions));
  } catch (e) { next(e); }
});

dashboardRouter.put("/layout", async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as { widgets?: unknown };
    if (!Array.isArray(body?.widgets)) throw new AppError("widgets must be an array", 400);
    if (body.widgets.length > 50) throw new AppError("too many widgets", 400);
    const available = widgetsFor(req.user!.permissions);
    const widgets = normaliseLayout(body.widgets, available);
    if (!widgets.some(w => w.visible)) throw new AppError("at least one widget must stay visible", 400);
    const row = await prisma.userDashboardConfig.upsert({
      where: { userId: req.user!.userId },
      update: { widgets: widgets as object },
      create: { userId: req.user!.userId, widgets: widgets as object },
    });
    res.json({ widgets, catalogue: available, personalised: true, updatedAt: row.updatedAt });
  } catch (e) { next(e); }
});

/** Back to the catalogue order and defaults. */
dashboardRouter.delete("/layout", async (req: AuthRequest, res, next) => {
  try {
    await prisma.userDashboardConfig.deleteMany({ where: { userId: req.user!.userId } });
    res.json(await currentLayout(req.user!.userId, req.user!.permissions));
  } catch (e) { next(e); }
});
