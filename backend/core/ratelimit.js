
const buckets = new Map();


setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > 2 * 3600_000) buckets.delete(key);
  }
}, 10 * 60_000).unref();

export function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
    if (bucket.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - bucket.start)) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Slow down.' } });
    }
    next();
  };
}

export function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
