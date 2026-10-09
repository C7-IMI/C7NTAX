-- The brand kit stops being an email setting.
--
-- `EmailBrandKit` is renamed rather than extended, because the name is now the wrong answer to "what
-- draws the letterhead on an invoice". Nothing about the row changes in meaning: it was already the
-- instance's identity, and the Email Studio was simply the only place that could see it. The rename is
-- the whole point — a table called `EmailBrandKit` that draws invoices is a lie that costs somebody an
-- afternoon the first time they go looking for the logo setting.
--
-- The columns added are the ones a *document* needs and an email did not: a tagline, the square icon as
-- opposed to the lockup, the contact details as they should read on paper, a website, the sentence at
-- the foot of a generated page, and the per-family presentation (paper size, orientation, letterhead,
-- footer, page numbers, the basis block).
--
-- Every one of them is nullable or defaulted, so an instance that never opens the new settings renders
-- exactly the documents it rendered before this migration existed. `BrandAsset` stores uploaded logos as
-- bytes rather than files, so the route that serves them needs no session (a mail client has none) and
-- has no path to escape. `ReportPresentation` is what makes a shipped report's *appearance* editable
-- while its figures stay in code.

-- RenameTable
ALTER TABLE "EmailBrandKit" RENAME TO "BrandKit";

-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN "tagline" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "iconUrl" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "contactLine" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "addressLines" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "BrandKit" ADD COLUMN "website" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "documentFooter" TEXT;
ALTER TABLE "BrandKit" ADD COLUMN "documentPresentation" JSONB;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "brandOverride" JSONB;

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportPresentation" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "presentation" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportPresentation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportPresentation_reportKey_key" ON "ReportPresentation"("reportKey");
