// Deterministic, zero-cost ModelProvider. Two jobs:
//   1. Load testing — exercise retrieval, streaming, and HTTP plumbing without
//      spending live OpenRouter quota (see scripts/benchmark-load.mjs).
//   2. Offline dev — a runnable answer path with no API key.
// It NEVER makes a network call and NEVER reflects real model quality, so it is
// unfit for LLM-quality evaluation (that uses a real key, bounded — see docs).

import type { GenerateOptions, GenerateResult, ModelProvider } from '@/types';

const MODEL = 'mock-llm-v1';

// A citation-shaped grounded answer. The [1]/[2] markers let the citation
// extractor and the streaming UI run their real code paths under load, and the
// length is deliberately >200 chars so the claim-verification call ACTUALLY
// RUNS — verify.ts skips answers shorter than that, so the old short mock made
// the load benchmark measure a pipeline missing an entire model call and ~42%
// of per-turn input tokens (EP-SCALE-03).
const ANSWER =
  'برای انجام این کار طبق مستندات رسمی لیارا مراحل زیر را دنبال کنید [1]. ' +
  'ابتدا تنظیمات پروژه را بررسی کنید و مطمئن شوید فایل پیکربندی در ریشه‌ی پروژه وجود دارد. ' +
  'سپس متغیرهای محیطی لازم را در پنل تعریف کنید و برنامه را ری‌استارت کنید [2]. ' +
  'اگر پس از این مراحل همچنان خطا دیدید، لاگ‌های برنامه را بررسی کنید؛ ' +
  'جزئیات کامل هر مرحله در منابع زیر آمده است.';

// A structurally valid plan. Returning `{}` (the old behavior) always failed
// PlanSchema and silently dropped the load test onto the deterministic
// fallbackPlan path — so the benchmark never exercised plan parsing, the
// LLM-rewritten multi-query retrieval, or the metadata filters that production
// actually runs (EP-SCALE-03).
const PLAN = JSON.stringify({
  intent: 'question',
  language: 'fa',
  action: 'answer',
  statePatch: { context: { product: 'paas' } },
  retrievalQueries: ['استقرار برنامه روی لیارا', 'تنظیم متغیر محیطی', 'liara deploy'],
  filters: {},
});

// The verifier asks for a different shape; answering it with the PLAN would
// fail its schema and disable verification again. Both are structured calls, so
// they are told apart the same way the orchestrator's own tests do it.
const VERDICT = JSON.stringify({ unsupported: [], note: '' });

function usageFor(inChars: number, outText: string) {
  return { inputTokens: Math.ceil(inChars / 4), outputTokens: Math.ceil(outText.length / 4) };
}

export class MockLLMProvider implements ModelProvider {
  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    opts.onMeta?.({ model: MODEL });
    const inChars = opts.messages.reduce((n, m) => n + m.content.length, 0);
    const system = opts.messages[0]?.content ?? '';
    const text = opts.jsonSchema
      ? system.includes('grounding checker')
        ? VERDICT
        : PLAN
      : ANSWER;
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
