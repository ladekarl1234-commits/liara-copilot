// Regression locks for the scale/observability panel findings owned by
// provider.ts / sessions.ts / obs/*:
//   EP-SCALE-01  unknown session id silently started a new conversation
//   EP-SCALE-04  no event-loop lag signal anywhere
//   EP-SCALE-05  /api/diag re-read and re-parsed the whole gaps.jsonl per request
//   EP-SCALE-07  429 retried on the normal backoff, ignoring Retry-After
//   EP-SCALE-12  concurrent gap appends could both rotate; file-only signal
//   EP-MAINT-09  info-level log noise buried assertion failures in test output

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, resetConfigForTests } from '@/lib/config';
import { OpenAICompatibleProvider, ModelError, retryAfterMs } from '@/lib/ai/provider';
import { getOrCreateSession, resetSessionsForTests } from '@/lib/state/sessions';
import { log, logMetrics } from '@/lib/obs/log';
import { eventLoopLagP99Ms } from '@/lib/obs/loop-lag';
import {
  recordGap,
  readGapSummary,
  flushGapsForTests,
  resetGapSummaryCacheForTests,
} from '@/lib/obs/gaps';

const ENV_KEYS = [
  'AI_BASE_URL', 'AI_API_KEY', 'MODEL_MAX_RETRIES', 'MODEL_CALL_BUDGET_MS',
  'MODEL_TIMEOUT_MS', 'RUNTIME_DIR', 'LOG_IN_TESTS',
];
let savedEnv: Record<string, string | undefined>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  resetConfigForTests();
  resetSessionsForTests();
  resetGapSummaryCacheForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetConfigForTests();
  globalThis.fetch = realFetch;
});

/** Capture the structured log sink for the duration of `fn`. */
async function captureLogs(fn: () => void | Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const real = console.log;
  console.log = (s: unknown) => {
    lines.push(String(s));
  };
  try {
    await fn();
  } finally {
    console.log = real;
  }
  return lines;
}

function provider(): OpenAICompatibleProvider {
  process.env.AI_BASE_URL = 'https://ai.example.com/v1';
  process.env.AI_API_KEY = 'k';
  resetConfigForTests();
  return new OpenAICompatibleProvider();
}

// ---------- EP-SCALE-07 ----------

describe('a rate-limited provider is not stormed (EP-SCALE-07)', () => {
  it('retries 429 at most once, not MODEL_MAX_RETRIES times', async () => {
    process.env.MODEL_MAX_RETRIES = '4';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    }) as typeof fetch;
    await expect(
      provider().generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ name: 'ModelError', code: 'rate_limited' });
    expect(calls, '429 must cost at most one retry').toBe(2);
  });

  it('waits the interval the provider asked for, and gives up when it does not fit the budget', async () => {
    process.env.MODEL_MAX_RETRIES = '4';
    process.env.MODEL_CALL_BUDGET_MS = '3000';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '30' } });
    }) as typeof fetch;
    const t0 = Date.now();
    await expect(
      provider().generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(ModelError);
    expect(calls, 'a 30s Retry-After does not fit a 3s budget — do not retry').toBe(1);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('5xx still retries on the normal backoff', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response('boom', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;
    const r = await provider().generate({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('parses both Retry-After spellings and clamps absurd values', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('99999')).toBe(60_000); // clamped
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs('not-a-date')).toBeUndefined();
    const httpDate = new Date(Date.now() + 5_000).toUTCString();
    expect(retryAfterMs(httpDate)).toBeGreaterThan(3_000);
    expect(retryAfterMs(new Date(Date.now() - 5_000).toUTCString())).toBe(0); // past date -> no wait
  });
});

// ---------- EP-SCALE-01 ----------

describe('a session the process cannot resolve is loud, not silent (EP-SCALE-01)', () => {
  it('logs session_not_resolved with a hashed id instead of quietly minting a new conversation', async () => {
    const lines = await captureLogs(() => {
      getOrCreateSession('c0ffee00-dead-4bee-8bad-000000000000');
    });
    const warning = lines.find((l) => l.includes('"event":"session_not_resolved"'));
    expect(warning, 'an unresolved client session id must be logged').toBeTruthy();
    expect(warning).toContain('"reason":"unknown"');
    expect(warning).toContain('"level":"warn"');
    expect(warning, 'the raw id is a credential — never log it').not.toContain('c0ffee00-dead-4bee');
  });

  it('states the single-instance ceiling once, not once per turn', async () => {
    const lines = await captureLogs(() => {
      getOrCreateSession('unknown-a');
      getOrCreateSession('unknown-b');
      getOrCreateSession('unknown-c');
    });
    const ceiling = lines.filter((l) => l.includes('"event":"session_store_single_instance"'));
    expect(ceiling).toHaveLength(1);
    expect(ceiling[0]).toMatch(/sticky sessions/);
  });

  it('says nothing when the id resolves — a normal follow-up turn is quiet', async () => {
    const s = getOrCreateSession();
    const lines = await captureLogs(() => {
      const again = getOrCreateSession(s.id);
      expect(again.id).toBe(s.id);
    });
    expect(lines.filter((l) => l.includes('session_not_resolved'))).toHaveLength(0);
  });
});

// ---------- EP-MAINT-09 / EP-SCALE-04 ----------

