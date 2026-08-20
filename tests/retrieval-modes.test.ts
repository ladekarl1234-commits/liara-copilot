// Tests the benchmark-only mode flags on search() (lexical/vector/rerank +
// rankOnly). Uses a fixture index with SYNTHETIC vectors so it needs no model.
// Guards that the flags isolate the intended stage AND that default behavior is
// unchanged when no flags are passed (the flags must never affect production).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { search, miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import type { DocChunk } from '@/types';

const chunk = (id: string, title: string, text: string): DocChunk => ({
  id, sourcePath: `public/llms/${id}.md`, url: `https://docs.liara.ir/${id}/`,
  product: 'paas', platform: id === 'A' ? 'nextjs' : undefined, title, heading: title,
  headingPath: [title], contentType: 'text', text, hash: id,
});

// A matches lexically on "nextjs"; the query vector points at B; C is unrelated.
function fixtureIndex(): LoadedIndex {
  const chunks = [
    chunk('A', 'Next.js deploy', 'deploy your nextjs application on liara with liara deploy'),
    chunk('B', 'PostgreSQL', 'connect a postgresql database with DATABASE_URL'),
    chunk('C', 'Domain DNS', 'configure a custom domain and CNAME record'),
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  const dims = 3;
  const vecByHash: Record<string, number[]> = { A: [1, 0, 0], B: [0, 1, 0], C: [0, 0, 1] };
  const ids = chunks.map((c) => c.id);
  const matrix = Float32Array.from(chunks.flatMap((c) => vecByHash[c.hash]));
  return {
    chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical,
    vectors: { dims, model: 'synthetic', matrix, ids },
    meta: { builtAt: 't', chunkCount: chunks.length, anchorCoverage: 1, lexicalVersion: 3 },
  };
}

// query vector points straight at B (cosine 1 with B, 0 with A/C)
const embedQuery = async (texts: string[]) => texts.map(() => [0, 1, 0]);
const ids = (r: { chunks: { chunk: DocChunk }[] }) => r.chunks.map((s) => s.chunk.id);

describe('search() benchmark mode flags', () => {
  let idx: LoadedIndex;
  beforeEach(() => { resetIndexForTests(); idx = fixtureIndex(); });
  afterEach(() => resetIndexForTests());

  it('lexical-only ranks the lexically-matching chunk first (vector ignored)', async () => {
    const res = await search(['nextjs deploy'], {}, { mode: { vector: false, rerank: false }, rankOnly: true }, idx);
    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks[0].chunk.id).toBe('A'); // B never enters without the vector stage
    expect(ids(res)).not.toContain('B');
  });

  it('vector-only ranks the vector-nearest chunk first (lexical ignored)', async () => {
    const res = await search(['nextjs deploy'], {}, { embedQuery, mode: { lexical: false, rerank: false }, rankOnly: true }, idx);
    expect(res.chunks[0].chunk.id).toBe('B'); // pure cosine winner (query vector == B)
    // ranking is by cosine: B (1.0) must outrank the lexical winner A (0.0),
    // proving the order came from the vector stage, not lexical.
    const rankOf = (id: string) => ids(res).indexOf(id);
    expect(rankOf('B')).toBeLessThan(rankOf('A'));
  });

  it('hybrid fuses both signals (A from lexical, B from vector)', async () => {
    const res = await search(['nextjs deploy'], {}, { embedQuery, mode: { rerank: false }, rankOnly: true }, idx);
    expect(ids(res)).toContain('A');
    expect(ids(res)).toContain('B');
  });

  it('rankOnly skips the evidence gate and returns the raw fused list', async () => {
    const res = await search(['nextjs deploy'], {}, { mode: { rerank: false }, rankOnly: true }, idx);
    expect(res.confidence).toBe('low'); // sentinel — gate not computed in rankOnly
    expect(res.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('rerank flag changes ordering vs raw fusion (boosts actually apply)', async () => {
    // with rerank ON, the platform-named ("nextjs") chunk A gets a ×1.2 boost
    const raw = await search(['nextjs deploy'], {}, { mode: { rerank: false }, rankOnly: true }, idx);
    const reranked = await search(['nextjs deploy'], {}, { mode: {}, rankOnly: true }, idx);
    expect(reranked.chunks[0].chunk.id).toBe('A');
    // the reranked top score must reflect a boost the raw score did not have
    expect(reranked.chunks[0].score).not.toBe(raw.chunks.find((s) => s.chunk.id === 'A')?.score);
  });

  it('default behavior is unchanged when no flags are passed (regression guard)', async () => {
    const res = await search(['nextjs deploy'], {}, {}, idx);
    // normal path: real confidence + evidence selection (not the rankOnly sentinel path)
    expect(['low', 'medium', 'high']).toContain(res.confidence);
    expect(res.chunks[0].chunk.id).toBe('A');
  });
});
