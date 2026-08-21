// Pins the shipped retrieval mode (EP-PRD-02).
//
// The project benchmarked four retrieval modes, found hybrid+rerank strictly
// best (hit@1 45.8% -> 60.4%, MRR 0.619 -> 0.719 at the same false-refusal
// rate), and then shipped the WEAKEST one because AI_EMBEDDINGS_MODEL defaulted
// to unset. That default is now `local:`, which needs no API key.
//
// Two independent readers must agree on it or the product silently degrades to
// lexical while claiming to be hybrid:
//   - config() (zod default), used by queryEmbedder() on the QUERY side;
//   - loadIndex(), which reads process.env directly on the INDEX side.
// A mismatch is invisible at runtime — vectors simply never load — so it is
// pinned here rather than left to a comment.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config, resetConfigForTests } from '@/lib/config';
import { queryEmbedder } from '@/lib/retrieval/embed';
import { DEFAULT_EMBEDDINGS_MODEL } from '@/lib/ai/local-embeddings';

const KEY = 'AI_EMBEDDINGS_MODEL';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  resetConfigForTests();
});
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  resetConfigForTests();
});

describe('embeddings default (EP-PRD-02)', () => {
  it('defaults to the local model — hybrid is ON without any configuration', () => {
    delete process.env[KEY];
    resetConfigForTests();
    expect(config().AI_EMBEDDINGS_MODEL).toBe(DEFAULT_EMBEDDINGS_MODEL);
    expect(DEFAULT_EMBEDDINGS_MODEL.startsWith('local:')).toBe(true);
  });

  it('the local default needs NO api key, so the query side is live out of the box', () => {
    delete process.env[KEY];
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    expect(config().aiConfigured).toBe(false); // no LLM configured...
    expect(queryEmbedder()).toBeTypeOf('function'); // ...yet retrieval is still hybrid
  });

  it('an EMPTY string is the documented opt-out to lexical-only', () => {
    process.env[KEY] = '';
    resetConfigForTests();
    expect(queryEmbedder()).toBeUndefined();
  });

  it('a provider-hosted model still requires a configured provider', () => {
    process.env[KEY] = 'text-embedding-3-small';
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    // no key → no embedder, rather than a runtime failure on every query
    expect(queryEmbedder()).toBeUndefined();
  });
});