describe('log sink (EP-MAINT-09) and event-loop lag (EP-SCALE-04)', () => {
  it('drops info in a test run but never warn or error', async () => {
    const lines = await captureLogs(() => {
      log('info', 'chat_request', { requestId: 'r1' });
      log('warn', 'plan_fallback', { requestId: 'r1' });
      log('error', 'boom', { requestId: 'r1' });
    });
    expect(lines.some((l) => l.includes('chat_request'))).toBe(false);
    expect(lines.some((l) => l.includes('plan_fallback'))).toBe(true);
    expect(lines.some((l) => l.includes('"event":"boom"'))).toBe(true);
  });

  it('LOG_IN_TESTS=1 restores info, and request_metrics carries the event-loop lag', async () => {
    process.env.LOG_IN_TESTS = '1';
    const lines = await captureLogs(() => {
      logMetrics({
        requestId: 'r2',
        sessionId: 'hashed',
        totalLatencyMs: 5,
        inputTokens: 1,
        outputTokens: 1,
        cacheHit: false,
      });
    });
    const row = lines.find((l) => l.includes('"event":"request_metrics"'));
    expect(row).toBeTruthy();
    const parsed = JSON.parse(row!) as { eventLoopLagP99Ms?: number };
    expect(typeof parsed.eventLoopLagP99Ms).toBe('number');
    expect(parsed.eventLoopLagP99Ms).toBeGreaterThanOrEqual(0);
  });

  it('reports a finite lag in ms, not raw nanoseconds', () => {
    const lag = eventLoopLagP99Ms();
    expect(Number.isFinite(lag)).toBe(true);
    expect(lag).toBeGreaterThanOrEqual(0);
    expect(lag, 'ns would be ~1e6 too large').toBeLessThan(60_000);
  });
});

// ---------- EP-SCALE-05 / EP-SCALE-12 ----------

describe('gap log reads are bounded and appends are serialized', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-gaps-'));
    process.env.RUNTIME_DIR = dir;
    resetConfigForTests();
    expect(config().RUNTIME_DIR).toBe(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeGaps(n: number, question: (i: number) => string): void {
    const lines = Array.from({ length: n }, (_, i) =>
      JSON.stringify({ ts: new Date().toISOString(), normalizedQuestion: question(i), reason: 'low_confidence', language: 'fa' }),
    ).join('\n');
    fs.writeFileSync(path.join(dir, 'gaps.jsonl'), lines + '\n', 'utf8');
  }

  it('EP-SCALE-05: only the tail of a multi-MB file is parsed', () => {
    // 'ancient' lines are pushed far past the 256KB tail window by padding
    const pad = 'x'.repeat(400);
    writeGaps(4000, (i) => (i < 100 ? `ancient-${pad}` : `recent-${i}-${pad}`));
    const size = fs.statSync(path.join(dir, 'gaps.jsonl')).size;
    expect(size).toBeGreaterThan(1_000_000);
    const rows = readGapSummary(50);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.question.startsWith('ancient'))).toBe(false);
    expect(rows.every((r) => r.question.startsWith('recent'))).toBe(true);
  });

  it('EP-SCALE-05: a second read inside the TTL is served from the memo, and a write invalidates it', () => {
    writeGaps(5, () => 'چطور دیپلوی کنم؟');
    const first = readGapSummary();
    expect(first[0].count).toBe(5);
    // identity, not equality: a re-parse would build a fresh array
    expect(readGapSummary()).toBe(first);
    resetGapSummaryCacheForTests();
    expect(readGapSummary()).not.toBe(first);
    // ...and the memo is keyed on size+mtime, so new gaps are never stale
    writeGaps(7, () => 'چطور دیپلوی کنم؟');
    expect(readGapSummary()[0].count).toBe(7);
  });

  it('EP-SCALE-05: a partial first record in the tail window is dropped, not counted as garbage', () => {
    // exercise readTail's cut directly: a huge single first line then real rows
    const big = JSON.stringify({ ts: 'x', normalizedQuestion: 'g'.repeat(300_000), reason: 'low_confidence', language: 'fa' });
    const rest = ['alpha', 'alpha', 'beta']
      .map((q) => JSON.stringify({ ts: 'x', normalizedQuestion: q, reason: 'not_helpful', language: 'fa' }))
      .join('\n');
    fs.writeFileSync(path.join(dir, 'gaps.jsonl'), `${big}\n${rest}\n`, 'utf8');
    const rows = readGapSummary();
    expect(rows.map((r) => r.question)).toEqual(['alpha', 'beta']);
  });

  it('EP-SCALE-12: concurrent appends all land and rotation cannot race', async () => {
    for (let i = 0; i < 25; i++) {
      recordGap({ normalizedQuestion: `q-${i}`, reason: 'low_confidence', language: 'fa' });
    }
    await flushGapsForTests();
    const written = fs.readFileSync(path.join(dir, 'gaps.jsonl'), 'utf8').trim().split('\n');
    expect(written).toHaveLength(25);
    expect(written.every((l) => (JSON.parse(l) as { normalizedQuestion: string }).normalizedQuestion.startsWith('q-'))).toBe(true);
  });

  it('EP-SCALE-12: a gap is also emitted to stdout so it survives the instance', async () => {
    process.env.LOG_IN_TESTS = '1';
    const lines = await captureLogs(async () => {
      recordGap({ normalizedQuestion: 'چرا بیلد شکست خورد؟', reason: 'insufficient_evidence', language: 'fa' });
      await flushGapsForTests();
    });
    const emitted = lines.find((l) => l.includes('"event":"doc_gap"'));
    expect(emitted).toBeTruthy();
    expect(emitted).toContain('insufficient_evidence');
  });

  it('EP-SEC-01 stays true through the new sink: secrets are redacted in both outputs', async () => {
    process.env.LOG_IN_TESTS = '1';
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const lines = await captureLogs(async () => {
      recordGap({ normalizedQuestion: `کلید من ${secret} است`, reason: 'not_helpful', language: 'fa' });
      await flushGapsForTests();
    });
    expect(lines.join('\n')).not.toContain(secret);
    expect(fs.readFileSync(path.join(dir, 'gaps.jsonl'), 'utf8')).not.toContain(secret);
  });
});
