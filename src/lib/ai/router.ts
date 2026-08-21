// Model routing: cheap model for planning and simple grounded answers,
// stronger model only where it materially improves results.

import type { Intent, Usage } from '@/types';
import { config } from '@/lib/config';

export interface Route {
  model: string;
  label: 'fast' | 'smart';
}

/**
 * Route on the SHAPE of the task, not on the retrieval gate.
 *
 * `confidence !== 'high'` sent ~95% of answers to the smart model (high
 * confidence is 3/61 in evals/results/retrieval-2026-08-20.json) — the cost
 * lever pointed the wrong way (COST-03). Only 'low' confidence means the model
 * has to reason ACROSS thin evidence; 'medium' (42/61) is an ordinary grounded
 * lookup a small model handles, so it goes fast. Multi-step reasoning
 * (troubleshooting hypotheses, workflow planning) still gets the smart model.
 */
export function pickAnswerRoute(intent: Intent, confidence: 'high' | 'medium' | 'low'): Route {
  const cfg = config();
  const needsReasoning =
    intent === 'troubleshooting' || intent === 'workflow' || confidence === 'low';
  return needsReasoning
    ? { model: cfg.smartModel, label: 'smart' }
    : { model: cfg.fastModel, label: 'fast' };
}

export function planRoute(): Route {
  return { model: config().fastModel, label: 'fast' };
}

export function estimateCostUsd(usage: Usage): number | undefined {
  const cfg = config();
  if (cfg.COST_INPUT_PER_MTOK == null || cfg.COST_OUTPUT_PER_MTOK == null) return undefined;
  return (
    (usage.inputTokens * cfg.COST_INPUT_PER_MTOK + usage.outputTokens * cfg.COST_OUTPUT_PER_MTOK) /
    1_000_000
  );
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

/**
 * Language-aware token estimate for when the provider returns no usage object
 * (streaming). Latin text ≈ 4 chars/token; Persian/Arabic script tokenizes
 * denser, but the 2.2 divisor was a guess and over-counted by ~1.3x: measured
 * over 120 Persian chunks from data/index/chunks.json the real ratio is 3.30
 * chars/token on o200k (gpt-4o) and 3.25 on llama3 — the tokenizers the free
 * router actually serves. 3.2 keeps a small safety margin (COST-04).
 * ponytail: an estimate is still an estimate — the exact fix is
 * `stream_options:{include_usage:true}` and reading the final usage chunk,
 * which needs a usage channel on GenerateOptions.onMeta (src/types.ts).
 */
export function estimateTokens(text: string): number {
  let fa = 0;
  for (const ch of text) if (ch >= '؀' && ch <= 'ۿ') fa++;
  const latin = text.length - fa;
  return Math.ceil(latin / 4 + fa / 3.2);
}
