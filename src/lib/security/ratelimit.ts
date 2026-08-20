// In-memory token bucket rate limiter.
// ponytail: single-instance ceiling — buckets live in this process only; swap
// for Redis (same consume() contract) when running multiple instances.
//
// Two layers:
//  - per-key bucket (key = client IP; NEVER anything the client can mint
//    freely, like a sessionId — a fresh id must not grant a fresh bucket)
//  - one global bucket over ALL requests as a spend backstop, so header
//    spoofing on a direct-exposed deployment cannot multiply provider cost
//    beyond GLOBAL_FACTOR × RATE_LIMIT_RPM.

import { config } from '@/lib/config';

interface Bucket {
  tokens: number;
  last: number; // ms timestamp of last refill
}

const GLOBAL_FACTOR = 10;
const buckets = new Map<string, Bucket>();
let globalBucket: Bucket | null = null;

function take(b: Bucket, capacity: number, now: number): { allowed: boolean; retryAfterSec?: number } {
  const ratePerMs = capacity / 60_000; // continuous refill
  b.tokens = Math.min(capacity, b.tokens + Math.max(0, now - b.last) * ratePerMs); // clamp: clock steps back must not lock clients out
  b.last = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true };
  }
  return { allowed: false, retryAfterSec: Math.ceil((1 - b.tokens) / ratePerMs / 1000) };
}

export function consume(key: string): { allowed: boolean; retryAfterSec?: number } {
  const capacity = config().RATE_LIMIT_RPM;
  const now = Date.now();

  // cheap sweep so the map cannot grow unbounded under key churn
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.last > 120_000) buckets.delete(k);
  }

  // per-key bucket FIRST: a client the per-IP limiter rejects must not burn a
  // global token, otherwise one throttled attacker drains the shared backstop
  // and 429s everyone (availability DoS). Only a request that passes its own
  // bucket may consume from the global spend backstop.
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, last: now };
    buckets.set(key, b);
  }
  const perKey = take(b, capacity, now);
  if (!perKey.allowed) return perKey;

  if (!globalBucket) globalBucket = { tokens: capacity * GLOBAL_FACTOR, last: now };
  const g = take(globalBucket, capacity * GLOBAL_FACTOR, now);
  return g.allowed ? perKey : g;
}

export function resetForTests(): void {
  buckets.clear();
  globalBucket = null;
}
