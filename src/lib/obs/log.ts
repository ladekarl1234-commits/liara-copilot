// Structured JSON logger: one JSON object per line on stdout.
// Secret-named fields are stripped at every depth, defensively.

import type { RequestMetrics } from '@/types';

type Level = 'info' | 'warn' | 'error';

const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'ai_api_key', 'authorization', 'token', 'secret',
  'password', 'credential', 'cookie', 'set-cookie',
]);

function replacer(key: string, value: unknown): unknown {
  return SECRET_KEYS.has(key.toLowerCase().replace(/-/g, '_')) ? undefined : value;
}

export function log(level: Level, event: string, fields?: Record<string, unknown>): void {
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
  log('info', 'request_metrics', { ...m });
}
