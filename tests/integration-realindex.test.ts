// Integration tests against the REAL on-disk index (data/index). These
// certify the two claims the review said fixtures cannot: the gate returns
// 'low' for a genuinely off-topic query at production corpus scale, and a
// high-confidence answer is cached and replayed with ZERO model calls.
// Skipped automatically when the index has not been built.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { search, loadIndex, resetIndexForTests } from '@/lib/retrieval/index';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { setProviderForTests } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import type { ChatEvent, ModelProvider } from '@/types';

const INDEX_DIR = process.env.INDEX_DIR || path.join('data', 'index');
const HAS_INDEX = fs.existsSync(path.join(INDEX_DIR, 'lexical.json'));
const d = HAS_INDEX ? describe : describe.skip;

d('real index: evidence gate', () => {
  beforeEach(() => {
    resetIndexForTests();
    resetConfigForTests();
  });
  afterEach(() => resetIndexForTests());

  it('gates a cake recipe LOW even though lexical returns hits', async () => {
    const r = await search(['دستور پخت کیک شکلاتی خامه‌ای مرحله به مرحله'], {}, {}, loadIndex(INDEX_DIR));
    expect(r.confidence).toBe('low');
  });

  it('gates gibberish LOW', async () => {
    const r = await search(['asdkjhasd qwe zzz'], {}, {}, loadIndex(INDEX_DIR));
    expect(r.confidence).toBe('low');
  });

  it('does NOT gate a real deployment question low', async () => {
    const r = await search(['استقرار برنامه Next.js در لیارا'], { platform: 'nextjs' }, {}, loadIndex(INDEX_DIR));
    expect(r.confidence).not.toBe('low');
    expect(r.chunks.length).toBeGreaterThan(0);
  });
});

d('real index: FAQ cache is a zero-model-call path', () => {
  const provider = (onCall: () => void, answer: string): ModelProvider => ({
    async generate(opts) {
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) return { text: '{"unsupported":[],"note":""}', usage: { inputTokens: 1, outputTokens: 1 } };
      onCall();
      return {
        text: JSON.stringify({ intent: 'question', language: 'fa', action: 'answer', statePatch: {}, retrievalQueries: ['استقرار برنامه Next.js'], filters: { platform: 'nextjs' } }),
        usage: { inputTokens: 5, outputTokens: 5 },
      };
    },
    async *generateStream() {
      onCall();
      yield answer;
    },
    async embed() {
      return [];
    },
  });

  beforeEach(() => {
    resetIndexForTests();
    resetConfigForTests();
    resetSessionsForTests();
    resetAgentCachesForTests();
    globalThis.__liaraIndex = loadIndex(INDEX_DIR); // pin the real index
    process.env.AI_BASE_URL = 'https://example.invalid/v1';
    process.env.AI_API_KEY = 'k';
    process.env.VERIFY_CLAIMS = 'off';
  });
  afterEach(() => {
    setProviderForTests(null);
    resetIndexForTests();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.VERIFY_CLAIMS;
    resetConfigForTests();
  });

  async function run(message: string): Promise<ChatEvent[]> {
    const events: ChatEvent[] = [];
    await handleChatMessage({ message, requestId: 'r', emit: (e) => events.push(e) });
    return events;
  }

  it('caches a high-confidence first-turn answer and replays it with no model calls', async () => {
    // Sanity: this query must reach 'high' on the real corpus, else the cache
    // is never written and the test would be vacuous.
    const q = 'I have a Next.js application. How do I deploy it?';
    const probe = await search([q], { platform: 'nextjs' }, {}, loadIndex(INDEX_DIR));
    expect(probe.confidence).toBe('high');

    let calls1 = 0;
    setProviderForTests(provider(() => calls1++, 'Use `liara deploy` to ship your Next.js app [1].'));
    const first = await run(q);
    expect(first.at(-1)?.type).toBe('done');
    expect(calls1).toBeGreaterThan(0); // first turn really invoked the model

    // second identical first-turn (fresh session): a cache hit ⇒ 0 model calls
    let calls2 = 0;
    setProviderForTests(provider(() => calls2++, 'should not stream'));
    const second = await run(q);
    expect(calls2).toBe(0);
    expect(second.some((e) => e.type === 'citations')).toBe(true);
    expect(second.at(-1)?.type).toBe('done');
  });
});
