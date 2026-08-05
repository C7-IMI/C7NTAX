import type { Request, Response, NextFunction } from "express";

/** Token bucket rate limiter — per-IP sliding window, 100 req / 15 min */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimiter(maxReqs = 100, windowMs = 15 * 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    res.setHeader("X-RateLimit-Limit", maxReqs);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxReqs - bucket.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > maxReqs) {
      res.status(429).json({ error: "Too many requests", retryAfter: Math.ceil((bucket.resetAt - now) / 1000) });
      return;
    }
    next();
  };
}

// Cleanup stale buckets every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) { if (now > v.resetAt) buckets.delete(k); }
}, 30 * 60 * 1000);
