/**
 * Knowledge base articles drafted from resolved tickets (PLAN-015 Phase B #11).
 *
 * The knowledge that leaves with the person who solved the ticket is the expensive kind, and the
 * tickets that carry it are already in the database. This drafts an article from one of them and
 * files it as a **draft** with the ticket it came from attached.
 *
 * Three rules, because an AI-authored article in a knowledge base is a claim on the reader's time:
 *   - nothing is ever published directly; a human publishes, edits or discards it;
 *   - the draft says it was machine-written and which ticket it came from, so it can be checked;
 *   - the prompt is built from resolved material only — the internal notes are what a technician
 *     wrote *after* solving it, capped, and truncated on a word boundary so a prompt never ends
 *     mid-sentence and invites an invention.
 */
import { prisma } from "../index";
import { llmJsonCompletion } from "./inference/LlmProvider";
import { logger } from "./logger";
import { configFlag } from "./appSettings";

export interface KbDraft {
  title: string;
  summary: string;
  symptoms?: string[];
  steps?: string[];
  tags?: string[];
}

export interface DraftResult {
  ok: boolean;
  article?: { id: string; title: string; slug: string; status: string; aiGenerated: boolean };
  reason?: string;
  tokensUsed?: number;
}

const MAX_TICKET_CHARS = 6000;

export function autogenEnabled(): boolean {
  return configFlag("knowledge", "autoDraft");
}

/** Truncates on a word boundary so the prompt never trails off mid-thought. */
function capped(text: string, limit = MAX_TICKET_CHARS): string {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return (lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut) + "\n[truncated]";
}

export function buildPrompt(input: { ticketNumber: string; title: string; description: string; resolution: string; clientName: string | null }): string {
  return `You are writing a knowledge base article for an MSP service desk, from a ticket that has been solved.

TICKET ${input.ticketNumber}
Client: ${input.clientName || "an internal issue"}
Title: ${input.title}
Reported problem: ${input.description || "No description was recorded"}

Resolution work recorded by the technician:
${input.resolution || "No resolution notes were recorded"}

Write an article a different technician can follow next time. Respond with JSON only:
{
  "title": "a specific, searchable title — the symptom, not the product brochure",
  "summary": "one or two sentences on the cause",
  "symptoms": ["what the user reports", "..."],
  "steps": ["concrete step", "..."],
  "tags": ["a few search keywords"]
}
Use only what the ticket supports. If the resolution notes do not explain the fix, say so in "summary" rather than inventing a cause.`;
}

/** The ticket material the prompt is built from: description, customer-visible notes, internal notes. */
export async function ticketMaterial(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      company: { select: { name: true } },
      comments: { orderBy: { createdAt: "asc" }, select: { body: true, isInternal: true } },
      timeEntries: { select: { description: true, minutes: true }, take: 20 },
    },
  });
  if (!ticket) return null;
  const resolution = [
    ...ticket.comments.map(c => `${c.isInternal ? "[internal] " : ""}${c.body}`),
    ...ticket.timeEntries.filter(t => t.description).map(t => `[work] ${t.description}`),
  ].join("\n");
  return { ticket, resolution };
}

/**
 * Drafts an article and files it. `userId` is who asked for it, and becomes the article's author so
 * the draft is not attributed to nobody; the ticket id rides along so the claim can be checked.
 */
export async function draftArticleFromTicket(ticketId: string, userId: string): Promise<DraftResult> {
  if (!autogenEnabled()) return { ok: false, reason: "KB auto-generation is switched off" };

  const material = await ticketMaterial(ticketId);
  if (!material) return { ok: false, reason: "Ticket not found" };
  const { ticket, resolution } = material;

  // A ticket with nothing recorded can only produce an invented article.
  if (!ticket.description && resolution.trim().length < 40) {
    return { ok: false, reason: "The ticket has too little recorded on it to learn from" };
  }

  const existing = await prisma.knowledgeBaseArticle.findFirst({ where: { sourceTicketId: ticketId, aiGenerated: true }, select: { id: true } });
  if (existing) return { ok: false, reason: "An article has already been drafted from this ticket", article: existing as never };

  const completion = await llmJsonCompletion<KbDraft>(buildPrompt({
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    description: capped(ticket.description || ""),
    resolution: capped(resolution),
    clientName: ticket.company?.name ?? null,
  }), { maxTokens: 1200, temperature: 0.2 });

  if (!completion?.data?.title) return { ok: false, reason: "The model did not return a usable draft" };
  const draft = completion.data;

  const content = [
    draft.summary ? `## Summary\n${draft.summary}` : "",
    draft.symptoms?.length ? `## Symptoms\n${draft.symptoms.map(s => `- ${s}`).join("\n")}` : "",
    draft.steps?.length ? `## Resolution\n${draft.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "",
    `---\nDrafted from ticket ${ticket.ticketNumber} on ${new Date().toISOString().slice(0, 10)} and needs a human review before it is published.`,
  ].filter(Boolean).join("\n\n");

  const slug = `${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-${Date.now().toString(36)}`;
  const article = await prisma.knowledgeBaseArticle.create({
    data: {
      title: draft.title.slice(0, 200),
      slug,
      content,
      excerpt: (draft.summary || "").slice(0, 300) || null,
      status: "draft",
      visibility: "internal",
      authorId: userId,
      tags: (draft.tags || []).slice(0, 8),
      aiGenerated: true,
      sourceTicketId: ticketId,
      reviewNote: `Drafted from ${ticket.ticketNumber}. Check the cause against what was actually done before publishing.`,
    },
    select: { id: true, title: true, slug: true, status: true, aiGenerated: true },
  });
  await prisma.kBArticleVersion.create({ data: { articleId: article.id, version: 1, content, authorId: userId, changeNote: "AI draft from ticket" } });
  logger.info("kb", `Drafted KB article "${article.title}" from ticket ${ticket.ticketNumber}`);
  return { ok: true, article, tokensUsed: completion.tokensUsed };
}

/**
 * The resolution trigger. A draft is a nice-to-have and must never be the reason a status change
 * fails, so a refusal (no provider, flag off, a model that answered nothing usable) is logged and
 * the ticket resolution stands.
 */
export async function draftArticleOnResolution(ticketId: string, userId: string): Promise<void> {
  try {
    const result = await draftArticleFromTicket(ticketId, userId);
    if (!result.ok) logger.info("kb", `No KB draft for ticket ${ticketId}: ${result.reason}`);
  } catch (err) {
    logger.warn("kb", `KB draft failed for ticket ${ticketId}: ${(err as Error).message}`);
  }
}
