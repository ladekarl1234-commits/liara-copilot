// Pins the shipped retrieval mode (EP-PRD-02).
//
// The project benchmarked four retrieval modes, found hybrid+rerank strictly
// best, and then shipped the WEAKEST one because AI_EMBEDDINGS_MODEL defaulted
// to unset. The default has since moved twice, both times on measurement:
// unset -> `local:` -> a provider-hosted model. The current default is hosted
// because the local WASM path cannot be deployed serverlessly (126 MB of
// function bundle) and because a truncated weights file aborts the Node process
// outright rather than degrading — see src/lib/ai/local-embeddings.ts. On the
// same corpus and eval set the hosted model also scores higher: hit@5
// 0.833 lexical / 0.896 hybrid, MRR 0.630 / 0.748, evidence-recall 0.792 / 0.896.
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  it('defaults to a real embedding model — hybrid is ON without any configuration', () => {
    delete process.env[KEY];
    resetConfigForTests();
    expect(config().AI_EMBEDDINGS_MODEL).toBe(DEFAULT_EMBEDDINGS_MODEL);
    // Whatever it is, it must not be empty — empty is the documented opt-out to
    // lexical-only, and shipping that by accident is the original EP-PRD-02 bug.
    expect(DEFAULT_EMBEDDINGS_MODEL).toBeTruthy();
    // and it must match what the shipped index was actually built with, or
    // vectors silently never load (see the two-reader note above).
    const meta = JSON.parse(
      readFileSync(join('data', 'index', 'vectors.json'), 'utf8'),
    ) as { model: string };
    expect(meta.model).toBe(DEFAULT_EMBEDDINGS_MODEL);
  });

  it('the hosted default degrades to lexical rather than erroring when no key is set', () => {
    delete process.env[KEY];
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    expect(config().aiConfigured).toBe(false);
    // No provider means no query embedder, and search() falls back to lexical.
    // That is the documented keyless mode — it must not throw or hang.
    expect(queryEmbedder()).toBeUndefined();
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
