import { prisma } from "../../index";
import type { PatternResult } from "./types";

/**
 * Detect recurring problems, emerging trends, SLA risks by analyzing ticket data over time windows.
 */
export async function detectPatterns(boardId?: string): Promise<PatternResult[]> {
  const results: PatternResult[] = [];

  // 1. Recurring issues: same category/subject appearing 3+ times in 30 days
  const recurring = await prisma.$queryRawUnsafe<Array<{ titlePattern: string; count: bigint; sampleIds: string; category: string }>>(
    `SELECT LEFT(title, 60) AS "titlePattern", COUNT(*)::bigint AS count,
            STRING_AGG(id::text, ',' ORDER BY "createdAt" DESC) AS "sampleIds",
            COALESCE(MIN("categoryId"::text), 'unknown') AS category
     FROM "Ticket"
     WHERE "createdAt" > NOW() - INTERVAL '30 days'
     GROUP BY LEFT(title, 60)
     HAVING COUNT(*) >= 3
     ORDER BY count DESC LIMIT 10`
  );
  for (const row of recurring) {
    results.push({
      name: `Recurring: ${row.titlePattern}...`,
      description: `${row.count} tickets with similar titles in the past 30 days`,
      category: "recurring_issue",
      severity: Number(row.count) >= 5 ? "high" : Number(row.count) >= 3 ? "medium" : "low",
      affectedTicketIds: row.sampleIds.split(",").slice(0, 20),
      metrics: { totalOccurrences: Number(row.count), period: "30d", sampleIds: row.sampleIds },
      timeframe: "30 days",
    });
  }

  // 2. SLA risk: tickets past due grouped by board
  const slaRisks = await prisma.$queryRawUnsafe<Array<{ boardId: string; boardName: string; overdueCount: bigint; worstTicketId: string }>>(
    `SELECT t."boardId", sb.name AS "boardName", COUNT(*)::bigint AS "overdueCount",
            (SELECT t2.id::text FROM "Ticket" t2 WHERE t2."boardId" = t."boardId" AND t2."dueDate" < NOW() AND t2.status NOT IN ('resolved','closed','cancelled') ORDER BY t2."dueDate" ASC LIMIT 1) AS "worstTicketId"
     FROM "Ticket" t JOIN "ServiceBoard" sb ON t."boardId" = sb.id
     WHERE t."dueDate" < NOW() AND t.status NOT IN ('resolved','closed','cancelled')
     GROUP BY t."boardId", sb.name
     HAVING COUNT(*) >= 5
     ORDER BY "overdueCount" DESC LIMIT 5`
  );
  for (const row of slaRisks) {
    results.push({
      name: `SLA Risk: ${row.boardName} has ${row.overdueCount} overdue tickets`,
      description: `Board ${row.boardName} has ${row.overdueCount} tickets past due date. Consider resource adjustment.`,
      category: "sla_risk",
      severity: Number(row.overdueCount) >= 20 ? "critical" : Number(row.overdueCount) >= 10 ? "high" : "medium",
      affectedTicketIds: [row.worstTicketId],
      metrics: { boardId: row.boardId, overdueCount: Number(row.overdueCount) },
      timeframe: "current",
    });
  }

  // 3. Knowledge gaps: categories with high reopen rates
  const gaps = await prisma.$queryRawUnsafe<Array<{ categoryId: string; total: bigint; reopened: bigint; sampleId: string }>>(
    `SELECT COALESCE("categoryId", 'uncategorized') AS "categoryId", COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE status = 'resolved' AND "resolvedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "TicketNote" tn WHERE tn."ticketId" = "Ticket".id AND tn.content ILIKE '%reopen%'))::bigint AS reopened,
            MIN(id::text) AS "sampleId"
     FROM "Ticket" WHERE "createdAt" > NOW() - INTERVAL '60 days'
     GROUP BY "categoryId"
     HAVING COUNT(*) >= 5
        AND COUNT(*) FILTER (WHERE status = 'resolved' AND "resolvedAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "TicketNote" tn WHERE tn."ticketId" = "Ticket".id AND tn.content ILIKE '%reopen%')) > 0
     ORDER BY reopened DESC LIMIT 5`
  );
  for (const row of gaps) {
    results.push({
      name: `Knowledge Gap: Category ${row.categoryId} — ${Number(row.reopened)}/${Number(row.total)} tickets reopened`,
      description: `High reopen rate suggests documentation or training gaps in this category.`,
      category: "knowledge_gap",
      severity: (Number(row.reopened) / Number(row.total)) > 0.3 ? "high" : "medium",
      affectedTicketIds: [row.sampleId],
      metrics: { categoryId: row.categoryId, total: Number(row.total), reopened: Number(row.reopened), reopenRate: Number(row.reopened) / Number(row.total) },
      timeframe: "60 days",
    });
  }

  return results;
}
