/**
 * Branding — the API behind the settings that decide what the company's documents and messages look
 * like.
 *
 * A surface of its own rather than a corner of Administration or the Email Studio, because it is
 * neither: the logo, the letterhead, the colours and the footer are inherited by every report, PDF,
 * invoice, statement, ticket sheet and email this instance produces. The Email Studio keeps its own
 * `/email/brand` view of the same record, through the same service functions, so the two screens can
 * disagree about *wording* but never about the logo.
 *
 * **The asset route is deliberately unauthenticated** and is registered before `authenticate` below.
 * A logo has to be fetchable by the mail client of somebody who has no session here — it is an image in
 * an email, and an authenticated image is a broken image in every inbox outside this building. What
 * makes that safe is that assets are addressed by an opaque id and served from the database, so there is
 * no filename to trust and no directory to escape.
 */

import { Router } from "express";
import { prisma } from "../index";
import {
  DOCUMENT_FAMILIES,
  DOCUMENT_FAMILY_LABELS,
  Permission,
  contrastRatio,
  DOCUMENT_MARK_MIN_CONTRAST,
  DOCUMENT_PALETTE,
} from "@C7NTAX/shared";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  brandKitDto,
  loadBrand,
  loadCompanyOverride,
  loadReportPresentation,
  listReportPresentations,
  presentationFor,
  putBrandAsset,
  readBrandAsset,
  saveBrandKit,
  saveCompanyOverride,
  saveReportPresentation,
} from "../services/brand";

export const brandRouter = Router();

/**
 * An uploaded logo, icon or dark-mode logo.
 *
 * Public by necessity (see the file header) and immutable by construction: a new upload is a new id, so
 * the long cache can never serve a stale mark.
 */
brandRouter.get("/asset/:id", async (req, res, next) => {
  try {
    const asset = await readBrandAsset(req.params.id ?? "");
    if (!asset) throw new AppError("That image is not here", 404);
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    /*
     * `cross-origin`, against helmet's `same-origin` default, and it is required rather than generous:
     * the document this logo appears on is fetched from this API and then rendered by the *web app*, so
     * the image is cross-origin by construction and `same-origin` blocks it (the browser reports
     * `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`) — a broken logo on an invoice, which is the one thing
     * this route exists to prevent. The asset is a brand mark, not a document: it is addressed by an
     * opaque id, it is already public by nature, and nothing about it is secret.
     */
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(asset.bytes);
  } catch (e) { next(e); }
});

brandRouter.use(authenticate);

/** What a document of one family wears, and whether anybody has changed it from the default. */
function familyRow(family: (typeof DOCUMENT_FAMILIES)[number], stored: unknown) {
  const presentation = presentationFor(family, stored);
  const changed = JSON.stringify(presentation) !== JSON.stringify(presentationFor(family, null));
  return { family, ...DOCUMENT_FAMILY_LABELS[family], presentation, changed };
}

/**
 * The brand, and everything a settings screen needs to draw it.
 *
 * One read rather than four, because the four subjects of the Branding section are four views of this
 * one record: the identity, what each family of document wears, the client overrides and the reports
 * that differ. `contrast` is included for the two colours a person can set, so the screen can say a
 * choice will not survive paper *before* somebody prints an invoice with it.
 */
brandRouter.get("/", requirePermission(Permission.BrandingView), async (_req, res, next) => {
  try {
    const kit = await brandKitDto();
    res.json({
      ...kit,
      documents: DOCUMENT_FAMILIES.map((family) => familyRow(family, kit.documentPresentation)),
      /** The fixed document palette, so the settings screen can draw a true preview. */
      palette: DOCUMENT_PALETTE,
      contrast: {
        primary: contrastRatio(kit.primaryColor, DOCUMENT_PALETTE.paper),
        accent: contrastRatio(kit.accentColor, DOCUMENT_PALETTE.paper),
        minimum: DOCUMENT_MARK_MIN_CONTRAST,
      },
    });
  } catch (e) { next(e); }
});

