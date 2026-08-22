// Regression locks for the expert-panel retrieval findings:
//   EP-ANS-01  the evidence gate refused questions whose retrieval was perfect
//   EP-ANS-04  'medium' answers from off-target evidence are not self-labelled
//   EP-RET-01  local embeddings were unreachable / asymmetric-prefix drift
//   EP-RET-02  the chunker cut inside open code fences
//   EP-RET-08  the vector half ignored the product filter the lexical half applied
//   EP-SCALE-02 vectorTopK allocated + sorted the whole corpus per query
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { resetConfigForTests } from '@/lib/config';
import {
  miniOptions,
  search,
  loadIndex,
  resetIndexForTests,
  LEXICAL_VERSION,
  exactCoverage,
  gateConfidence,
  corpusIdf,
  chunkFilter,
  evidenceIsWeak,
  type LoadedIndex,
} from '@/lib/retrieval/index';
import { localModelId, passageText } from '@/lib/retrieval/embed';
import { informativeTokens } from '@/lib/text/persian';
import { splitLong, boundarySlice, chunkMarkdown, fencesBalanced } from '@/lib/docs/ingest';
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
  headingPath: o.headingPath ?? [o.title ?? 't'],
  contentType: 'text',
  text: o.text ?? '',
  hash: o.id ?? 'c',
});
const sc = (c: DocChunk): ScoredChunk => ({ chunk: c, score: 1 });

// ---------------------------------------------------------------- EP-ANS-01

describe('EP-ANS-01: colloquial Persian filler is not evidence', () => {
  it('drops the conversational function words the probe surfaced', () => {
    // every one of these used to enter the gate denominator as an unmatchable
    // token, because none of them appears in the (formal, written) docs corpus
    const q = 'چطور برنامه و دیتابیسم رو توی یک شبکه خصوصی بذارم که از بیرون قابل دسترسی نباشن و به هم وصل بشن؟';
    const toks = new Set(informativeTokens(q));
    for (const filler of ['رو', 'توی', 'بذارم', 'بیرون', 'قابل', 'نباشن', 'بشن']) {
      expect(toks.has(filler), `"${filler}" must not count as informative`).toBe(false);
    }
    // …while the terms that actually identify the page survive
    for (const real of ['شبکه', 'خصوصی', 'دسترسی']) expect(toks.has(real)).toBe(true);
    // "دیتابیسم" (my database) folds onto the corpus form
    expect(toks.has('دیتابیس')).toBe(true);
  });

  it('IDF-weights coverage so a rare term outweighs a corpus-ubiquitous one', () => {
    const evidence = [sc(chunk({ text: 'شبکه خصوصی' }))];
    // «شبکه»/«خصوصی» are rare; «اتصال» is everywhere. Matching the two rare
    // terms and missing the ubiquitous one must NOT read as 2/3 coverage.
    const idf = { weight: new Map([['شبکه', 3.0], ['خصوصی', 3.1], ['اتصال', 1.2]]), oov: 8.2 };
    const weighted = exactCoverage(['شبکه خصوصی اتصال'], evidence, idf);
    const unweighted = exactCoverage(['شبکه خصوصی اتصال'], evidence);
    expect(unweighted.ratio).toBeCloseTo(2 / 3, 5);
    expect(weighted.ratio).toBeGreaterThan(0.8);
  });

  it('keeps a token absent from the whole corpus at maximum weight', () => {
    // the OOV escape must not become a free pass for genuinely unsupported
    // topics: "kubernetes" appears nowhere in the docs and has to hurt
    const evidence = [sc(chunk({ text: 'استقرار برنامه' }))];
    const idf = { weight: new Map([['استقرار', 1.0]]), oov: 8.2 };
    const cov = exactCoverage(['استقرار kubernetes'], evidence, idf);
    expect(cov.ratio).toBeLessThan(0.2);
  });

  it('gateConfidence escapes the ratio floor on absolute evidence', () => {
    const thin = { ratio: 0.25, informative: 12, matched: 4, matchedWeight: 12 };
    // strong: title match + >=2 matched tokens + dense BM25 → answerable
    expect(gateConfidence(8, thin, 96, 1.03, 0, true)).toBe('medium');
    // no title match → still refused
    expect(gateConfidence(8, thin, 96, 1.03, 0, false)).toBe('low');
    // only one token actually matched → still refused
    expect(gateConfidence(8, { ratio: 0.25, informative: 12, matched: 1, matchedWeight: 12 }, 96, 1.03, 0, true)).toBe('low');
    // two matched tokens but both corpus-generic (the cake-recipe shape) → refused
    expect(gateConfidence(8, { ratio: 0.13, informative: 6, matched: 2, matchedWeight: 4.7 }, 96, 1.28, 0, true)).toBe('low');
    // weak BM25 density → still refused
    expect(gateConfidence(8, thin, 10, 1.03, 0, true)).toBe('low');
    // and the escape never buys 'high'
    expect(gateConfidence(8, thin, 200, 3, 0, true)).not.toBe('high');
  });

  it("'high' requires the top two chunks to agree on a product", () => {
    const perfect = { ratio: 1, informative: 2, matched: 2 };
    expect(gateConfidence(8, perfect, 41, 1.1, 0, true, true)).toBe('high');
    expect(gateConfidence(8, perfect, 41, 1.1, 0, true, false)).toBe('medium');
  });
});

