import { z } from 'zod';
import path from 'node:path';

const Env = z.object({
  // Model provider (OpenAI-compatible: Liara AI, OpenRouter, Ollama, OpenAI, ...)
  AI_BASE_URL: z.string().url().optional(), // e.g. https://ai.liara.ir/api/v1/<workspace>
  AI_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().default('openai/gpt-4.1-mini'),
  AI_MODEL_SMART: z.string().optional(), // defaults to FAST
  AI_EMBEDDINGS_MODEL: z.string().optional(), // unset = lexical-only retrieval

  VERIFY_CLAIMS: z.enum(['on', 'off']).default('on'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Cost accounting (USD per 1M tokens; optional, for estimated_cost metric)
  COST_INPUT_PER_MTOK: z.coerce.number().optional(),
  COST_OUTPUT_PER_MTOK: z.coerce.number().optional(),

  // Security
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(20),
  MAX_INPUT_CHARS: z.coerce.number().int().positive().default(8_000),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(64_000),

  // Paths
  DOCS_DIR: z.string().default(path.join('data', 'liara-docs')),
  INDEX_DIR: z.string().default(path.join('data', 'index')),
  RUNTIME_DIR: z.string().default(path.join('data', 'runtime')),

  // Diagnostics (dev-only unless explicitly enabled)
  DIAG_ENABLED: z.enum(['on', 'off']).optional(),

  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof Env> & {
  aiConfigured: boolean;
  smartModel: string;
  diagEnabled: boolean;
  isProd: boolean;
};

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = Env.parse(process.env);
  const isProd = parsed.NODE_ENV === 'production';
  cached = {
    ...parsed,
    aiConfigured: Boolean(parsed.AI_BASE_URL && parsed.AI_API_KEY),
    smartModel: parsed.AI_MODEL_SMART ?? parsed.AI_MODEL_FAST,
    diagEnabled: parsed.DIAG_ENABLED ? parsed.DIAG_ENABLED === 'on' : !isProd,
    isProd,
  };
  return cached;
}

/** test hook */
export function resetConfigForTests() {
  cached = null;
}
