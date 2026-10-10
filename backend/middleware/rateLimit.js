// Tiny in-memory rate limiter (no external deps). Tracks request counts per
// client IP in a fixed window — enough to blunt brute-force and abuse without
// needing Redis or another service.
//
// Set RATE_LIMIT_DISABLED=true to bypass it entirely (the test suite does —
// it builds the app in-process and would otherwise trip shared windows).
const rateLimit = ({ windowMs = 15 * 60 * 1000, max = 100 } = {}) => {
  const hits = new Map(); // ip -> { count, resetAt }

  return (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next();

    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
      // Keep the map bounded: sweep expired buckets when it grows large.
      if (hits.size > 5000) {
        for (const [ip, e] of hits) if (now > e.resetAt) hits.delete(ip);
      }
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ message: 'Too many requests, try again later' });
    }
    next();
  };
};

module.exports = { rateLimit };
