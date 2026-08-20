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
