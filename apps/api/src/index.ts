import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { PrismaClient } from "@prisma/client";
import { createServer } from "http";

// ── Crash guard — prevent EPIPE and other unhandled errors from killing the process ──
process.on("uncaughtException", (err) => {
  if ((err as any)?.code === "EPIPE" || (err as any)?.syscall === "write") {
    console.error("[CRASH-GUARD] Suppressed EPIPE:", err.message);
    return; // do NOT exit
  }
  console.error("[CRASH-GUARD] Uncaught exception:", err.message, err.stack?.split("\n")[1]);
  // Log to file but don't crash
  try { require("fs").appendFileSync("crash.log", `${new Date().toISOString()} ${err.message}\n`); } catch {}
});
process.on("unhandledRejection", (reason) => {
  console.error("[CRASH-GUARD] Unhandled rejection:", reason);
});
import { errorHandler } from "./middleware/errorHandler";
import { rateLimiter } from "./middleware/rateLimiter";
import { autoSnapshotMiddleware } from "./services/autoSnapshot";
import { logger } from "./services/logger";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { rolesRouter } from "./routes/roles";
import { ticketsRouter } from "./routes/tickets";
import { boardsRouter } from "./routes/boards";
import { clientsRouter } from "./routes/clients";
import { billingRouter } from "./routes/billing";
import { cloudConnectRouter } from "./routes/cloudconnect";
import { crmRouter } from "./routes/crm";
import { projectsRouter } from "./routes/projects";
import { scheduleRouter } from "./routes/schedule";
import { inventoryRouter } from "./routes/inventory";
import { contractsRouter } from "./routes/contracts";
import { procurementRouter } from "./routes/procurement";
import { ptoRouter } from "./routes/pto";
import { surveysRouter } from "./routes/surveys";
import { kbRouter } from "./routes/kb";
import { chatRouter } from "./routes/chat";
import { workflowsRouter } from "./routes/workflows";
import { reportsRouter } from "./routes/reports";
import { ssoRouter } from "./routes/sso";
import { systemRouter } from "./routes/system";
import { bulkRouter } from "./routes/bulk";
import { inferenceRouter } from "./routes/inference";
import { kumoRouter } from "./routes/kumo";
import { alertsRouter } from "./routes/alerts";
import { serviceAlertsRouter } from "./routes/serviceAlerts";
import { emailConnectorsRouter } from "./routes/email-connectors";
import { setupWebSocket } from "./ws";
import { WEB_ORIGIN } from "@C7NTAX/shared";
import { startWorkers } from "./worker";
// ── Startup logging ─────────────────────────────────────────────────
logger.startup();

export const prisma = new PrismaClient();
export const app = express();

// TOKEN-SAVE-09: gzip-compress JSON responses (smaller dev payloads) + weak ETags
// Buffered compression: capture the full body, gzip once, then end the
// response with the compressed bytes. A streaming pipe implementation
// truncated bodies because the response could end before the zlib stream
// flushed (broke login tokens / JSON parsing in browsers).
import zlib from "zlib";
app.set("etag", "weak");
app.use((req, res, next) => {
  if (req.method === "HEAD") return next();
  const accept = String(req.headers["accept-encoding"] || "");
  if (!accept.includes("gzip")) return next();
  const chunks: Buffer[] = [];
  const rawEnd = res.end.bind(res);
  (res as any).write = (chunk: any) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  (res as any).end = (chunk?: any, ...args: any[]) => {
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
    const body = Buffer.concat(chunks);
    const compressible = res.statusCode !== 204 && res.statusCode !== 304 && body.length > 0;
    if (!compressible) {
      rawEnd();
      if (cb) cb();
      return;
    }
    zlib.gzip(body, (err, compressed) => {
      if (err) return rawEnd(body, cb);
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(compressed.length));
      const vary = res.getHeader("Vary");
      res.setHeader("Vary", (vary ? String(vary) + ", " : "") + "Accept-Encoding");
      rawEnd(compressed, cb);
    });
  };
  next();
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || WEB_ORIGIN, credentials: true }));
// Morgan HTTP logging piped to dev-errors.log
// TOKEN-SAVE-01: skip unauthenticated health/poller probes (401 spam)
const QUIET_POLL_PATHS = [
  "/api/auth/login", "/api/tickets", "/api/clients",
  "/api/users", "/api/billing/invoices", "/api/boards",
];
app.use(morgan("short", {
  skip: (req) => !req.headers.authorization && QUIET_POLL_PATHS.includes(req.path),
  stream: {
    write: (message: string) => logger.info("http", message.trim()),
  },
}));
app.use(rateLimiter(9999, 60 * 1000));
app.use(express.json({ limit: "10mb" }));

// Auto-capture snapshots after any successful write (debounced 5s)
// Must be BEFORE routes so it hooks into response finish events
app.use(autoSnapshotMiddleware);

// Audit logging — logs every create/update/delete operation
import { auditMiddleware } from "./middleware/auditLog";
app.use(auditMiddleware);

app.get("/api/health", (_req, res) => res.json({ status: "ok", version: "1.0.0" }));

// Core routes
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/boards", boardsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/cloudconnect", cloudConnectRouter);

// New feature routes
app.use("/api/crm", crmRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/schedule", scheduleRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/contracts", contractsRouter);
app.use("/api/procurement", procurementRouter);
app.use("/api/pto", ptoRouter);
app.use("/api/surveys", surveysRouter);
app.use("/api/kb", kbRouter);
app.use("/api/chat", chatRouter);
app.use("/api/workflows", workflowsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/sso", ssoRouter);
app.use("/api/system", systemRouter);
app.use("/api/bulk", bulkRouter);
app.use("/api/inference", inferenceRouter);
app.use("/api/kumo", kumoRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/service-alerts", serviceAlertsRouter);
app.use("/api/email-connectors", emailConnectorsRouter);

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;
const server = createServer(app);
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`[C7NTAX] API running on port ${PORT}`);
  logger.info("server", `API listening on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  startWorkers();
  import("./services/poller").then(p => p.startPoller()).catch(() => {});
  import("./services/snapshotPoller").then(p => p.startSnapshotPoller()).catch(() => {});
  import("./services/alertMonitor").then(p => p.startAlertMonitor()).catch(() => {});
  import("./services/emailConnectorRuntime").then(r => r.hydrateEmailConnectors()).catch(() => {});
});

export default app;
