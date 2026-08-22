import { z } from 'zod';
import path from 'node:path';
import { DEFAULT_EMBEDDINGS_MODEL } from '@/lib/ai/local-embeddings';

/**
 * The pinned default chat model, and the chain tried after it.
 *
 * Selected by measurement, not reputation — see specs/phase-iii-vercel.md §2.
 * Requirements this had to meet: instruction-following strong enough to keep
 * `[n]` citations, correct Persian, parseable JSON for the planner, a context
 * window that fits the evidence block, and a free tier that answers instead of
 * 429-ing. Candidates rejected: gemma-4-31b / gemma-4-26b / glm-5.2 (HTTP 429
 * on every attempt), nemotron-3.5-lightning (reasoning model, 21.9s TTFT),
 * openrouter/free (routes to a safety classifier — see OPENROUTER_MODEL).
 */
export const DEFAULT_CHAT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
/**
 * Ordered by MEASURED tail latency, not by parameter count. A fallback exists
 * to bound the worst case, so one whose tail is worse than the primary's is
 * worse than having no fallback at all.
 *
 * From benchmarks/models/bakeoff-2026-08-22.json — the app's real answer prompt
 * (avg 8,297 chars of Persian evidence) over 8 committed eval cases:
 *
 *   model                     ttft p50   ttft p95   cite    err
 *   nemotron-3-super-120b     1066 ms     5931 ms   0.875   0      <- primary
 *   nemotron-3-nano-30b       1062 ms     1568 ms   0.75    0
 *   dots-3-note-preview       1519 ms     2962 ms   0.75    0
 *   nemotron-nano-12b-v2-vl   3139 ms    43640 ms   0.875   0      <- DROPPED
 *   nemotron-3-ultra-550b     1617 ms    41656 ms   1.0     0.25   <- DROPPED
 *   inkling-small                    —          —   —       1.0    <- DROPPED
 *
 * The dropped models carry 40-second tails; falling back to one of them turns
 * a slow turn into a dead one.
 */
export const DEFAULT_FALLBACKS = [
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'dots-studio/dots-3-note-preview:free',
];

