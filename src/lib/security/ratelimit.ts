// In-memory token bucket rate limiter, keyed by "ip|sessionId".
// ponytail: single-instance ceiling — buckets live in this process only; swap
// for Redis (same consume() contract) when running multiple instances.

import { config } from '@/lib/config';

interface Bucket {
  tokens: number;
  last: number; // ms timestamp of last refill
}

const buckets = new Map<string, Bucket>();

export function consume(key: string): { allowed: boolean; retryAfterSec?: number } {
  const capacity = config().RATE_LIMIT_RPM;
  const ratePerMs = capacity / 60_000; // continuous refill
  const now = Date.now();

  // cheap sweep so the map cannot grow unbounded under key churn
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.last > 120_000) buckets.delete(k);
  }

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(capacity, b.tokens + (now - b.last) * ratePerMs);
  b.last = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true };
  }
  return { allowed: false, retryAfterSec: Math.ceil((1 - b.tokens) / ratePerMs / 1000) };
}

export function resetForTests(): void {
  buckets.clear();
}
