import { z } from 'zod';
import path from 'node:path';

const Env = z.object({
  // Model provider (OpenAI-compatible: OpenRouter, Liara AI, Ollama, OpenAI, ...)
  // OpenRouter is the Phase-I default; a generic AI_BASE_URL/AI_API_KEY overrides it.
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('openrouter/free'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),

  AI_BASE_URL: z.string().url().optional(), // e.g. https://ai.liara.ir/api/v1/<workspace>
  AI_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(), // default derives from provider (openrouter/free)
  AI_MODEL_SMART: z.string().optional(), // defaults to FAST
  AI_EMBEDDINGS_MODEL: z.string().optional(), // unset = lexical-only retrieval

  // Deterministic mock LLM for load tests / offline dev (zero external calls).
  LLM_MOCK: z.enum(['on', 'off']).default('off'),

  // Voice: Soniox Speech-to-Text (server-side)
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_MODEL: z.string().default('stt-async-v5'),
  SONIOX_BASE_URL: z.string().url().default('https://api.soniox.com'),
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),

  VERIFY_CLAIMS: z.enum(['on', 'off']).default('on'),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Cost accounting (USD per 1M tokens; optional, for estimated_cost metric)
  COST_INPUT_PER_MTOK: z.coerce.number().optional(),
  COST_OUTPUT_PER_MTOK: z.coerce.number().optional(),

  // Security
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(20),
  // 'on' ONLY when a trusted proxy (Liara LB) sets x-forwarded-for. Default
  // 'off' is fail-closed: a directly-exposed server must not trust a
  // client-spoofable header (which would mint a fresh rate bucket per request).
  TRUST_PROXY: z.enum(['on', 'off']).default('off'),
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

export type ProviderName = 'openrouter' | 'custom' | 'mock' | 'none';

export type Config = z.infer<typeof Env> & {
  /** effective OpenAI-compatible endpoint + key (OpenRouter or generic) */
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiConfigured: boolean; // a real key is set OR mock is on — the answer path is usable
  providerName: ProviderName;
  llmMock: boolean;
  fastModel: string;
  smartModel: string;
  voiceConfigured: boolean;
  diagEnabled: boolean;
  isProd: boolean;
};

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const p = Env.parse(process.env);
  const isProd = p.NODE_ENV === 'production';
  const llmMock = p.LLM_MOCK === 'on';

  // Provider resolution: an explicit AI_BASE_URL/AI_API_KEY wins; otherwise
  // OpenRouter when its key is present. Models default to the provider's model.
  const usingCustom = Boolean(p.AI_BASE_URL && p.AI_API_KEY);
  const usingOpenRouter = !usingCustom && Boolean(p.OPENROUTER_API_KEY);
  const aiBaseUrl = usingCustom ? p.AI_BASE_URL : usingOpenRouter ? p.OPENROUTER_BASE_URL : undefined;
  const aiApiKey = usingCustom ? p.AI_API_KEY : usingOpenRouter ? p.OPENROUTER_API_KEY : undefined;
  const keyed = Boolean(aiBaseUrl && aiApiKey);

  const providerName: ProviderName = llmMock ? 'mock' : usingCustom ? 'custom' : usingOpenRouter ? 'openrouter' : 'none';
  const defaultModel = usingOpenRouter ? p.OPENROUTER_MODEL : 'openai/gpt-4.1-mini';
  const fastModel = p.AI_MODEL_FAST ?? defaultModel;
  const smartModel = p.AI_MODEL_SMART ?? fastModel;

  cached = {
    ...p,
    aiBaseUrl,
    aiApiKey,
    aiConfigured: keyed || llmMock,
    providerName,
    llmMock,
    fastModel,
    smartModel,
    voiceConfigured: Boolean(p.SONIOX_API_KEY),
    diagEnabled: p.DIAG_ENABLED ? p.DIAG_ENABLED === 'on' : !isProd,
    isProd,
  };
  return cached;
}

/** test hook */
export function resetConfigForTests() {
  cached = null;
}
