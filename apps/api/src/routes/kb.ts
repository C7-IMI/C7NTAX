import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
export const kbRouter = Router(); kbRouter.use(authenticate);

kbRouter.get("/", async (req: AuthRequest, res, next) => {
  try { const { search, categoryId, status, visibility, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { status: status || "published" };
    if (categoryId) where.categoryId = categoryId;
    if (visibility) where.visibility = visibility;
    if (search) where.OR = [{ title: { contains: search } }, { content: { contains: search } }];
    const [data, total] = await Promise.all([prisma.knowledgeBaseArticle.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" }, select: { id: true, title: true, slug: true, excerpt: true, status: true, visibility: true, tags: true, viewCount: true, helpfulCount: true, updatedAt: true, category: { select: { id: true, name: true } }, author: { select: { id: true, firstName: true, lastName: true } } } }), prisma.knowledgeBaseArticle.count({ where })]);
    res.json({ data, total }); }
  catch (e) { next(e); }
});

kbRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const slug = req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const article = await prisma.knowledgeBaseArticle.create({ data: { title: req.body.title, slug, content: req.body.content, excerpt: req.body.excerpt || null, status: req.body.status || "draft", visibility: req.body.visibility || "internal", categoryId: req.body.categoryId || null, authorId: req.user!.userId, tags: req.body.tags || [] } });
    await prisma.kBArticleVersion.create({ data: { articleId: article.id, version: 1, content: req.body.content, authorId: req.user!.userId } });
    res.status(201).json(article); }
  catch (e) { next(e); }
});

kbRouter.get("/:slug", async (req: AuthRequest, res, next) => {
  try { const article = await prisma.knowledgeBaseArticle.findUnique({ where: { slug: req.params.slug }, include: { author: { select: { firstName: true, lastName: true } }, category: true, versions: { orderBy: { version: "desc" }, take: 5 }, linkedTickets: { include: { ticket: { select: { ticketNumber: true, title: true } } } } } });
    if (!article) throw new AppError("Not found", 404);
    await prisma.knowledgeBaseArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });
    res.json(article); }
  catch (e) { next(e); }
});

kbRouter.patch("/:id", async (req: AuthRequest, res, next) => {
  try { const { content, title, status, visibility, tags } = req.body;
    const updates: Record<string, unknown> = {};
    if (title) updates.title = title; if (status) updates.status = status; if (visibility) updates.visibility = visibility; if (tags) updates.tags = tags;
    if (content) { updates.content = content; const latest = await prisma.kBArticleVersion.findFirst({ where: { articleId: req.params.id }, orderBy: { version: "desc" } });
      await prisma.kBArticleVersion.create({ data: { articleId: req.params.id, version: (latest?.version || 0) + 1, content, changeNote: req.body.changeNote || null, authorId: req.user!.userId } }); }
    res.json(await prisma.knowledgeBaseArticle.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});

// Categories
kbRouter.get("/categories", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.kBCategory.findMany({ orderBy: { sortOrder: "asc" }, include: { children: true } })); }
  catch (e) { next(e); }
});

kbRouter.post("/categories", async (req: AuthRequest, res, next) => {
  try { const c = await prisma.kBCategory.create({ data: { name: req.body.name, slug: req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: req.body.description || null, parentId: req.body.parentId || null, sortOrder: req.body.sortOrder || 0 } }); res.status(201).json(c); }
  catch (e) { next(e); }
});
