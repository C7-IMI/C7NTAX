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
    error: { message: status === 500 ? "Internal server error" : err.message, status },
  });
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