const Env = z.object({
  // Model provider (OpenAI-compatible: OpenRouter, Liara AI, Ollama, OpenAI, ...)
  // OpenRouter is the Phase-I default; a generic AI_BASE_URL/AI_API_KEY overrides it.
  OPENROUTER_API_KEY: z.string().optional(),
  // NOT `openrouter/free`. That alias is a dynamic router, and it routes to
  // models that cannot do this job. Measured 2026-08-22, six samples of the
  // prompt "Say OK": two landed on `nvidia/nemotron-3.5-content-safety:free`
  // — a safety CLASSIFIER — which replied "User Safety: safe". A third sample
  // returned content:null with the whole budget spent on reasoning tokens.
  // Shipping that alias means ~1/3 of answers are garbage and the planner's
  // JSON never parses, so planning silently degrades to regex on every turn.
  // The default is now a pinned, benchmarked model (§2 of specs/phase-iii-vercel.md).
  OPENROUTER_MODEL: z.string().default(DEFAULT_CHAT_MODEL),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // Comma-separated fallback preference list sent as OpenRouter's `models`
  // array. Free-tier slugs 429 without warning (gemma-4 and glm-5.2 did so on
  // every attempt while this was measured), so a single pinned model is a
  // single point of failure. The gateway walks the list server-side, which
  // costs no extra round-trip. Ignored by providers that do not support it.
  AI_MODEL_FALLBACKS: z.string().default(DEFAULT_FALLBACKS.join(',')),
  // Provider-side reasoning tokens. Off by default: they are pure latency and
  // spend for a grounded-RAG answer. Measured, same prompt and model —
  // nemotron-3-nano-30b TTFT 3330ms/81 output tokens with reasoning off vs
  // 7350ms/311 tokens (329 reasoning) with it on.
  AI_REASONING: z.enum(['on', 'off']).default('off'),

  AI_BASE_URL: z.string().url().optional(), // e.g. https://ai.liara.ir/api/v1/<workspace>
  AI_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(), // default derives from provider (OPENROUTER_MODEL)
  AI_MODEL_SMART: z.string().optional(), // defaults to FAST
  // Retrieval mode. Defaults to a PROVIDER-HOSTED model (see
  // DEFAULT_EMBEDDINGS_MODEL). Measured on the same corpus and eval set,
  // hybrid vs lexical-only: hit@5 0.833 → 0.938, MRR 0.630 → 0.776,
  // evidence-recall 0.792 → 0.917. Shipping the weakest mode we had
  // benchmarked was finding EP-PRD-02.
  // `local:` (in-process WASM) is still supported for the Docker image, which
  // bakes the weights in; it is not deployable serverlessly.
  // Set to '' (empty) to force lexical-only.
  // This MUST match the model recorded in data/index/vectors.json — loadIndex()
  // refuses to compare a query vector against passages from a different model.
  AI_EMBEDDINGS_MODEL: z.string().trim().default(DEFAULT_EMBEDDINGS_MODEL),

  // Deterministic mock LLM for load tests / offline dev (zero external calls).
  LLM_MOCK: z.enum(['on', 'off']).default('off'),

  // Voice: Soniox Speech-to-Text (server-side)
  SONIOX_API_KEY: z.string().optional(),
  SONIOX_MODEL: z.string().default('stt-async-v5'),
  SONIOX_BASE_URL: z.string().url().default('https://api.soniox.com'),
  // Vercel rejects request bodies over 4.5 MB at the edge, before the function
  // runs — so an 8 MB ceiling there is not a ceiling, it is an unreachable
  // error path: the user gets an opaque platform 413 instead of the app's own
  // "recording too long" message. Stay under the platform limit where there is
  // one. ~4 MB of Opus/WebM is still several minutes of speech.
  VOICE_MAX_BYTES: z.coerce.number().int().positive().default(process.env.VERCEL ? 4_000_000 : 8_000_000),

  VERIFY_CLAIMS: z.enum(['on', 'off']).default('on'),
  // Connect / first-token bound for one attempt, AND the idle-gap bound between
  // two streamed chunks. It is NOT a cap on total answer length — see below.
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  // Deadline for ONE provider call including every retry and backoff. Each
  // attempt gets min(MODEL_TIMEOUT_MS, remaining budget) and no attempt starts
  // once the budget is spent (REL-02).
  //
  // Sized against the ROUTE, not against a hope: /api/chat has maxDuration=60
  // and aborts its own turn at TURN_BUDGET_MS=50s. The three calls in a turn
  // (plan, answer, verify) must fit inside that, so 18s each. Measured on the
  // pinned model a turn costs ~5-8s end to end, so this is ~7x headroom on the
  // worst call and still leaves the platform out of it. The old 45s/90s pair
  // composed to ~225s against a 120s route: the platform killed the invocation
  // mid-stream and the app never found out.
  MODEL_CALL_BUDGET_MS: z.coerce.number().int().positive().default(18_000),
  // The PLANNER's own, much tighter budget. It is the first thing on the
  // critical path, so every millisecond it spends is a millisecond before the
  // user sees any text — and unlike the answer call it has a free, already
  // computed fallback (the deterministic pre-pass), so waiting is strictly
  // worse than giving up. Measured on the deployed app before this existed:
  // plan latency 2779 / 2558 / 15636 / 15670 / 9445 ms — the two 15.6s rows
  // were the call running out the 15s attempt timeout and falling back ANYWAY,
  // having bought nothing but a 15-second stare at a spinner.
  PLAN_BUDGET_MS: z.coerce.number().int().positive().default(4_000),
  // Verification runs AFTER the answer has streamed, so it does not delay a
  // single word the user reads — but it does delay `done`, and the composer
  // stays disabled until then. Measured post-stream cost on the deployed app
  // before this bound: 2105 / 4602 / 3499 / 14030 ms. A 14-second wait after
  // the answer is already on screen reads as a hang. Past the budget the check
  // is skipped and logged, which is the same path an unparseable verifier takes.
  VERIFY_BUDGET_MS: z.coerce.number().int().positive().default(6_000),
  // Total wall-clock a streaming answer BODY may take, once the first token has
  // arrived. Separate from MODEL_TIMEOUT_MS so a legitimately long answer is not
  // killed mid-sentence by the connect timeout (REL-03/COST-08). 1400 tokens at
  // the measured rate on the pinned model fits well inside 35s.
  MODEL_STREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(35_000),

  // Wall-clock bound on ONE query-side embedding call. The local model is meant
  // to be on disk already (the Dockerfile bakes TRANSFORMERS_CACHE into the
  // image); if it is not, Transformers.js fetches ~90 MB from the HF hub inside
  // the request. Measured on a cold cache that ran past 100s with no answer
  // streamed and nothing bounding it. Past this budget the embed rejects and
  // search() degrades to lexical-only for that request (the load continues in
  // the background, so the next request gets hybrid back). A warm load measured
  // 766ms end-to-end and a warm embed 5ms, so 10s is ~13x headroom.
  EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Cost accounting (USD per 1M tokens; optional, for estimated_cost metric)
  COST_INPUT_PER_MTOK: z.coerce.number().optional(),
  COST_OUTPUT_PER_MTOK: z.coerce.number().optional(),

  // Security
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(20),
  // 'on' ONLY when a trusted proxy (Liara LB, Vercel edge) sets x-forwarded-for.
  // Default is fail-closed ('off'): a directly-exposed server must not trust a
  // client-spoofable header. But on a platform that ALWAYS terminates at its
  // own edge and rewrites these headers, 'off' is the unsafe answer, not the
  // safe one — clientIp() then returns the literal 'direct' for every visitor
  // on earth and the whole deployment shares one RATE_LIMIT_RPM bucket. Vercel
  // sets x-real-ip and appends to x-forwarded-for at the edge, which is exactly
  // the single-trusted-proxy shape clientIp() already handles, so detect it
  // rather than making correct rate limiting depend on someone remembering an
  // env var. An explicit TRUST_PROXY still wins.
  TRUST_PROXY: z.enum(['on', 'off']).default(process.env.VERCEL ? 'on' : 'off'),
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
  /** extra models the gateway may fall back to, in order; [] disables the feature */
  modelFallbacks: string[];
  /** send provider-side reasoning tokens (default false — latency and spend) */
  reasoning: boolean;
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
    // Only meaningful for OpenRouter; a generic OpenAI-compatible endpoint
    // ignores an unknown `models` key, but sending our OpenRouter-specific
    // slugs to someone else's gateway is noise, so scope it to the provider
    // that defines the feature.
    modelFallbacks:
      providerName === 'openrouter'
        ? p.AI_MODEL_FALLBACKS.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    reasoning: p.AI_REASONING === 'on',
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
