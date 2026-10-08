import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { normaliseFavorites } from "../services/navFavorites";

/**
 * The signed-in user's navigation pins.
 *
 * Every route here acts on the caller's own row — there is no id in the path that could point at
 * somebody else's pins — so being signed in is the whole of the gate. The list is cleaned rather
 * than trusted: `normaliseFavorites` drops anything that is not shaped like one of our section ids.
 */
export const navRouter = Router();
navRouter.use(authenticate);

async function currentFavorites(userId: string) {
  const saved = await prisma.userNavConfig.findUnique({ where: { userId }, select: { favorites: true, updatedAt: true } });
  return {
    favorites: normaliseFavorites(saved?.favorites),
    /** Whether the account has ever saved pins, so a client can tell a stored empty list from none. */
    personalised: !!saved,
    updatedAt: saved?.updatedAt ?? null,
  };
}

navRouter.get("/favorites", async (req: AuthRequest, res, next) => {
  try {
    res.json(await currentFavorites(req.user!.userId));
  } catch (e) { next(e); }
});

navRouter.put("/favorites", async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as { favorites?: unknown };
    if (!Array.isArray(body?.favorites)) throw new AppError("favorites must be an array", 400);
    const favorites = normaliseFavorites(body.favorites);
    const row = await prisma.userNavConfig.upsert({
      where: { userId: req.user!.userId },
      update: { favorites },
      create: { userId: req.user!.userId, favorites },
    });
    res.json({ favorites, personalised: true, updatedAt: row.updatedAt });
  } catch (e) { next(e); }
});

/** Back to nothing pinned — the dashboard's own "reset", for the same reason. */
navRouter.delete("/favorites", async (req: AuthRequest, res, next) => {
  try {
    await prisma.userNavConfig.deleteMany({ where: { userId: req.user!.userId } });
    res.json(await currentFavorites(req.user!.userId));
  } catch (e) { next(e); }
});
