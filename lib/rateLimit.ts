/**
 * Best-effort per-IP rate limit for public, unauthenticated routes (currently
 * just /api/demo-export). Vercel Functions can reuse warm instances across
 * requests (Fluid Compute) but nothing guarantees a given IP keeps hitting
 * the same instance, so this is a soft deterrent against casual abuse, not a
 * hard guarantee — acceptable for a portfolio demo with no real credentials
 * or external API behind it.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 5 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

// Bounds memory use for an instance that lives long enough to accumulate
// buckets for many distinct IPs — swept opportunistically rather than on a
// timer, since serverless instances can be frozen between invocations.
const MAX_TRACKED_KEYS = 500;

const buckets = new Map<string, Bucket>();

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSeconds?: number } {
  if (buckets.size > MAX_TRACKED_KEYS) sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}
