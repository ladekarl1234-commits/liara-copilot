import { describe, it, expect, afterEach } from 'vitest';
import { config, resetConfigForTests, DEFAULT_CHAT_MODEL } from '@/lib/config';
import { MockLLMProvider } from '@/lib/ai/mock-provider';

const KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_FAST', 'AI_MODEL_SMART', 'LLM_MOCK', 'SONIOX_API_KEY'];
function clearEnv() {
  for (const k of KEYS) delete process.env[k];
  resetConfigForTests();
}

describe('provider resolution (config)', () => {
  afterEach(clearEnv);

  it('defaults to OpenRouter free when only OPENROUTER_API_KEY is set', () => {
    clearEnv();
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    resetConfigForTests();
    const c = config();
    expect(c.providerName).toBe('openrouter');
    expect(c.aiConfigured).toBe(true);
    expect(c.aiBaseUrl).toBe('https://openrouter.ai/api/v1');
    // NOT 'openrouter/free'. That alias routes dynamically and was measured
    // landing on nvidia/nemotron-3.5-content-safety — a safety CLASSIFIER that
    // answers "Say OK" with "User Safety: safe" — on 2 of 6 samples.
    expect(c.fastModel).toBe(DEFAULT_CHAT_MODEL);
    expect(c.smartModel).toBe(DEFAULT_CHAT_MODEL); // defaults to fast
    expect(c.fastModel).not.toBe('openrouter/free');
    // a free slug can 429 without warning, so the gateway needs somewhere to go
    expect(c.modelFallbacks.length).toBeGreaterThan(0);
    expect(c.modelFallbacks).not.toContain(c.fastModel);
    // reasoning tokens are pure latency and spend for grounded RAG
    expect(c.reasoning).toBe(false);
  });

  it('honors OPENROUTER_MODEL as the model default', () => {
    clearEnv();
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.3-8b-instruct:free';
    resetConfigForTests();
    expect(config().fastModel).toBe('meta-llama/llama-3.3-8b-instruct:free');
  });

  it('a generic AI_BASE_URL/AI_API_KEY overrides OpenRouter', () => {
    clearEnv();
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.AI_BASE_URL = 'https://ai.liara.ir/api/v1/ws';
    process.env.AI_API_KEY = 'liara-key';
    resetConfigForTests();
    const c = config();
    expect(c.providerName).toBe('custom');
    expect(c.aiBaseUrl).toBe('https://ai.liara.ir/api/v1/ws');
    expect(c.aiApiKey).toBe('liara-key');
  });

  it('is keyless (not configured) when nothing is set', () => {
    clearEnv();
    const c = config();
    expect(c.aiConfigured).toBe(false);
    expect(c.providerName).toBe('none');
  });

  it('LLM_MOCK=on makes the answer path usable without any key', () => {
    clearEnv();
    process.env.LLM_MOCK = 'on';
    resetConfigForTests();
    const c = config();
    expect(c.llmMock).toBe(true);
    expect(c.aiConfigured).toBe(true);
    expect(c.providerName).toBe('mock');
  });

  it('voiceConfigured tracks SONIOX_API_KEY', () => {
    clearEnv();
    expect(config().voiceConfigured).toBe(false);
    process.env.SONIOX_API_KEY = 'soniox-key';
    resetConfigForTests();
    expect(config().voiceConfigured).toBe(true);
  });
});

describe('MockLLMProvider (deterministic, zero-cost)', () => {
  it('generate returns text + model + usage and reports model via onMeta', async () => {
    const p = new MockLLMProvider();
    let meta: { model?: string } | undefined;
    const r = await p.generate({ model: 'x', messages: [{ role: 'user', content: 'hi' }], onMeta: (m) => (meta = m) });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.model).toBe('mock-llm-v1');
    expect(meta?.model).toBe('mock-llm-v1');
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });

  it('generate returns valid JSON for a structured-output request', async () => {
    const p = new MockLLMProvider();
    const r = await p.generate({ model: 'x', messages: [{ role: 'user', content: 'plan' }], jsonSchema: {} });
    expect(() => JSON.parse(r.text)).not.toThrow();
  });

  it('generateStream yields deltas and calls onMeta', async () => {
    const p = new MockLLMProvider();
    let meta: { model?: string } | undefined;
    let out = '';
    for await (const d of p.generateStream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], onMeta: (m) => (meta = m) })) {
      out += d;
    }
    expect(out.trim().length).toBeGreaterThan(0);
    expect(meta?.model).toBe('mock-llm-v1');
  });

  it('embed is deterministic and normalized', async () => {
    const p = new MockLLMProvider();
    const [a] = await p.embed(['same text'], 'm');
    const [b] = await p.embed(['same text'], 'm');
    expect(a).toEqual(b);
    expect(a.length).toBe(64);
    const norm = Math.hypot(...a);
    expect(norm).toBeCloseTo(1, 5);
  });
});