brandRouter.put("/", requirePermission(Permission.BrandingManage), async (req: AuthRequest, res, next) => {
  try {
    const before = await brandKitDto();
    const after = await saveBrandKit((req.body ?? {}) as Record<string, unknown>, req.user!.userId);
    await record(req, "brand.updated", "brand", {
      companyName: [before.companyName, after.companyName],
      logo: [before.logoUrl, after.logoUrl],
      icon: [before.iconUrl, after.iconUrl],
      primaryColor: [before.primaryColor, after.primaryColor],
    });
    const kit = await loadBrand();
    res.json({
      ...after,
      documents: DOCUMENT_FAMILIES.map((family) => familyRow(family, after.documentPresentation)),
      resolved: {
        company: kit.companyName,
        wordmark: kit.wordmark ?? kit.productName,
        primaryColor: kit.primaryColor,
      },
    });
  } catch (e) { next(e); }
});

/** An upload, as the data URL a browser's FileReader produces. */
brandRouter.post("/assets", requirePermission(Permission.BrandingManage), async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const asset = await putBrandAsset(body.kind, body.dataUrl, req.user!.userId);
    await record(req, "brand.asset_uploaded", asset.id, { kind: body.kind, byteSize: asset.byteSize });
    res.status(201).json(asset);
  } catch (e) { next(e); }
});

/** The clients that may wear their own brand on the documents addressed to them. */
brandRouter.get("/clients", requirePermission(Permission.BrandingView), async (_req, res, next) => {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true, legalName: true, brandOverride: true, portalLogoUrl: true, portalAccentColor: true },
      orderBy: { name: "asc" },
    });
    res.json({
      clients: await Promise.all(companies.map(async (company) => {
        const override = await loadCompanyOverride(company.id);
        return {
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          override,
          /**
           * Where an override with no logo of its own is coming from. Said explicitly, because a screen
           * showing a logo it did not draw would otherwise be a mystery.
           */
          inheritedLogo: override?.logoUrl && override.logoUrl === company.portalLogoUrl ? "portal" : null,
        };
      })),
    });
  } catch (e) { next(e); }
});

brandRouter.put("/clients/:companyId", requirePermission(Permission.BrandingManage), async (req: AuthRequest, res, next) => {
  try {
    const saved = await saveCompanyOverride(req.params.companyId ?? "", req.body);
    await record(req, "brand.client_override", req.params.companyId ?? "", {
      client: (req.body as Record<string, unknown>)?.companyName ?? null,
      cleared: saved === null,
    });
    res.json({ override: saved });
  } catch (e) { next(e); }
});

/**
 * The reports whose presentation differs from the family default.
 *
 * Only the rows that exist: the catalogue of reports is code, and the settings screen already holds it,
 * so returning a stubbed row per report would be inventing content that a person could then "reset".
 */
brandRouter.get("/reports", requirePermission(Permission.BrandingView), async (_req, res, next) => {
  try {
    res.json({ reports: await listReportPresentations() });
  } catch (e) { next(e); }
});

brandRouter.put("/reports/:reportKey", requirePermission(Permission.BrandingManage), async (req: AuthRequest, res, next) => {
  try {
    const saved = await saveReportPresentation(req.params.reportKey ?? "", req.body, req.user!.userId);
    await record(req, "brand.report_presentation", req.params.reportKey ?? "", { cleared: saved === null });
    res.json({ report: saved ?? (await loadReportPresentation(req.params.reportKey ?? "")) });
  } catch (e) { next(e); }
});

/** Brand changes are words a customer reads and a document a customer keeps: they belong in the trail. */
async function record(req: AuthRequest, action: string, entityId: string, changes: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity: "brand",
        entityId: String(entityId).slice(0, 200),
        changes: changes as never,
        userId: req.user!.userId,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
  } catch { /* the change was made either way; an audit write must not fail the action it records */ }
}
