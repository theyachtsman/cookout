import type { NextFunction, Request, Response } from "express";

/**
 * Dependency-free sliding-window rate limiter, keyed per client IP (uses
 * CF-Connecting-IP behind Cloudflare). In-memory is correct here: limits are
 * per-process protections, and the API runs as one process per box.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

// Sweep stale buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 60_000).unref?.();

export function clientIp(req: Request): string {
  return (
    (req.headers["cf-connecting-ip"] as string) ??
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown"
  );
}

export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // RATE_LIMIT=0 disables limits for bot-swarm rehearsals (single-IP load).
    if (process.env.RATE_LIMIT === "0") {
      next();
      return;
    }
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.setHeader("Retry-After", Math.ceil((b.resetAt - now) / 1000));
      res.status(429).json({ error: "slow down — rate limit hit" });
      return;
    }
    next();
  };
}
