// Regression locks for the API-surface panel findings:
//   EP-OBS-05 — rate-limit rejections were completely unlogged, including the
//               global spend backstop.
//   EP-ARCH-07 — feedback.jsonl had no size bound, unlike its sibling gap log.
//   EP-SEC-04  — /api/chat was the one POST route left without the cross-site
//               guard the voice and feedback routes already carry.
// Every case here FAILS against the pre-fix code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { NextRequest } from 'next/server';
import { POST as chatPOST } from '@/app/api/chat/route';
import { POST as feedbackPOST } from '@/app/api/feedback/route';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { consume, resetForTests as resetRateLimit } from '@/lib/security/ratelimit';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import { resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { hashId } from '@/lib/security/hash';
import type { DocChunk } from '@/types';

function fixtureIndex(): LoadedIndex {
  const chunks: DocChunk[] = [
    {
      id: 'env', sourcePath: 'public/llms/paas/nextjs/set-envs.md',
      url: 'https://docs.liara.ir/paas/nextjs/how-tos/set-envs/', anchor: 'set-envs',
      product: 'paas', platform: 'nextjs', title: 'تنظیم متغیرهای محیطی', heading: 'تنظیم',
      headingPath: ['تنظیم متغیرهای محیطی'], contentType: 'text',
      text: 'برای تنظیم متغیرهای محیطی برنامه وارد کنسول لیارا شوید و متغیرها را اضافه کنید',
      hash: 'env',
    },
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return { chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical, vectors: null, meta: { builtAt: 't', chunkCount: 1, anchorCoverage: 1, lexicalVersion: 2 } };
}

function captureLogs(): { lines: Record<string, unknown>[]; restore: () => void } {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
    try {
      lines.push(JSON.parse(String(s)) as Record<string, unknown>);
    } catch {
      /* not a structured log line */
    }
  });
  return { lines, restore: () => spy.mockRestore() };
}

async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  while (!(await reader.read()).done) { /* consume */ }
}

function chatReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('EP-OBS-05 rate-limit rejections are logged', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetRateLimit();
    resetSessionsForTests();
    resetAgentCachesForTests();
    resetIndexForTests();
    globalThis.__liaraIndex = fixtureIndex();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    process.env.RATE_LIMIT_RPM = '2';
    process.env.TRUST_PROXY = 'on';
    resetConfigForTests();
  });
  afterEach(() => {
    resetIndexForTests();
    delete process.env.RATE_LIMIT_RPM;
    delete process.env.TRUST_PROXY;
    resetConfigForTests();
  });

  it('/api/chat emits a warn line naming the scope and the HASHED ip, never the raw one', async () => {
    const ip = '203.0.113.7';
    const { lines, restore } = captureLogs();
    try {
      for (let i = 0; i < 6; i++) {
        const res = await chatPOST(chatReq({ message: `q${i}` }, { 'x-forwarded-for': ip }));
        if (res.status === 429) break;
        await drain(res);
      }
    } finally {
      restore();
    }
    const rejected = lines.filter((l) => l.event === 'rate_limited');
    expect(rejected.length).toBeGreaterThan(0);
    const l = rejected[0];
    expect(l.level).toBe('warn');
    expect(l.route).toBe('chat');
    expect(l.scope).toBe('per_ip');
    expect(l.ipHash).toBe(hashId(ip));
    expect(JSON.stringify(l)).not.toContain(ip); // PII stays hashed
    expect(typeof l.retryAfterSec).toBe('number');
  });

  it('/api/feedback emits the same line rather than 429-ing silently', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-fb-'));
    process.env.RUNTIME_DIR = dir;
    resetConfigForTests();
    const { lines, restore } = captureLogs();
    try {
      for (let i = 0; i < 6; i++) {
        const res = await feedbackPOST(
          new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.4' },
            body: JSON.stringify({ sessionId: 'sess0000', messageId: `m${i}`, verdict: 'helpful' }),
          }),
        );
        if (res.status === 429) break;
      }
    } finally {
      restore();
      delete process.env.RUNTIME_DIR;
      resetConfigForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(lines.some((l) => l.event === 'rate_limited' && l.route === 'feedback')).toBe(true);
  });

  it('consume() reports scope "global" when the shared spend backstop trips', () => {
    // capacity 2 per key, global capacity 2*10 = 20: spread over enough distinct
    // keys that no per-key bucket empties, and only the global one can reject.
    let global: string | undefined;
    for (let i = 0; i < 40; i++) {
      const r = consume(`k${i}`);
      if (!r.allowed) {
        global = r.scope;
        break;
      }
    }
    expect(global).toBe('global');
  });
});

describe('EP-ARCH-07 feedback.jsonl is size-bounded like the gap log', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-fbcap-'));
    process.env.RUNTIME_DIR = dir;
    process.env.RATE_LIMIT_RPM = '100';
    resetConfigForTests();
    resetRateLimit();
  });
  afterEach(() => {
    delete process.env.RUNTIME_DIR;
    delete process.env.RATE_LIMIT_RPM;
    resetConfigForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rotates to .1 once the file passes the cap instead of growing forever', async () => {
    const file = path.join(dir, 'feedback.jsonl');
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8');
    const res = await feedbackPOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess0000', messageId: 'm1', verdict: 'helpful' }),
      }),
    );
    expect(res.status).toBe(204);
    expect(fs.existsSync(file + '.1')).toBe(true);
    // the live file restarted from the new row only
    expect(fs.statSync(file).size).toBeLessThan(1024);
  });
});

describe('EP-SEC-04 /api/chat rejects a cross-site POST', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetRateLimit();
    resetSessionsForTests();
    resetAgentCachesForTests();
    resetIndexForTests();
    globalThis.__liaraIndex = fixtureIndex();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
  });
  afterEach(() => {
    resetIndexForTests();
    resetConfigForTests();
  });

  it('403s a foreign Origin — a third-party page must not spend the model budget', async () => {
    const res = await chatPOST(chatReq({ message: 'سلام' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: { code: string } };
    expect(j.error.code).toBe('forbidden');
  });

  it('still serves a same-origin browser and a header-less non-browser client', async () => {
    const same = await chatPOST(
      chatReq({ message: 'سلام' }, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' }),
    );
    expect(same.status).toBe(200);
    await drain(same);
    const headerless = await chatPOST(chatReq({ message: 'سلام' }));
    expect(headerless.status).toBe(200);
    await drain(headerless);
  });
});
