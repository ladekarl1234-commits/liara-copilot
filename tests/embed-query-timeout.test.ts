// A slow query embedding must never hold a chat request open (DEPLOY-005).
//
// Originally reproduced against the LOCAL model: with no cache on disk,
// Transformers.js fetched ~90 MB from the HF hub *inside* the request, so a chat
// POST sat in the `searching` stage for 100s+, streamed no answer, and ended
// only when the client gave up. Nothing on the request path bounded it.
//
// The default embedder is now provider-hosted, which moves the same risk to a
// network call: a gateway that accepts the connection and then stalls would hang
// the turn identically. So the bound is exercised here against the PROVIDER
// path, which is what production actually runs.
//
// search() already degrades to lexical-only when embedQuery REJECTS
// (retrieval/index.ts -> vector_search_failed); it had no defence against one
// that never settles. queryEmbedder() bounds the call so the hang becomes that
// existing, tested degrade path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';

// never settles — exactly the shape of a stalled gateway, with no network involved
vi.mock('@/lib/ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/provider')>();
  class Hanging extends actual.OpenAICompatibleProvider {
    override embed(): Promise<number[][]> {
      return new Promise<number[][]>(() => {});
    }
  }
  return { ...actual, OpenAICompatibleProvider: Hanging };
});

/** the model the shipped index was actually built with — anything else makes
 *  loadIndex() refuse to mix vector spaces, which is a different test */
const SHIPPED_MODEL = (
  JSON.parse(readFileSync(join('data', 'index', 'vectors.json'), 'utf8')) as { model: string }
).model;

const ENV = ['AI_EMBEDDINGS_MODEL', 'EMBED_TIMEOUT_MS', 'OPENROUTER_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  resetConfigForTests();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  resetConfigForTests();
});

describe('query embedding is bounded (DEPLOY-005)', () => {
  it('rejects once EMBED_TIMEOUT_MS is spent instead of hanging the request', async () => {
    process.env.AI_EMBEDDINGS_MODEL = SHIPPED_MODEL;
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.EMBED_TIMEOUT_MS = '60';
    resetConfigForTests();
    const { queryEmbedder } = await import('@/lib/retrieval/embed');
    const embed = queryEmbedder();
    expect(embed).toBeTypeOf('function');

    const started = Date.now();
    await expect(embed!(['how do I deploy'])).rejects.toThrow(/exceeded 60ms/);
    // bounded by the budget, not by the caller giving up
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('the rejection is the signal search() already degrades on — lexical still answers', async () => {
    process.env.AI_EMBEDDINGS_MODEL = SHIPPED_MODEL;
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.EMBED_TIMEOUT_MS = '60';
    resetConfigForTests();
    const { queryEmbedder } = await import('@/lib/retrieval/embed');
    const { search, loadIndex, resetIndexForTests } = await import('@/lib/retrieval/index');
    resetIndexForTests();

    // vectors ARE loaded — so a false `vectorUsed` below can only mean the
    // timeout fired, not that the index simply had nothing to search
    expect(loadIndex().vectors).not.toBeNull();

    const res = await search(['deploy a next.js app'], {}, { embedQuery: queryEmbedder() });
    expect(res.vectorUsed).toBe(false); // degraded, not thrown
    expect(res.chunks.length).toBeGreaterThan(0); // lexical still produced evidence
  });
});
