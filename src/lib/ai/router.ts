// Model routing: cheap model for planning and simple grounded answers,
// stronger model only where it materially improves results.

import type { Intent, Usage } from '@/types';
import { config } from '@/lib/config';

export interface Route {
  model: string;
  label: 'fast' | 'smart';
}

export function pickAnswerRoute(intent: Intent, confidence: 'high' | 'medium' | 'low'): Route {
  const cfg = config();
  const needsReasoning =
    intent === 'troubleshooting' || intent === 'workflow' || confidence !== 'high';
  return needsReasoning
    ? { model: cfg.smartModel, label: 'smart' }
    : { model: cfg.AI_MODEL_FAST, label: 'fast' };
}

export function planRoute(): Route {
  return { model: config().AI_MODEL_FAST, label: 'fast' };
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
 * (streaming). Latin text ≈ 4 chars/token; Persian/Arabic script tokenizes far
 * denser (multi-byte, frequent sub-word splits) ≈ 2.2 chars/token — a flat
 * chars/4 under-counted Persian input by ~40% (OBS2-001/COST-R2-03).
 */
export function estimateTokens(text: string): number {
  let fa = 0;
  for (const ch of text) if (ch >= '؀' && ch <= 'ۿ') fa++;
  const latin = text.length - fa;
  return Math.ceil(latin / 4 + fa / 2.2);
}
