import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { draftArticleFromTicket, autogenEnabled } from "../services/kbAutogen";
import { isUnscoped } from "../middleware/companyScope";
export const kbRouter = Router(); kbRouter.use(authenticate);

// ── AI-drafted articles (PLAN-015 Phase B #11) ────────────────────────
/**
 * Drafts an article from a ticket. It always lands as a draft attributed to the caller with the
 * ticket attached; nothing here publishes.
 */
kbRouter.post("/autogen/:ticketId", requirePermission(Permission.KBCreate), async (req: AuthRequest, res, next) => {
  try {
    const result = await draftArticleFromTicket(String(req.params.ticketId), req.user!.userId);
    if (!result.ok) throw new AppError(result.reason || "Could not draft an article", 409);
    res.status(201).json({ article: result.article, tokensUsed: result.tokensUsed, enabled: autogenEnabled() });
  } catch (e) { next(e); }
});

/** The drafts waiting for a human, newest first. */
kbRouter.get("/drafts", requirePermission(Permission.KBView), async (req: AuthRequest, res, next) => {
  try {
    // A company-scoped account sees no drafts at all. `KBView` is held by client roles as well as
    // by staff, and a draft is by definition unpublished — with the review note and the ticket it
    // came from attached. Internal staff are unscoped and unaffected.
    if (!isUnscoped(req.user)) {
      res.json({ data: [], autogenEnabled: autogenEnabled() });
      return;
    }
    const drafts = await prisma.knowledgeBaseArticle.findMany({
      where: { status: "draft" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true, title: true, slug: true, excerpt: true, status: true, tags: true, aiGenerated: true,
        sourceTicketId: true, reviewNote: true, createdAt: true, updatedAt: true, authorId: true,
      },
    });
    res.json({ data: drafts, autogenEnabled: autogenEnabled() });
  } catch (e) { next(e); }
});

kbRouter.get("/", requirePermission(Permission.KBView), async (req: AuthRequest, res, next) => {
  try { const { search, categoryId, status, visibility, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const scoped = !isUnscoped(req.user);
    const where: Record<string, unknown> = { status: scoped ? "published" : status || "published" };
    if (categoryId) where.categoryId = categoryId;
    // A scoped account cannot ask for internal articles either: the query string is a request, and
    // `visibility=internal` would hand it the notes written for staff.
    if (scoped) where.visibility = { not: "internal" };
    else if (visibility) where.visibility = visibility;
    if (search) where.OR = [{ title: { contains: search } }, { content: { contains: search } }];
    const [data, total] = await Promise.all([prisma.knowledgeBaseArticle.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" }, select: { id: true, title: true, slug: true, excerpt: true, content: true, status: true, visibility: true, tags: true, viewCount: true, helpfulCount: true, updatedAt: true, authorId: true, categoryId: true, aiGenerated: true, sourceTicketId: true, reviewNote: true } }), prisma.knowledgeBaseArticle.count({ where })]);
    res.json({ data, total }); }
  catch (e) { next(e); }
});

kbRouter.post("/", requirePermission(Permission.KBCreate), async (req: AuthRequest, res, next) => {
  try { const slug = req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const article = await prisma.knowledgeBaseArticle.create({ data: { title: req.body.title, slug, content: req.body.content, excerpt: req.body.excerpt || null, status: req.body.status || "draft", visibility: req.body.visibility || "internal", categoryId: req.body.categoryId || null, authorId: req.user!.userId, tags: req.body.tags || [] } });
    await prisma.kBArticleVersion.create({ data: { articleId: article.id, version: 1, content: req.body.content, authorId: req.user!.userId } });
    res.status(201).json(article); }
  catch (e) { next(e); }
});

kbRouter.get("/categories", requirePermission(Permission.KBView), async (_req: AuthRequest, res, next) => {
  try {
    const categories = await prisma.kBCategory.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(categories.map(c => ({ ...c, children: categories.filter(x => x.parentId === c.id) })));
  }
  catch (e) { next(e); }
});

kbRouter.post("/categories", requirePermission(Permission.KBCreate), async (req: AuthRequest, res, next) => {
  try { const c = await prisma.kBCategory.create({ data: { name: req.body.name, slug: req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), description: req.body.description || null, parentId: req.body.parentId || null, sortOrder: req.body.sortOrder || 0 } }); res.status(201).json(c); }
  catch (e) { next(e); }
});

kbRouter.get("/:slug", requirePermission(Permission.KBView), async (req: AuthRequest, res, next) => {
  try { const article = await prisma.knowledgeBaseArticle.findUnique({ where: { slug: req.params.slug } });
    // An unpublished or internal article is not a client's to read, and 404 says the same thing as
    // it does for a slug that does not exist — a client does not learn that a draft exists.
    const visibleToScopedAccount = article?.status === "published" && article?.visibility !== "internal";
    if (!article || (!isUnscoped(req.user) && !visibleToScopedAccount)) throw new AppError("Not found", 404);
    const [author, category, versions, links] = await Promise.all([
      prisma.user.findUnique({ where: { id: article.authorId }, select: { firstName: true, lastName: true } }),
      article.categoryId ? prisma.kBCategory.findUnique({ where: { id: article.categoryId } }) : Promise.resolve(null),
      prisma.kBArticleVersion.findMany({ where: { articleId: article.id }, orderBy: { version: "desc" }, take: 5 }),
      prisma.kBArticleTicket.findMany({ where: { articleId: article.id } }),
    ]);
    const tickets = await prisma.ticket.findMany({ where: { id: { in: links.map(l => l.ticketId) } }, select: { id: true, ticketNumber: true, title: true } });
    const ticketById = new Map(tickets.map(t => [t.id, t]));
    await prisma.knowledgeBaseArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } });
    res.json({ ...article, author, category, versions, linkedTickets: links.map(l => ({ ...l, ticket: ticketById.get(l.ticketId) ?? null })) }); }
  catch (e) { next(e); }
});

// ── Discard a draft ───────────────────────────────────────────────────
/**
 * Only drafts can be deleted. A published article is knowledge somebody may already be relying on,
 * and "remove it" for those belongs in a deliberate archive flow rather than a button beside
 * Publish — which is exactly where an AI-drafted article lands when a reviewer rejects it.
 */
kbRouter.delete("/:id", requirePermission(Permission.KBEdit), async (req: AuthRequest, res, next) => {
  try {
    const article = await prisma.knowledgeBaseArticle.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
    if (!article) throw new AppError("Article not found", 404);
    if (article.status !== "draft") throw new AppError("Only a draft can be discarded; archive a published article instead", 409);
    await prisma.kBArticleVersion.deleteMany({ where: { articleId: article.id } });
    await prisma.knowledgeBaseArticle.delete({ where: { id: article.id } });
    res.json({ message: "Draft discarded" });
  } catch (e) { next(e); }
});

kbRouter.patch("/:id", requirePermission(Permission.KBEdit), async (req: AuthRequest, res, next) => {
  try { const { content, title, status, visibility, tags } = req.body;
    const updates: Record<string, unknown> = {};
    if (title) updates.title = title; if (status) updates.status = status; if (visibility) updates.visibility = visibility; if (tags) updates.tags = tags;
    if (content) { updates.content = content; const latest = await prisma.kBArticleVersion.findFirst({ where: { articleId: req.params.id }, orderBy: { version: "desc" } });
      await prisma.kBArticleVersion.create({ data: { articleId: req.params.id, version: (latest?.version || 0) + 1, content, changeNote: req.body.changeNote || null, authorId: req.user!.userId } }); }
    res.json(await prisma.knowledgeBaseArticle.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});
