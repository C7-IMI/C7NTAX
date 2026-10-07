import type { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger";

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const status = (err as { status?: number }).status || 500;

  logger.error(`express.${req.method}.${req.path}`, err, {
    status,
    method: req.method,
    path: req.path,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.get("User-Agent")?.slice(0, 200) || "unknown",
  });

  res.status(status).json({
    error: {
      message: status === 500 ? "Internal server error" : err.message,
      status,
      // A refusal that names only the first problem is not actionable for a client that wants to show
      // all of them; `details` carries the list when the thrown error has one.
      ...((err as { details?: unknown }).details ? { details: (err as { details?: unknown }).details } : {}),
    },
  });
}

export class AppError extends Error {
  status: number;
  /** Extra structured information a client can act on, such as a list of validation problems. */
  details?: unknown;
  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
