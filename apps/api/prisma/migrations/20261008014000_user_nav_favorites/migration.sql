-- CreateTable
CREATE TABLE "UserNavConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "favorites" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNavConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNavConfig_userId_key" ON "UserNavConfig"("userId");

-- AddForeignKey
ALTER TABLE "UserNavConfig" ADD CONSTRAINT "UserNavConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
