// Deterministic, zero-cost ModelProvider. Two jobs:
//   1. Load testing — exercise retrieval, streaming, and HTTP plumbing without
//      spending live OpenRouter quota (see scripts/benchmark-load.mjs).
//   2. Offline dev — a runnable answer path with no API key.
// It NEVER makes a network call and NEVER reflects real model quality, so it is
// unfit for LLM-quality evaluation (that uses a real key, bounded — see docs).

import type { GenerateOptions, GenerateResult, ModelProvider } from '@/types';

const MODEL = 'mock-llm-v1';

// A short, citation-shaped grounded answer. The [1] marker lets the citation
// extractor and the streaming UI run their real code paths under load.
const ANSWER =
  'برای انجام این کار طبق مستندات لیارا مراحل زیر را دنبال کنید [1]. ' +
  'ابتدا تنظیمات پروژه را بررسی کنید، سپس دستور استقرار را اجرا کنید. ' +
  'جزئیات کامل در منبع زیر آمده است.';

function usageFor(inChars: number, outText: string) {
  return { inputTokens: Math.ceil(inChars / 4), outputTokens: Math.ceil(outText.length / 4) };
}

export class MockLLMProvider implements ModelProvider {
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    opts.onMeta?.({ model: MODEL });
    const inChars = opts.messages.reduce((n, m) => n + m.content.length, 0);
    // A structured-output request (plan/verify) gets an empty JSON object; the
    // callers validate with zod + fallbacks, so the deterministic path still runs.
    const text = opts.jsonSchema ? '{}' : ANSWER;
    return { text, usage: usageFor(inChars, text), model: MODEL };
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<string> {
    opts.onMeta?.({ model: MODEL });
    // yield word-by-word so the SSE transport and client parser do real work
    for (const word of ANSWER.split(' ')) yield word + ' ';
  }

  async embed(texts: string[], _model: string): Promise<number[][]> {
    // deterministic 64-dim pseudo-embedding (hash-seeded); stable per text
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (let i = 0; i < t.length; i++) v[i % 64] += t.charCodeAt(i);
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
