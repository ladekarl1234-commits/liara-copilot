// Regression guard for EP-RET-01: enabling hybrid retrieval (local e5 vectors)
// measurably improved ranking (hit@5 81.3%->91.7%, MRR 0.592->0.750 on
// evals/cases) but regressed the evidence gate — false-refusal rose 6.3%->12.5%
// and failed CI's ceiling (`npm run evaluate:retrieval` with
// AI_EMBEDDINGS_MODEL=local:).
//
// Root cause (verified against evals/results/, NOT the gate's coverage math):
// RRF fusion sums 1/(RRF_K+rank) per source list. At the old RRF_K=60, a
// handful of near-duplicate template pages that merely happened to appear in
// BOTH the lexical and vector candidate lists (each at a mediocre rank in
// each) accumulated more combined RRF mass than a single chunk that was the
// SOLE, decisive #1 in one list and weak/absent in the other — e.g.
// "دو تا برنامه دارم که باید به هم درخواست بزنن..." (persian-private-network-apps):
// /paas/details/private-network was lexical rank 1 alone; hybrid fusion
// dropped it to rank 4-6 behind generic "deploy-app"/"create-app" template
// pages, so the gate correctly refused evidence that was, correctly, no
// longer the top result. Lowering RRF_K to 5 (src/lib/retrieval/index.ts)
// weights top ranks steeply enough that a decisive single-list #1 beats
// mediocre-both-lists corroboration, which is what "the two signals agree"
// should actually mean.
//
// This fixture reproduces that exact shape with a synthetic vector index (no
// model needed), following the pattern in tests/retrieval-modes.test.ts:
//   - D: the correct answer. Dominant, multi-token lexical #1 (all 4
//     informative query tokens). Vector-orthogonal (cosine ~ -1) — the
//     embedding does not "find" it, mirroring private-network's real behavior
//     (absent from the vector-only top-8 entirely).
//   - X / Y: near-duplicate template noise. Weak lexical match (ONE shared
//     token each, at a worse rank than D) but placed close to the query
//     vector, so they get real vector-list support neither dominant nor
//     absent — exactly the "mediocre in both lists" shape that outscored a
//     decisive #1 under the old RRF_K.
//   - F1..F5: lexically irrelevant filler, purely to occupy the vector list's
//     top ranks ahead of X/Y (mirrors the real corpus having many other
//     semantically-close pages), so X/Y's own vector rank is realistically
//     mediocre rather than #1.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { search, miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import type { DocChunk } from '@/types';

const chunk = (id: string, title: string, text: string): DocChunk => ({
  id, sourcePath: `public/llms/${id}.md`, url: `https://docs.liara.ir/${id}/`,
  product: 'paas', platform: undefined, title, heading: title,
  headingPath: [title], contentType: 'text', text, hash: id,
});

const QUERY = 'link two servers together';

function fixtureIndex(): LoadedIndex {
  const chunks = [
    chunk('D', 'Private Link Network', 'link two servers together using a private link gateway service configuration directly for cross communication'),
    chunk('X', 'Deploy Echo Servers', 'deploy your echo servers module quickly on the platform'),
    chunk('Y', 'Deploy Hono Widget', 'deploy your hono module quickly on the platform, it also mentions servers occasionally'),
    ...[1, 2, 3, 4, 5].map((i) => chunk(`F${i}`, 'Weather Forecast Today', 'sunny rain cloud temperature humidity forecast local weather station data')),
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);

  // dims=2 unit vectors; query points along [1,0]. Angle controls cosine
  // similarity and therefore vector rank: F1..F5 nearly aligned (best),
  // X/Y moderately aligned (mediocre), D anti-aligned (worst/absent-shaped).
  const angle: Record<string, number> = { F1: 0.001, F2: 0.002, F3: 0.003, F4: 0.004, F5: 0.005, X: 0.5, Y: 0.6, D: Math.PI };
  const dims = 2;
  const ids = chunks.map((c) => c.id);
  const matrix = Float32Array.from(chunks.flatMap((c) => {
    const a = angle[c.id];
    return [Math.cos(a), Math.sin(a)];
  }));
  return {
    chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical,
    vectors: { dims, model: 'synthetic', matrix, ids },
    meta: { builtAt: 't', chunkCount: chunks.length, anchorCoverage: 1, lexicalVersion: 4 },
  };
}

const embedQuery = async (texts: string[]) => texts.map(() => [1, 0]);
const ids = (r: { chunks: { chunk: DocChunk }[] }) => r.chunks.map((s) => s.chunk.id);

describe('hybrid fusion: a decisive single-source #1 beats both-lists-mediocre corroboration', () => {
  let idx: LoadedIndex;
  beforeEach(() => { resetIndexForTests(); idx = fixtureIndex(); });
  afterEach(() => resetIndexForTests());

  it('D (dominant lexical #1, weak vector) outranks X/Y (mediocre in both lists) in the fused ranking', async () => {
    const res = await search([QUERY], {}, { embedQuery, mode: { rerank: false }, rankOnly: true }, idx);
    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks[0].chunk.id).toBe('D');
    const rankOf = (id: string) => ids(res).indexOf(id);
    expect(rankOf('D')).toBeLessThan(rankOf('X'));
    expect(rankOf('D')).toBeLessThan(rankOf('Y'));
  });

  it('X alone (vector-only) would beat D — proving the win comes from RRF weighting, not the vector stage ignoring X', async () => {
    // isolates the vector stage: X/Y are closer to the query vector than D,
    // so without the RRF_K tuning this scenario would be a coin flip / loss.
    const vecOnly = await search([QUERY], {}, { embedQuery, mode: { lexical: false, rerank: false }, rankOnly: true }, idx);
    const rankOf = (id: string) => ids(vecOnly).indexOf(id);
    expect(rankOf('X')).toBeLessThan(rankOf('D'));
  });

  it('the confidence gate does not refuse D once it correctly lands on top of the fused evidence', async () => {
    const res = await search([QUERY], {}, { embedQuery }, idx);
    expect(res.chunks[0]?.chunk.id).toBe('D');
    expect(res.confidence).not.toBe('low');
  });
});
