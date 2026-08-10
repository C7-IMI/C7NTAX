import { Router } from "express";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";

export const kumoRouter = Router();
kumoRouter.use(authenticate);

// ── Assets ──────────────────────────────────────────────────────────
kumoRouter.get("/assets", requirePermission(Permission.KumoAssetView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo assets — Phase 2" });
});

// ── Templates ───────────────────────────────────────────────────────
kumoRouter.get("/templates", requirePermission(Permission.KumoAssetView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo templates — Phase 2" });
});

// ── Passwords ───────────────────────────────────────────────────────
kumoRouter.get("/passwords", requirePermission(Permission.KumoPasswordsView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo passwords — Phase 3" });
});

// ── Standard Configs ────────────────────────────────────────────────
kumoRouter.get("/configs/servers", requirePermission(Permission.KumoConfigView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo configs — Phase 4" });
});

// ── Documents ───────────────────────────────────────────────────────
kumoRouter.get("/documents", requirePermission(Permission.KumoDocumentView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo documents — Phase 5" });
});

// ── Links ───────────────────────────────────────────────────────────
kumoRouter.get("/links", requirePermission(Permission.KumoLinkView), async (_req: AuthRequest, res) => {
  res.json({ data: [], message: "Kumo links — Phase 4" });
});

// ── Dashboard ───────────────────────────────────────────────────────
kumoRouter.get("/dashboard", requirePermission(Permission.KumoView), async (_req: AuthRequest, res) => {
  res.json({
    assets: 0,
    passwords: 0,
    configs: 0,
    documents: 0,
    links: 0,
    message: "Kumo dashboard — Phase 1 scaffold",
  });
});
