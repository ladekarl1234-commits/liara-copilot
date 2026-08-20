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

// Skipping is a convenience for a fresh local clone that hasn't run
// `npm run index` yet. In CI it is a lie: the gate certification would vanish
// silently. So under CI the missing index is a hard failure — the pipeline
// must build the index before `npm test` (documented in docs/DEPLOYMENT.md).
if (!HAS_INDEX && process.env.CI) {
  describe('real index certification', () => {
    it('requires a built index in CI (run `npm run index` before `npm test`)', () => {
      throw new Error(`data/index not found at ${INDEX_DIR}; CI must build it before tests`);
    });
  });
}
const d = HAS_INDEX ? describe : describe.skip;

d('real index: evidence gate', () => {
  beforeEach(() => {
    resetIndexForTests();
    resetConfigForTests();
  });
  afterEach(() => resetIndexForTests());

  // These are the queries with NO real Liara vocabulary overlap — gibberish
  // and all-stopword input. They must gate 'low' on a fresh turn. (Off-topic
  // queries that DO share a real word, like a cake "دستور", are deliberately
  // 'medium' — defended by the grounded answer model, see docs/EVALUATION.md.)
  const OFF_TOPIC_LOW = [
    'asdkjhasd qwe zzz',
    'a',
    'چطور؟',
    'about the',
    'zzz qqq www',
    'سلام خوبی؟',
  ];
  for (const q of OFF_TOPIC_LOW) {
    it(`gates off-topic/empty query LOW: ${JSON.stringify(q)}`, async () => {
      const r = await search([q], {}, {}, loadIndex(INDEX_DIR));
      expect(r.confidence).toBe('low');
    });
  }

  it('keeps gibberish low even mid-conversation (priorTurns > 0)', async () => {
    const idx = loadIndex(INDEX_DIR);
    for (const q of ['asdkjhasd qwe zzz', 'zzz qqq www']) {
      const r = await search([q], {}, { priorTurns: 4 }, idx);
      expect(r.confidence, `"${q}" at depth must stay low`).toBe('low');
    }
  });

  it('does NOT gate legit one-concept or full questions low', async () => {
    const idx = loadIndex(INDEX_DIR);
    for (const q of ['چطور دامنه وصل کنم', 'دامنه', 'تنظیم متغیرهای محیطی', 'استقرار برنامه Next.js']) {
      const r = await search([q], {}, {}, idx);
      expect(r.confidence, `"${q}" should not be low`).not.toBe('low');
    }
  });

  it('the landing example chips all retrieve answerable evidence (no refusal)', async () => {
    const idx = loadIndex(INDEX_DIR);
    const chips = [
      'می‌خواهم پروژه‌ام را روی لیارا مستقر کنم؛ از کجا شروع کنم؟',
      'برنامه‌ام روی لیارا به خطا خورده و می‌خواهم علتش را پیدا و رفع کنم.',
      'چطور برنامه‌ام را به دیتابیس روی لیارا متصل کنم؟',
      'چطور دامنه‌ی اختصاصی خودم را به برنامه‌ام روی لیارا وصل کنم؟',
    ];
    for (const q of chips) {
      const r = await search([q], {}, {}, idx);
      expect(r.confidence, `chip "${q.slice(0, 20)}" must not refuse`).not.toBe('low');
    }
  });

  it('a general "deploy my project" query does not surface a niche AI/mirror page first', async () => {
    const idx = loadIndex(INDEX_DIR);
    const r = await search(['می‌خواهم پروژه‌ام را روی لیارا مستقر کنم'], {}, {}, idx);
    const top = r.chunks[0]?.chunk;
    expect(top?.product).not.toBe('ai');
    expect(top?.product).not.toBe('mirrors');
  });

  it('applies the product filter independently of platform (no cross-product leak at real scale)', async () => {
    // enough dbaas/postgresql chunks exist that the <5 fallback never fires,
    // so the product filter is the only thing selecting results
    const r = await search(['اتصال به دیتابیس'], { product: 'dbaas', platform: 'postgresql' }, {}, loadIndex(INDEX_DIR));
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks.every((s) => s.chunk.product === 'dbaas')).toBe(true);
  });
});

d('real index: FAQ cache is a zero-model-call path', () => {
  const provider = (onCall: () => void, answer: string): ModelProvider => ({
    async generate(opts) {
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) return { text: '{"unsupported":[],"note":""}', usage: { inputTokens: 1, outputTokens: 1 } };
      onCall();
      return {
        text: JSON.stringify({ intent: 'question', language: 'fa', action: 'answer', statePatch: {}, retrievalQueries: ['چطور متغیرهای محیطی در Next.js تنظیم کنم'], filters: { platform: 'nextjs' } }),
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
    // Sanity: this query must reach 'high' on the real corpus (a single
    // dominant page), else the cache is never written and the test is vacuous.
    const q = 'چطور متغیرهای محیطی در Next.js تنظیم کنم';
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
