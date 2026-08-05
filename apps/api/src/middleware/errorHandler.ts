import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[API Error]", err.message, err.stack?.split("\n")[1]);
  const status = (err as { status?: number }).status || 500;
  res.status(status).json({
    error: { message: err.message, status },
  });
}

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
