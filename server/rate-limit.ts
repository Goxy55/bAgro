import type { Request, Response, NextFunction } from "express";

/**
 * Jednostavan prozor-brojač u memoriji, po korisniku (ili IP-u). Dovoljan za
 * jednu instancu; za više instanci potreban je zajednički (npr. Redis) limit.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  now?: () => number;
}) {
  const hits = new Map<string, { count: number; reset: number }>();
  const now = options.now ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    if (hits.size > 5000)
      for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    const key = (req as any).user?.id || req.ip || "anonymous";
    let h = hits.get(key);
    if (!h || h.reset <= t) {
      h = { count: 0, reset: t + options.windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (h.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - t) / 1000)));
      return res
        .status(429)
        .json({
          error: "Previše zahteva. Pokušajte ponovo za nekoliko trenutaka.",
        });
    }
    next();
  };
}
