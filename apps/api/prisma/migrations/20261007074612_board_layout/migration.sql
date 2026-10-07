-- CreateTable
CREATE TABLE "BoardLayout" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "tiles" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardLayout_boardId_key" ON "BoardLayout"("boardId");

-- AddForeignKey
ALTER TABLE "BoardLayout" ADD CONSTRAINT "BoardLayout_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ServiceBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
