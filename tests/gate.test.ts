// Certifies the review-hardened evidence gate: exact-match coverage of
// informative tokens, and that off-topic queries actually gate 'low'.
import { describe, it, expect } from 'vitest';
import MiniSearch from 'minisearch';
import {
  miniOptions,
  exactCoverage,
  gateConfidence,
  expandQueries,
  search,
  citationUrl,
  type LoadedIndex,
} from '@/lib/retrieval/index';
import type { DocChunk, ScoredChunk } from '@/types';

const chunk = (o: Partial<DocChunk>): DocChunk => ({
  id: o.id ?? 'c',
  sourcePath: o.sourcePath ?? 'public/llms/paas/x.md',
  url: o.url ?? 'https://docs.liara.ir/paas/x/',
  anchor: o.anchor,
  product: o.product ?? 'paas',
  platform: o.platform,
  title: o.title ?? 't',
  heading: o.heading,
  headingPath: [o.title ?? 't'],
  contentType: 'text',
  text: o.text ?? '',
  hash: o.id ?? 'c',
});

const sc = (c: DocChunk): ScoredChunk => ({ chunk: c, score: 1 });

describe('exactCoverage', () => {
  it('ignores stopwords and counts only informative token overlap', () => {
    const chunks = [sc(chunk({ text: 'برای اضافه کردن متغیر محیطی وارد کنسول شوید' }))];
    // "چطور یک متغیر محیطی اضافه کنم" — informative: متغیر, محیطی, اضافه
    // (چطور/یک/کنم are stopwords). Exact match is morphology-sensitive by
    // design (متغیر ≠ متغیرهای); here the forms line up → full coverage.
    const cov = exactCoverage(['چطور یک متغیر محیطی اضافه کنم'], chunks);
    expect(cov.informative).toBe(3);
    expect(cov.ratio).toBeGreaterThan(0.9);
  });

  it('returns ratio 0 when no informative token appears in evidence', () => {
    const chunks = [sc(chunk({ text: 'استقرار برنامه Next.js روی لیارا' }))];
    const cov = exactCoverage(['دستور پخت کیک شکلاتی خامه‌ای'], chunks);
    expect(cov.ratio).toBe(0);
  });

  it('scores best per-query, never counting the synthetic expanded query', () => {
    const chunks = [sc(chunk({ text: 'دامنه و گواهی ssl' }))];
    const cov = exactCoverage(['اتصال دامنه', 'nonsense token zzz'], chunks);
    expect(cov.ratio).toBeGreaterThan(0);
  });
});

describe('gateConfidence', () => {
  it('is low with no results', () => {
    expect(gateConfidence(0, { ratio: 1, informative: 3 }, 100, 2)).toBe('low');
  });
  it('is low when informative coverage is below the floor', () => {
    expect(gateConfidence(8, { ratio: 0.2, informative: 4 }, 100, 1.2)).toBe('low');
  });
  it('is high only with strong coverage, score and margin', () => {
    expect(gateConfidence(8, { ratio: 0.8, informative: 3 }, 40, 1.1)).toBe('high');
    expect(gateConfidence(8, { ratio: 0.8, informative: 3 }, 40, 1.0)).toBe('medium'); // weak margin
    expect(gateConfidence(8, { ratio: 0.8, informative: 1 }, 40, 1.1)).toBe('medium'); // single token
  });
  it('leaves a pure-stopword follow-up to the planner (medium, not low)', () => {
    expect(gateConfidence(8, { ratio: 0, informative: 0 }, 30, 1.02)).toBe('medium');
  });
});

describe('expandQueries', () => {
  it('adds at most one EN→FA query and keeps technical identifiers', () => {
    const out = expandQueries(['how to deploy Next.js on liara']);
    expect(out.length).toBe(2);
    expect(out[0]).toBe('how to deploy Next.js on liara'); // original preserved
    expect(out[1]).toMatch(/استقرار/); // deploy → استقرار
    expect(out[1]).toMatch(/Next\.js/i); // identifier kept, not translated
  });
  it('does not expand a query with no known terms', () => {
    expect(expandQueries(['متغیر محیطی چیست'])).toEqual(['متغیر محیطی چیست']);
  });
});

// search-level: an off-topic query against a real mini-index must gate 'low'
function fixture(): LoadedIndex {
  const chunks = [
    chunk({ id: 'env', title: 'تنظیم متغیرهای محیطی', platform: 'nextjs', anchor: 'set-envs', text: 'برای تنظیم متغیرهای محیطی برنامه وارد کنسول لیارا شوید و متغیرها را اضافه کنید' }),
    chunk({ id: 'dep', url: 'https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/', title: 'استقرار برنامه NextJS', platform: 'nextjs', sourcePath: 'public/llms/paas/nextjs/how-tos/deploy-app.md', text: 'برای استقرار برنامه NextJS از دستور liara deploy استفاده کنید' }),
    chunk({ id: 'db', url: 'https://docs.liara.ir/dbaas/postgresql/about/', product: 'dbaas', platform: 'postgresql', title: 'دیتابیس PostgreSQL', text: 'سرویس دیتابیس PostgreSQL ابری لیارا' }),
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return { chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical, vectors: null, meta: { builtAt: 't', chunkCount: 3, anchorCoverage: 0.3, lexicalVersion: 2 } };
}

describe('search gate (fixture)', () => {
  it('gates an off-topic query low even though lexical returns hits', async () => {
    const r = await search(['دستور پخت کیک شکلاتی خامه‌ای مرحله به مرحله'], {}, {}, fixture());
    expect(r.confidence).toBe('low');
  });
  it('does not gate a well-matched query low', async () => {
    const r = await search(['تنظیم متغیرهای محیطی'], {}, {}, fixture());
    expect(r.confidence).not.toBe('low');
    expect(r.chunks[0].chunk.id).toBe('env');
  });
  it('applies product and platform filters independently', async () => {
    // product=dbaas must not be dropped just because a platform is also set
    const r = await search(['دیتابیس PostgreSQL'], { product: 'dbaas', platform: 'postgresql' }, {}, fixture());
    expect(r.chunks.every((s) => s.chunk.product === 'dbaas')).toBe(true);
  });
  it('empty-string filters do not build an always-true predicate', async () => {
    const r = await search(['استقرار NextJS'], { product: '', platform: '  ' } as never, {}, fixture());
    expect(r.chunks.length).toBeGreaterThan(0);
  });
});

describe('citationUrl', () => {
  it('appends #anchor only when present', () => {
    expect(citationUrl(chunk({ url: 'https://docs.liara.ir/paas/x/', anchor: 'a' }))).toBe('https://docs.liara.ir/paas/x/#a');
    expect(citationUrl(chunk({ url: 'https://docs.liara.ir/paas/x/' }))).toBe('https://docs.liara.ir/paas/x/');
  });
});
