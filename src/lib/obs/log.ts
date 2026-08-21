// Structured JSON logger: one JSON object per line on stdout.
// Secret-named fields are stripped at every depth, defensively.

import type { RequestMetrics } from '@/types';
import { eventLoopLagP99Ms } from './loop-lag';

type Level = 'info' | 'warn' | 'error';

/**
 * Under vitest, drop `info` — request_metrics/chat_request lines from the route
 * and orchestrator suites buried the one assertion failure being looked for
 * (EP-MAINT-09). `warn`/`error` still print: they are what you want on a red
 * run, and two observability tests assert on them. LOG_IN_TESTS=1 restores
 * everything. Read per call, not once at import, so a test can flip it.
 */
function suppressed(level: Level): boolean {
  return level === 'info' && Boolean(process.env.VITEST) && process.env.LOG_IN_TESTS !== '1';
}

const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'ai_api_key', 'authorization', 'token', 'secret',
  'password', 'credential', 'cookie', 'set-cookie',
]);

function replacer(key: string, value: unknown): unknown {
  return SECRET_KEYS.has(key.toLowerCase().replace(/-/g, '_')) ? undefined : value;
}

export function log(level: Level, event: string, fields?: Record<string, unknown>): void {
  if (suppressed(level)) return;
  // ts/level/event last so fields cannot shadow them
  const entry = { ...fields, ts: new Date().toISOString(), level, event };
  try {
    console.log(JSON.stringify(entry, replacer));
  } catch {
    // circular or unserializable fields — keep the event, drop the fields
    console.log(JSON.stringify({ ts: entry.ts, level, event, note: 'fields dropped: unserializable' }));
  }
}

export function logMetrics(m: RequestMetrics): void {
  // The whole retrieval pipeline is synchronous CPU on one event loop, so the
  // cost it imposes on every OTHER in-flight SSE stream is queueing delay — and
  // nothing measured it (EP-SCALE-04). Measure before building a worker pool.
  log('info', 'request_metrics', { ...m, eventLoopLagP99Ms: eventLoopLagP99Ms() });
}
