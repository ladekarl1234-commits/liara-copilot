import { z } from 'zod';
import path from 'node:path';
import { DEFAULT_EMBEDDINGS_MODEL } from '@/lib/ai/local-embeddings';

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
  // Retrieval mode. Defaults to `local:` — the in-process multilingual e5 model,
  // which needs NO API key and measurably dominates lexical on every metric
  // (hit@1 45.8% → 60.4%, hit@5 83.3% → 85.4%, MRR 0.619 → 0.719, same
  // false-refusal rate; see benchmarks/retrieval/ and docs/EVALUATION.md).
  // Shipping the weakest mode we had benchmarked was finding EP-PRD-02.
  // Set to '' (empty) to force lexical-only — no model download, no WASM in the
  // server process, ~50 ms less per query. `npm run index` must be re-run after
  // changing this, since it decides whether embeddings.json is built.
  AI_EMBEDDINGS_MODEL: z.string().trim().default(DEFAULT_EMBEDDINGS_MODEL),

  // Deterministic mock LLM for load tests / offline dev (zero external calls).
  LLM_MOCK: z.enum(['on', 'off']).default('off'),

  // Voice: Soniox Speech-to-Text (server-side)
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_MODEL: z.string().default('stt-async-v5'),
  SONIOX_BASE_URL: z.string().url().default('https://api.soniox.com'),
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),

  VERIFY_CLAIMS: z.enum(['on', 'off']).default('on'),
  // Connect / first-token bound for one attempt, AND the idle-gap bound between
  // two streamed chunks. It is NOT a cap on total answer length — see below.
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  // Deadline for ONE provider call including every retry and backoff. Each
  // attempt gets min(MODEL_TIMEOUT_MS, remaining budget) and no attempt starts
  // once the budget is spent, so a hung provider costs ~45s, not the ~91s the
  // old unbounded 3 × MODEL_TIMEOUT_MS + backoff produced (REL-02). Two calls
  // (plan + answer) then still fit inside the route's maxDuration = 120s.
  MODEL_CALL_BUDGET_MS: z.coerce.number().int().positive().default(45_000),
  // Total wall-clock a streaming answer BODY may take, once the first token has
  // arrived. Separate from MODEL_TIMEOUT_MS so a legitimately long answer on a
  // slow free route (1400 tokens at 10-30 tok/s = 47-140s) is not killed
  // mid-sentence by the connect timeout (REL-03/COST-08).
  MODEL_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

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
  // Routing is only a cost lever if the two routes CAN differ (COST-03). When
  // the operator ships our placeholder models on a generic (paid) endpoint,
  // default SMART one tier up so the lever is real out of the box. Two cases
  // deliberately keep smart = fast: OpenRouter (its default IS the free
  // dynamic router — naming a paid slug there would break a free-tier key on
  // ~30% of traffic, so the split is opt-in via AI_MODEL_SMART), and any
  // operator who pinned AI_MODEL_FAST themselves (their endpoint may be Ollama
  // or a single-model gateway where a second slug simply does not exist).
  const smartModel =
    p.AI_MODEL_SMART ?? (usingCustom && !p.AI_MODEL_FAST ? 'openai/gpt-4.1' : fastModel);

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

/** @internal test-only; do not call from app code (EP-MAINT-08). */
export function resetConfigForTests() {
  cached = null;
}
