-- AlterTable
ALTER TABLE "KnowledgeBaseArticle" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "sourceTicketId" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeBaseArticle_aiGenerated_status_idx" ON "KnowledgeBaseArticle"("aiGenerated", "status");