// ---------------------------------------------------------------- EP-ANS-04

describe('EP-ANS-04: off-target medium evidence is flagged', () => {
  const result = (title: string, confidence: 'low' | 'medium' | 'high', coverage: number) => ({
    chunks: [sc(chunk({ title }))],
    confidence,
    queries: ['چطور دیسک برنامه را افزایش دهم'],
    filters: {},
    latencyMs: 1,
    signals: { coverage, scorePerToken: 30, margin: 1.1 },
  });
  it('flags medium evidence whose top page title shares no query term', () => {
    expect(evidenceIsWeak(result('تنظیم ایمیل سرور', 'medium', 0.6))).toBe(true);
  });
  it('does not flag on-target medium evidence', () => {
    expect(evidenceIsWeak(result('افزایش دیسک برنامه', 'medium', 0.6))).toBe(false);
  });
  it('says nothing about low or high — those tiers are already decided', () => {
    expect(evidenceIsWeak(result('تنظیم ایمیل سرور', 'low', 0.2))).toBe(false);
    expect(evidenceIsWeak(result('تنظیم ایمیل سرور', 'high', 0.9))).toBe(false);
  });
});

// ---------------------------------------------------------------- EP-RET-02

describe('EP-RET-02: no chunk ever carries half a code block', () => {
  const fence = (lines: number, lang = 'bash') =>
    ['```' + lang, ...Array.from({ length: lines }, (_, i) => `liara deploy --app my-app-${i} --port 3000`), '```'].join('\n');

  it('boundarySlice closes and reopens a fence it has to cut through', () => {
    const piece = fence(120); // ~5.4k chars, a single unbreakable code block
    expect(piece.length).toBeGreaterThan(2200);
    const slices = boundarySlice(piece);
    expect(slices.length).toBeGreaterThan(1);
    for (const s of slices) {
      expect(fencesBalanced(s), `unbalanced slice: ${s.slice(0, 60)}`).toBe(true);
      expect(s.length).toBeLessThanOrEqual(2200);
    }
    // the reopened block keeps its info string, so the code is still highlighted
    expect(slices[1].startsWith('```bash')).toBe(true);
    // and nothing is lost
    expect(slices.join('\n')).toContain('my-app-119');
  });

  it('splitLong never emits an odd number of fence lines', () => {
    const para = 'پاراگراف متنی تکراری برای تست تقسیم. '.repeat(20);
    for (const text of [
      [para, '', fence(60), '', para].join('\n'),
      [para, '', fence(4), '', para, '', fence(80), '', para, '', para].join('\n'),
      // pathological: the SOURCE itself never closes the fence
      [para, '', '```yaml', 'apps:', '  - id: "wordpress"'].join('\n') + '\n' + 'x'.repeat(2400),
    ]) {
      for (const piece of splitLong(text)) expect(fencesBalanced(piece)).toBe(true);
    }
  });

  it('an unterminated fence in a short section is repaired, not shipped', () => {
    const chunks = chunkMarkdown('# ت\n\n## بخش\n\nمتن\n\n```yaml\napps:\n  - id: "x"\n', {
      sourcePath: 'public/llms/x.md',
      url: 'https://docs.liara.ir/x/',
      title: 'ت',
      product: 'paas',
      anchors: new Map(),
    });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(fencesBalanced(c.text)).toBe(true);
  });
});

// ------------------------------------------------- EP-RET-08 / EP-SCALE-02

