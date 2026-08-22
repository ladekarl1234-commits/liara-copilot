import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { config, resetConfigForTests } from '@/lib/config';

const KEYS = [
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_BASE_URL', 'LLM_MOCK',
  'SONIOX_API_KEY', 'SONIOX_MODEL', 'SONIOX_BASE_URL', 'VOICE_MAX_BYTES',
  'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_FAST', 'AI_MODEL_SMART', 'AI_EMBEDDINGS_MODEL',
  'VERIFY_CLAIMS', 'MODEL_TIMEOUT_MS', 'MODEL_MAX_RETRIES',
  'COST_INPUT_PER_MTOK', 'COST_OUTPUT_PER_MTOK',
  'RATE_LIMIT_RPM', 'MAX_INPUT_CHARS', 'MAX_BODY_BYTES',
  'DOCS_DIR', 'INDEX_DIR', 'RUNTIME_DIR', 'DIAG_ENABLED', 'NODE_ENV',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetConfigForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
});

describe('config', () => {
  it('applies defaults', () => {
    const c = config();
    expect(c.fastModel).toBe('openai/gpt-4.1-mini'); // computed default when no provider is configured
    expect(c.VERIFY_CLAIMS).toBe('on');
    expect(c.MODEL_TIMEOUT_MS).toBe(15_000);
    // the three model budgets must compose to less than the route's TURN_BUDGET_MS
    // (50s), or the platform kills the invocation before the app can report why
    expect(c.MODEL_CALL_BUDGET_MS).toBe(18_000);
    expect(c.MODEL_STREAM_TIMEOUT_MS).toBe(35_000);
    expect(c.MODEL_MAX_RETRIES).toBe(2);
    expect(c.RATE_LIMIT_RPM).toBe(20);
    expect(c.MAX_INPUT_CHARS).toBe(8_000);
    expect(c.MAX_BODY_BYTES).toBe(64_000);
    expect(c.DOCS_DIR).toBe(path.join('data', 'liara-docs'));
    expect(c.INDEX_DIR).toBe(path.join('data', 'index'));
    expect(c.NODE_ENV).toBe('development');
    expect(c.isProd).toBe(false);
  });

  it('aiConfigured is true only when both AI_BASE_URL and AI_API_KEY are set', () => {
    expect(config().aiConfigured).toBe(false);

    resetConfigForTests();
    process.env.AI_BASE_URL = 'https://ai.liara.ir/api/v1/ws';
    expect(config().aiConfigured).toBe(false);

    resetConfigForTests();
    delete process.env.AI_BASE_URL;
    process.env.AI_API_KEY = 'secret';
    expect(config().aiConfigured).toBe(false);

    resetConfigForTests();
    process.env.AI_BASE_URL = 'https://ai.liara.ir/api/v1/ws';
    expect(config().aiConfigured).toBe(true);
  });

  it('smartModel falls back to fast model', () => {
    process.env.AI_MODEL_FAST = 'fast-model';
    expect(config().smartModel).toBe('fast-model');

    resetConfigForTests();
    process.env.AI_MODEL_SMART = 'smart-model';
    expect(config().smartModel).toBe('smart-model');
  });

  it('diagEnabled: on in dev, off in prod unless DIAG_ENABLED=on', () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    expect(config().diagEnabled).toBe(true);

    resetConfigForTests();
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(config().diagEnabled).toBe(false);
    expect(config().isProd).toBe(true);

    resetConfigForTests();
    process.env.DIAG_ENABLED = 'on';
    expect(config().diagEnabled).toBe(true); // explicit override in prod

    resetConfigForTests();
    (process.env as Record<string, string>).NODE_ENV = 'development';
    process.env.DIAG_ENABLED = 'off';
    expect(config().diagEnabled).toBe(false); // explicit off wins in dev
  });

  it('coerces numeric env vars from strings', () => {
    process.env.MODEL_TIMEOUT_MS = '5000';
    process.env.RATE_LIMIT_RPM = '7';
    process.env.COST_INPUT_PER_MTOK = '0.4';
    const c = config();
    expect(c.MODEL_TIMEOUT_MS).toBe(5000);
    expect(c.RATE_LIMIT_RPM).toBe(7);
    expect(c.COST_INPUT_PER_MTOK).toBe(0.4);
  });

  it('rejects an invalid AI_BASE_URL', () => {
    process.env.AI_BASE_URL = 'not a url';
    expect(() => config()).toThrow();
  });

  it('rejects non-positive numeric values', () => {
    process.env.MODEL_TIMEOUT_MS = '-1';
    expect(() => config()).toThrow();
  });

  it('caches until reset', () => {
    const c1 = config();
    process.env.RATE_LIMIT_RPM = '99';
    expect(config()).toBe(c1); // cached
    resetConfigForTests();
    expect(config().RATE_LIMIT_RPM).toBe(99);
  });
});
