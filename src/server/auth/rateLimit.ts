// In-memory token bucket rate limiter for the login form (docs/ARCHITECTURE.md §9.4:
// "Login rate-limited (5/min)"). A module-level Map is fine at family scale — this is
// a single-process Next.js app, not a fleet (docs/workpackages/WP-03 §2).

const BUCKET_CAPACITY = 5;
const REFILL_WINDOW_MS = 60_000; // 5 tokens refill fully over 1 minute

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Attempts to consume one token for `key` (typically the client IP). Returns false
 * when the bucket is empty (rate limited). Continuous refill, not a fixed window:
 * tokens regenerate proportionally to elapsed time since the last check.
 */
export function consumeToken(key: string): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: BUCKET_CAPACITY, updatedAt: now };

  const elapsedMs = now - bucket.updatedAt;
  const refill = (elapsedMs / REFILL_WINDOW_MS) * BUCKET_CAPACITY;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

/** Test-only: clears all buckets so unit tests don't leak state across cases. */
export function __resetRateLimiterForTests(): void {
  buckets.clear();
}
