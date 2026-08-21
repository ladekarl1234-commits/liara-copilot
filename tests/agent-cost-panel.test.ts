// Expert-panel regressions owned by src/lib/agent/**:
//   EP-COST-05  answer/verify prompts are capped at 5 evidence chunks
//   EP-COST-11  concurrent identical questions share one generation
//   EP-ARCH-09 / EP-REL-09  finish() writes into the live session, not a re-lookup
//   EP-AGT-10   a stale platform does not survive a product topic switch
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { setProviderForTests } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { getOrCreateSession, applyPatch, contextChips, resetSessionsForTests } from '@/lib/state/sessions';
import { preClassify, fallbackPlan } from '@/lib/agent/plan';
import type { ChatEvent, DocChunk, ModelProvider, SessionState } from '@/types';

const chunk = (i: number): DocChunk => ({
  id: `env${i}#0`,
  sourcePath: `public/llms/env${i}.md`,
  url: `https://docs.liara.ir/paas/nextjs/how-tos/set-envs-${i}/`,
  product: 'paas',
  platform: 'nextjs',
  title: `متغیر محیطی شماره ${i}`,
  headingPath: [`متغیر محیطی شماره ${i}`],
  contentType: 'text',
  // distinct bodies (the selector dedups identical ones) that all match the query
  text: `روش شماره ${i} برای تنظیم متغیرهای محیطی environment variables در کنسول لیارا و ری‌استارت برنامه.`,
  hash: `h${i}`,
});

/** 8 near-equally-scoring chunks so the evidence selector fills its budget. */
function wideIndex(): LoadedIndex {
  const chunks = Array.from({ length: 8 }, (_, i) => chunk(i + 1));
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return {
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    lexical,
    vectors: null,
    meta: { builtAt: 'test', chunkCount: chunks.length, anchorCoverage: 0.5, lexicalVersion: 2 },
  };
}

const PLAN = {
  intent: 'question',
  language: 'fa',
  action: 'answer',
  statePatch: {},
  retrievalQueries: ['تنظیم متغیرهای محیطی'],
  filters: {},
};

interface Recorder {
  provider: ModelProvider;
  answerPrompts: string[];
  verifyPrompts: string[];
  streams: number;
}

function recordingProvider(answer: string, delayMs = 0): Recorder {
  const rec: Recorder = { answerPrompts: [], verifyPrompts: [], streams: 0, provider: null as unknown as ModelProvider };
  rec.provider = {
    async generate(opts) {
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) {
        rec.verifyPrompts.push(opts.messages[1]?.content ?? '');
        return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 10, outputTokens: 5 } };
      }
      return { text: JSON.stringify(PLAN), usage: { inputTokens: 20, outputTokens: 10 } };
    },
    async *generateStream(opts) {
      rec.streams += 1;
      rec.answerPrompts.push(opts.messages[0]?.content ?? '');
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      yield answer;
    },
    async embed() {
      throw new Error('not used');
    },
  };
  return rec;
}

async function run(message: string, sessionId?: string, onEvent?: (e: ChatEvent) => void): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await handleChatMessage({
    message,
    sessionId,
    requestId: 'req-test',
    emit: (e) => {
      events.push(e);
      onEvent?.(e);
    },
  });
  return events;
}

