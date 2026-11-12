import rateLimit from "express-rate-limit";

export function createAuthenticatedRateLimit(limit: number, windowMs = 15 * 60_000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: req => req.userId ? `user:${req.userId}` : "unauthenticated",
    handler: (_req, res) => res.status(429).json({ error: "Too many requests. Please try again later." })
  });
}
