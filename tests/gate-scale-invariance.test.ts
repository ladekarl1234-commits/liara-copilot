// EP-RET-12: the gate's two BM25 density bars (`high`, and the strong-evidence
// escape that overrides the coverage floor) were raw MiniSearch scores. A
// MiniSearch score is a sum of per-term idf ~ log(N/df), so a raw threshold
// silently changes meaning as the corpus grows — the exact class of bug the
// round-2 retrieval note says was already fixed once. They are now expressed
// relative to log(N).
//
// Before the fix `gateConfidence` had no corpus-scale parameter at all, so
// every assertion below that passes a scale was uncompilable and the two
// "10x corpus" cases returned the small-corpus tier.
import { describe, it, expect } from 'vitest';
import { gateConfidence, corpusIdf, type CorpusIdf, type Coverage, type LoadedIndex } from '@/lib/retrieval/index';
import type { DocChunk } from '@/types';

const TUNED_SCALE = Math.log(3746); // the corpus the constants were fitted on
const TEN_X = Math.log(37460);

const perfect: Coverage = { ratio: 1, informative: 3, matched: 3, matchedWeight: 12 };
const thin: Coverage = { ratio: 0.2, informative: 6, matched: 3, matchedWeight: 12 };

describe('gate BM25 bars are corpus-scale-invariant (EP-RET-12)', () => {
  it('keeps the tuned behaviour when the corpus is the one it was tuned on', () => {
    // 25 is the `high` bar at N=3746; 40 the strong-evidence bar.
    expect(gateConfidence(8, perfect, 25, 1.1, 0, true, true, TUNED_SCALE)).toBe('high');
    expect(gateConfidence(8, perfect, 24, 1.1, 0, true, true, TUNED_SCALE)).toBe('medium');
    expect(gateConfidence(8, thin, 40, 1.1, 0, true, true, TUNED_SCALE)).toBe('medium'); // escape fires
    expect(gateConfidence(8, thin, 39, 1.1, 0, true, true, TUNED_SCALE)).toBe('low'); // escape does not
  });

  it('omitting the scale is identical to passing the tuning-time corpus', () => {
    for (const spt of [10, 24, 25, 39, 40, 96]) {
      expect(gateConfidence(8, perfect, spt, 1.1, 0, true, true)).toBe(
        gateConfidence(8, perfect, spt, 1.1, 0, true, true, TUNED_SCALE),
      );
      expect(gateConfidence(8, thin, spt, 1.1, 0, true, true)).toBe(
        gateConfidence(8, thin, spt, 1.1, 0, true, true, TUNED_SCALE),
      );
    }
  });

  it('raises both bars proportionally on a 10x corpus', () => {
    // Scores inflate with log(N/df); a raw threshold would let these through.
    expect(gateConfidence(8, perfect, 25, 1.1, 0, true, true, TEN_X)).toBe('medium');
    expect(gateConfidence(8, thin, 40, 1.1, 0, true, true, TEN_X)).toBe('low');
    // …and the same DENSITY still qualifies, which is the property being locked.
    const k = TEN_X / TUNED_SCALE;
    expect(gateConfidence(8, perfect, 25 * k, 1.1, 0, true, true, TEN_X)).toBe('high');
    expect(gateConfidence(8, thin, 40 * k, 1.1, 0, true, true, TEN_X)).toBe('medium');
  });

  it('a zero/absent scale falls back to the tuning corpus rather than dividing by zero', () => {
    expect(gateConfidence(8, perfect, 25, 1.1, 0, true, true, 0)).toBe('high');
  });

  it('corpusIdf().oov is log(N) — the value search() feeds the gate', () => {
    const chunks: DocChunk[] = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      sourcePath: `public/llms/paas/p${i}.md`,
      url: `https://docs.liara.ir/paas/p${i}/`,
      product: 'paas',
      title: `عنوان ${i}`,
      headingPath: [],
      contentType: 'text',
      text: `متن نمونه شماره ${i}`,
      hash: `h${i}`,
    }));
    const idx = { chunks } as LoadedIndex;
    const idf: CorpusIdf = corpusIdf(idx);
    expect(idf.oov).toBeCloseTo(Math.log(20), 10);
  });
});
