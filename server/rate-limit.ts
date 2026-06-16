import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimitStore = Map<string, RateLimitBucket>;

export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitDecision {
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

function getClientKey(req: Request, scope: string): string {
  const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return `${scope}:${forwarded || req.ip || req.socket.remoteAddress || "unknown"}`;
}

export function createInMemoryRateLimiter(options: {
  scope: string;
  limit: number;
  windowMs: number;
  store?: RateLimitStore;
}) {
  const store = options.store || new Map<string, RateLimitBucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const decision = checkRateLimit(
      store,
      getClientKey(req, options.scope),
      options.limit,
      options.windowMs,
    );

    res.setHeader("X-RateLimit-Limit", String(options.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      res.status(429).json({ error: "Too many requests", reason: "rate_limited" });
      return;
    }

    next();
  };
}