// 6 PaaS chunks (enough that the deliberate `< 5 results` relaxation does NOT
// fire) plus one DBaaS chunk that the query vector points straight at.
function vectorFixture(): LoadedIndex {
  const chunks = [
    ...Array.from({ length: 6 }, (_, i) =>
      chunk({ id: `paas-${i}`, product: 'paas', title: `شبکه خصوصی ${i}`, text: 'شبکه خصوصی پلتفرم' }),
    ),
    chunk({ id: 'dbaas-net', product: 'dbaas', title: 'شبکه خصوصی دیتابیس', text: 'شبکه خصوصی دیتابیس' }),
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  // 2-D unit vectors: paas-0 is (0,1), the other paas rows sit off-axis, and
  // dbaas-net is (1,0) — the single closest row to the query vector below.
  const rows = [0, 1, 0.5, 0.87, 0.5, 0.87, 0.5, 0.87, 0.5, 0.87, 0.5, 0.87, 1, 0];
  return {
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    lexical,
    vectors: {
      dims: 2,
      model: 'test',
      ids: chunks.map((c) => c.id),
      matrix: Float32Array.from(rows),
    },
    meta: { builtAt: 't', chunkCount: chunks.length, anchorCoverage: 0, lexicalVersion: 99 },
  };
}

describe('EP-RET-08: both retrieval halves apply the SAME metadata filter', () => {
  it('chunkFilter applies product and platform independently', () => {
    const pred = chunkFilter({ product: 'paas', platform: 'nextjs' })!;
    expect(pred(chunk({ product: 'paas', platform: 'nextjs' }))).toBe(true);
    expect(pred(chunk({ product: 'paas' }))).toBe(true); // no platform of its own
    expect(pred(chunk({ product: 'dbaas', platform: 'nextjs' }))).toBe(false);
    expect(pred(chunk({ product: 'paas', platform: 'django' }))).toBe(false);
    expect(chunkFilter({})).toBeNull();
  });

  it('the vector list cannot re-admit a product the lexical list excluded', async () => {
    const idx = vectorFixture();
    // query vector points straight at dbaas-net, the highest-similarity row
    const embedQuery = async () => [[1, 0]];
    const r = await search(['شبکه خصوصی'], { product: 'paas' }, { embedQuery, rankOnly: true }, idx);
    const products = new Set(r.chunks.map((s) => s.chunk.product));
    expect(products.has('dbaas')).toBe(false);
    expect(products.has('paas')).toBe(true);
  });

  it('ranks vector hits by similarity (bounded top-k selection, EP-SCALE-02)', async () => {
    const idx = vectorFixture();
    // no lexical hit at all, so the ranking is purely the vector list: (0,1)
    // is closest to paas-0 and furthest from dbaas-net
    const embedQuery = async () => [[0, 1]];
    const r = await search(['zzzzz'], {}, { embedQuery, rankOnly: true }, idx);
    expect(r.chunks[0].chunk.id).toBe('paas-0');
    expect(r.chunks[r.chunks.length - 1].chunk.id).toBe('dbaas-net');
  });
});

// ---------------------------------------------------------------- EP-RET-01

describe('EP-RET-01: one embedder, one passage template', () => {
  it('routes local:<model> in-process and everything else to the provider', () => {
    expect(localModelId('local:')).toBe('Xenova/multilingual-e5-small');
    expect(localModelId('local:intfloat/multilingual-e5-base')).toBe('intfloat/multilingual-e5-base');
    expect(localModelId('text-embedding-3-small')).toBeNull();
    expect(localModelId(undefined)).toBeNull();
  });

  it('uses the benchmarked passage template (title, breadcrumb, text)', () => {
    const c = chunk({ title: 'شبکه خصوصی', headingPath: ['شبکه خصوصی', 'راه‌اندازی'], text: 'متن' });
    expect(passageText(c)).toBe('شبکه خصوصی\nشبکه خصوصی › راه‌اندازی\nمتن');
  });

  it('refuses to mix vector spaces: vectors built with another model fail loudly', () => {
    // Shipped vector artifact is now vectors.json (header: model/dims/count/ids)
    // + vectors.bin (raw little-endian Float32, rows in `ids` order) — NOT
    // embeddings.json, which is only the incremental build cache and is never
    // read by loadIndex(). See scripts/build-index.ts / loadIndex()'s vectors
    // block in src/lib/retrieval/index.ts.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-emb-'));
    const dims = 2;
    const writeVectors = (model: string, floats: number[]) => {
      fs.writeFileSync(path.join(dir, 'vectors.json'), JSON.stringify({ model, dims, count: 1, ids: ['a'] }));
      const buf = Buffer.alloc(floats.length * Float32Array.BYTES_PER_ELEMENT);
      floats.forEach((f, i) => buf.writeFloatLE(f, i * 4));
      fs.writeFileSync(path.join(dir, 'vectors.bin'), buf);
    };
    try {
      const c = { ...chunk({ id: 'a' }), hash: 'h1' };
      const mini = new MiniSearch(miniOptions());
      mini.addAll([c] as unknown as Record<string, unknown>[]);
      fs.writeFileSync(path.join(dir, 'chunks.json'), JSON.stringify([c]));
      fs.writeFileSync(path.join(dir, 'lexical.json'), JSON.stringify(mini));
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ builtAt: 't', chunkCount: 1, anchorCoverage: 0, lexicalVersion: LEXICAL_VERSION }));
      writeVectors('local:other', [1, 0]);

      resetIndexForTests();
      // UPDATED for the new default (EP-PRD-02): hybrid is now ON unless
      // explicitly opted out, so "not configured" is the EMPTY STRING, not an
      // absent variable. Previously this asserted that an ABSENT variable meant
      // lexical-only; that encoded the old default, which deliberately changed
      // when the measured-better mode became the shipped one.
      process.env.AI_EMBEDDINGS_MODEL = '';
      resetConfigForTests();
      // opted out → the file is not even read
      expect(loadIndex(dir).vectors).toBeNull();

      resetIndexForTests();
      process.env.AI_EMBEDDINGS_MODEL = 'local:';
      resetConfigForTests();
      expect(() => loadIndex(dir)).toThrow(/built with "local:other"/);

      resetIndexForTests();
      process.env.AI_EMBEDDINGS_MODEL = 'local:other';
      resetConfigForTests();
      expect(loadIndex(dir).vectors?.ids).toEqual(['a']);

      // a corrupt/truncated binary (line-ending mangling, partial write) must
      // also fail loudly rather than silently mis-reading the matrix
      resetIndexForTests();
      fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.alloc(4)); // declares 1x2 floats (8 bytes), ships 4
      expect(() => loadIndex(dir)).toThrow(/vectors\.bin is 4 bytes but vectors\.json declares 1x2/);
    } finally {
      delete process.env.AI_EMBEDDINGS_MODEL;
      resetIndexForTests();
      resetConfigForTests();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// -------------------------------------------------- real-index certification

const INDEX_DIR = process.env.INDEX_DIR || path.join('data', 'index');
const HAS_INDEX = fs.existsSync(path.join(INDEX_DIR, 'lexical.json'));
const d = HAS_INDEX ? describe : describe.skip;

d('EP-ANS-01 at real corpus scale', () => {
  it('answers a conversational question whose retrieval was perfect', async () => {
    resetIndexForTests();
    const idx = loadIndex(INDEX_DIR);
    const q = 'چطور برنامه و دیتابیسم رو توی یک شبکه خصوصی بذارم که از بیرون قابل دسترسی نباشن و به هم وصل بشن؟';
    const r = await search([q], {}, {}, idx);
    // top-1 is the page that answers it — refusing here was the bug
    expect(r.chunks[0].chunk.url).toContain('/private-network');
    expect(r.confidence).not.toBe('low');
    resetIndexForTests();
  });

  it('still refuses a question the docs genuinely do not answer', async () => {
    resetIndexForTests();
    const idx = loadIndex(INDEX_DIR);
    for (const q of ['asdkjhasd qwe zzz', 'دستور پخت کیک شکلاتی خامه‌ای مرحله به مرحله']) {
      expect((await search([q], {}, {}, idx)).confidence).toBe('low');
    }
    resetIndexForTests();
  });

  it('ships no chunk with an unbalanced code fence', () => {
    const chunks: DocChunk[] = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'chunks.json'), 'utf8'));
    const broken = chunks.filter((c) => !fencesBalanced(c.text));
    expect(broken.map((c) => c.id)).toEqual([]);
  });

  it('builds a corpus IDF that separates rare domain terms from ubiquitous ones', () => {
    resetIndexForTests();
    const idf = corpusIdf(loadIndex(INDEX_DIR));
    expect(idf.weight.get('خصوصی')!).toBeGreaterThan(idf.weight.get('اتصال')!);
    expect(idf.weight.get('توی')).toBeUndefined(); // colloquial filler is not in the docs at all
    resetIndexForTests();
  });
});
