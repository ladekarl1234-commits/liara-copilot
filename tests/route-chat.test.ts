// Route-level tests for /api/chat: validation, rate limiting (429 with body),
// body cap, and SSE headers — the review found the routes wholly untested.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import MiniSearch from 'minisearch';
import { POST } from '@/app/api/chat/route';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { resetForTests as resetRateLimit } from '@/lib/security/ratelimit';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import { resetAgentCachesForTests } from '@/lib/agent/orchestrator';
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

function makeReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readSSE(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetRateLimit();
    resetSessionsForTests();
    resetAgentCachesForTests();
    resetIndexForTests();
    globalThis.__liaraIndex = fixtureIndex();
    // keyless (degraded) mode — no model calls, deterministic
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    process.env.RATE_LIMIT_RPM = '3';
    process.env.TRUST_PROXY = 'on';
  });
  afterEach(() => {
    resetIndexForTests();
    delete process.env.RATE_LIMIT_RPM;
    delete process.env.TRUST_PROXY;
    delete process.env.MAX_BODY_BYTES; // must not leak a 200-byte cap into later tests
    resetConfigForTests();
  });

  it('rejects an empty message with 400 and a code', async () => {
    const res = await POST(makeReq({ message: '   ' }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe('invalid_input');
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await POST(makeReq('{not json', { 'x-forwarded-for': '1.1.1.9' }));
    expect(res.status).toBe(400);
  });

  it('streams SSE with the right headers on a valid request', async () => {
    const res = await POST(makeReq({ message: 'چطور متغیر محیطی اضافه کنم؟' }, { 'x-forwarded-for': '1.2.3.4' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    const body = await readSSE(res);
    expect(body).toContain('"type":"session"');
    expect(body).toContain('"type":"done"');
  });

  it('returns 429 WITH a useful body once the per-IP bucket is drained', async () => {
    const ip = '9.9.9.9';
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      last = await POST(makeReq({ message: `q${i}` }, { 'x-forwarded-for': ip }));
      if (last.status === 429) break;
      await readSSE(last); // drain the stream
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
    const j = await last!.json();
    expect(j.error.code).toBe('rate_limited');
  });

  it('rate-limits by IP, so a fresh sessionId does NOT reset the bucket', async () => {
    const ip = '8.8.8.8';
    let blocked = false;
    for (let i = 0; i < 6; i++) {
      const res = await POST(makeReq({ message: `q${i}`, sessionId: `sess${i}0000` }, { 'x-forwarded-for': ip }));
      if (res.status === 429) {
        blocked = true;
        break;
      }
      await readSSE(res);
    }
    expect(blocked).toBe(true); // rotating sessionId did not evade the IP limit
  });

  it('enforces the byte cap on the STREAMED body (413) — not just content-length', async () => {
    process.env.MAX_BODY_BYTES = '200';
    resetConfigForTests();
    // A streaming body with NO content-length header: the old header-only
    // check would see len=0 and pass. Only real stream-byte counting returns
    // 413 here, so this test fails if readJsonCapped is reverted.
    const payload = new TextEncoder().encode(JSON.stringify({ message: 'x'.repeat(5000) }));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(payload);
        c.close();
      },
    });
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' },
      body: stream,
      duplex: 'half', // required by the Fetch spec when the body is a stream
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new NextRequest('http://localhost/api/chat', init as any);
    expect(req.headers.get('content-length')).toBeNull(); // proves the header path can't save us
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});