describe('agent cost/state panel regressions', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetSessionsForTests();
    resetIndexForTests();
    resetAgentCachesForTests();
    globalThis.__liaraIndex = wideIndex();
    process.env.AI_BASE_URL = 'https://example.invalid/v1';
    process.env.AI_API_KEY = 'test-key';
    process.env.VERIFY_CLAIMS = 'on';
  });
  afterEach(() => {
    setProviderForTests(null);
    resetIndexForTests();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.VERIFY_CLAIMS;
    resetConfigForTests();
  });

  // ---- EP-COST-05 -------------------------------------------------------
  it('sends at most 5 evidence chunks to the answer prompt even when 8 were retrieved', async () => {
    const rec = recordingProvider('تنظیمات را در کنسول انجام دهید [1].');
    setProviderForTests(rec.provider);
    await run('چطور متغیرهای محیطی environment variables را تنظیم کنم؟');

    expect(rec.answerPrompts).toHaveLength(1);
    const prompt = rec.answerPrompts[0];
    expect(prompt).toContain('[5] متغیر محیطی');
    expect(prompt).not.toContain('[6] متغیر محیطی');
    expect(prompt).not.toContain('[7] متغیر محیطی');
    expect(prompt).not.toContain('[8] متغیر محیطی');
  });

  it('never resolves a citation marker the model was not shown', async () => {
    // [7] is out of the 5-chunk window the model actually saw, so it must fall
    // back to the top-3 rather than silently citing chunk 7.
    // >200 chars so the verify stage actually runs and can be asserted on too
    const rec = recordingProvider('این کار را انجام دهید [7]. ' + 'توضیح تکمیلی درباره‌ی تنظیم متغیرهای محیطی. '.repeat(8));
    setProviderForTests(rec.provider);
    const events = await run('چطور متغیرهای محیطی environment variables را تنظیم کنم؟');

    const cites = events.find((e) => e.type === 'citations');
    expect(cites?.type === 'citations' && cites.citations.length).toBe(3);
    const urls = cites?.type === 'citations' ? cites.citations.map((c) => c.url) : [];
    expect(urls.some((u) => u.includes('set-envs-7'))).toBe(false);
    // and the verify call is fenced to the same window
    expect(rec.verifyPrompts[0]).not.toContain('set-envs-7');
  });

  // ---- EP-COST-11 -------------------------------------------------------
  it('runs ONE generation for two concurrent identical questions', async () => {
    const rec = recordingProvider('پاسخ مشترک برای هر دو درخواست [1].', 20);
    setProviderForTests(rec.provider);
    const q = 'چطور متغیرهای محیطی environment variables را تنظیم کنم؟';

    const [a, b] = await Promise.all([run(q), run(q)]);

    expect(rec.streams).toBe(1); // the follower paid for no model call at all
    const textOf = (evts: ChatEvent[]) =>
      evts.filter((e) => e.type === 'delta').map((e) => (e.type === 'delta' ? e.text : '')).join('');
    expect(textOf(b)).toBe(textOf(a));
    expect(textOf(b)).toContain('پاسخ مشترک');
    // both turns still ended exactly once
    expect(a.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(b.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('lets the follower run its own pipeline when the leader cached nothing', async () => {
    // VERIFY off + an unsupported claim is not the trigger here: simply make the
    // answer uncacheable by keeping a stateful session, so no key is shared.
    const rec = recordingProvider('پاسخ [1].', 20);
    setProviderForTests(rec.provider);
    const s1 = getOrCreateSession();
    const s2 = getOrCreateSession();
    s1.context.platform = 'nextjs';
    s2.context.platform = 'nextjs';
    const q = 'چطور متغیرهای محیطی environment variables را تنظیم کنم؟';

    await Promise.all([run(q, s1.id), run(q, s2.id)]);
    expect(rec.streams).toBe(2);
  });

  // ---- EP-ARCH-09 / EP-REL-09 -------------------------------------------
  it('records the turn on the live session even if the store is evicted mid-turn', async () => {
    const rec = recordingProvider('پاسخ [1].');
    setProviderForTests(rec.provider);
    const live = getOrCreateSession();
    const id = live.id;

    // wipe the store after the answer is streamed but before finish() runs —
    // the same shape as LRU eviction / TTL expiry under a 5000-session churn
    await run('چطور متغیرهای محیطی environment variables را تنظیم کنم؟', id, (e) => {
      if (e.type === 'citations') resetSessionsForTests();
    });

    // the old code re-derived the session by id inside finish(), minting a
    // phantom session and leaving the live object at turns=0
    expect(live.turns).toBe(1);
    expect(live.summary).toContain('U:');
    expect(getOrCreateSession(id)).toBe(live);
  });

  // ---- EP-AGT-10 --------------------------------------------------------
  describe('stale platform on a product topic switch', () => {
    const withContext = (over: Partial<SessionState['context']>): SessionState => {
      const s = getOrCreateSession();
      s.context = { triedActions: [], ...over };
      return s;
    };

    it('clears context.platform when the message names its own non-PaaS product', () => {
      const state = withContext({ platform: 'nextjs', product: 'paas' });
      const msg = 'قیمت object storage چنده؟';
      const plan = fallbackPlan(msg, preClassify(msg), state);

      expect(plan.statePatch.clearContext).toContain('platform');
      applyPatch(state, plan.statePatch, plan.language, plan.intent);
      expect(state.context.platform).toBeUndefined();
      expect(state.context.product).toBe('object-storage');
      expect(contextChips(state).some((c) => /next/i.test(c))).toBe(false);
    });

    it('keeps the platform when the message stays on the same product', () => {
      const state = withContext({ platform: 'nextjs', product: 'paas' });
      const msg = 'چطور متغیر محیطی اضافه کنم؟';
      const plan = fallbackPlan(msg, preClassify(msg), state);

      expect(plan.statePatch.clearContext ?? []).not.toContain('platform');
      applyPatch(state, plan.statePatch, plan.language, plan.intent);
      expect(state.context.platform).toBe('nextjs');
    });

    it('keeps the platform when the switching message names one itself', () => {
      const state = withContext({ platform: 'nextjs', product: 'paas' });
      const msg = 'چطور از django به object storage وصل شم؟';
      const plan = fallbackPlan(msg, preClassify(msg), state);

      expect(plan.statePatch.clearContext ?? []).not.toContain('platform');
      applyPatch(state, plan.statePatch, plan.language, plan.intent);
      expect(state.context.platform).toBe('django');
    });
  });
});
