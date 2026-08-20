// /api/health returns 503 when the index (required to answer anything) is
// absent, so an LB/orchestrator healthcheck fails on a genuinely broken deploy;
// keyless mode (index ok, no AI key) stays a healthy 200.
import { describe, it, expect, afterEach } from 'vitest';
import { GET } from '@/app/api/health/route';
import { resetIndexForTests } from '@/lib/retrieval/index';
import { resetConfigForTests } from '@/lib/config';

describe('GET /api/health', () => {
  afterEach(() => {
    resetIndexForTests();
    resetConfigForTests();
  });

  it('is 503 + status:degraded when the index failed to load', async () => {
    resetIndexForTests();
    process.env.INDEX_DIR = 'data/definitely-not-an-index';
    resetConfigForTests();
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.index.loaded).toBe(false);
    delete process.env.INDEX_DIR;
  });

  it('is 200 + status:ok when the index is loaded (even without an AI key)', async () => {
    resetIndexForTests();
    globalThis.__liaraIndex = {
      chunks: [],
      byId: new Map(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lexical: {} as any,
      vectors: null,
      meta: { builtAt: 't', chunkCount: 10, anchorCoverage: 0.3, lexicalVersion: 3 },
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.index.chunkCount).toBe(10);
  });
});
