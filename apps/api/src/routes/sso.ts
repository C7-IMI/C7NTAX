import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
export const ssoRouter = Router(); ssoRouter.use(authenticate);

ssoRouter.get("/configs", async (_req: AuthRequest, res, next) => {
  try { const configs = await prisma.ssoConfig.findMany(); res.json(configs.map(({ config, ...rest }) => ({ ...rest, config: typeof config === "object" ? config : {} }))); }
  catch (e) { next(e); }
});

ssoRouter.post("/configs", async (req: AuthRequest, res, next) => {
  try { const c = await prisma.ssoConfig.create({ data: { name: req.body.name, provider: req.body.provider, config: req.body.config || {}, domains: req.body.domains || [] } }); res.status(201).json(c); }
  catch (e) { next(e); }
});

ssoRouter.patch("/configs/:id", async (req: AuthRequest, res, next) => {
  try { const allowed = ["name","isActive","config","domains"]; const updates: Record<string, unknown> = {}; for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    res.json(await prisma.ssoConfig.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});

ssoRouter.delete("/configs/:id", async (req: AuthRequest, res, next) => {
  try { await prisma.ssoConfig.delete({ where: { id: req.params.id } }); res.json({ message: "SSO config removed" }); }
  catch (e) { next(e); }
});
