// Integration tests for the per-message pipeline with a scripted fake
// provider and an injected in-memory index — no network, no fs index.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { setProviderForTests, ModelError } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import type { ChatEvent, DocChunk, ModelProvider } from '@/types';

const chunk = (over: Partial<DocChunk>): DocChunk => ({
  id: over.id ?? 'x#0',
  sourcePath: 'public/llms/x.md',
  url: over.url ?? 'https://docs.liara.ir/paas/nextjs/how-tos/set-envs/',
  anchor: over.anchor,
  product: over.product ?? 'paas',
  platform: over.platform,
  title: over.title ?? 'متغیرهای محیطی',
  heading: over.heading,
  headingPath: [over.title ?? 'متغیرهای محیطی'],
  contentType: 'text',
  text: over.text ?? 'برای تنظیم متغیر محیطی در کنسول لیارا وارد بخش تنظیمات شوید.',
  hash: over.id ?? 'h0',
});

function fixtureIndex(): LoadedIndex {
  const chunks = [
    chunk({
      id: 'envs#0',
      title: 'تنظیم متغیرهای محیطی',
      platform: 'nextjs',
      anchor: 'set-envs',
      text: 'برای تنظیم متغیرهای محیطی (environment variables) برنامه، وارد کنسول لیارا شوید و از بخش تنظیمات، متغیرها را اضافه کنید. سپس برنامه را ری‌استارت کنید.',
    }),
    chunk({
      id: 'deploy#0',
      url: 'https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/',
      title: 'استقرار برنامه NextJS',
      platform: 'nextjs',
      text: 'برای استقرار برنامه NextJS از دستور liara deploy استفاده کنید.',
    }),
  ];
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

function scriptedProvider(planJson: object, answer: string): ModelProvider {
  return {
    async generate(opts) {
      // first structured call is the plan; verification also lands here —
      // detect by prompt content
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) {
        return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 10, outputTokens: 5 } };
      }
      return { text: JSON.stringify(planJson), usage: { inputTokens: 20, outputTokens: 10 } };
    },
    async *generateStream() {
      for (const piece of answer.match(/.{1,12}/gs) ?? []) yield piece;
    },
    async embed() {
      throw new Error('not used');
    },
  };
}

async function run(message: string, sessionId?: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await handleChatMessage({ message, sessionId, requestId: 'req-test', emit: (e) => events.push(e) });
  return events;
}

describe('orchestrator', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetSessionsForTests();
    resetIndexForTests();
    resetAgentCachesForTests();
    globalThis.__liaraIndex = fixtureIndex();
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

  it('answers a grounded question with citations and done', async () => {
    setProviderForTests(
      scriptedProvider(
        {
          intent: 'question',
          language: 'fa',
          action: 'answer',
          statePatch: { context: { platform: 'nextjs', product: 'paas' } },
          retrievalQueries: ['تنظیم متغیرهای محیطی'],
          filters: { platform: 'nextjs' },
        },
        'وارد کنسول شوید و متغیر را اضافه کنید [1].',
      ),
    );
    const events = await run('چطور متغیر محیطی اضافه کنم؟');
    const types = events.map((e) => e.type);
    expect(types).toContain('session');
    expect(types).toContain('delta');
    expect(types).toContain('citations');
    expect(types[types.length - 1]).toBe('done');
    const cit = events.find((e) => e.type === 'citations') as Extract<ChatEvent, { type: 'citations' }>;
    expect(cit.citations[0].url).toContain('set-envs');
    expect(cit.citations[0].url).toContain('#set-envs'); // deep anchor
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('کنسول');
  });

  it('gates low-confidence retrieval into an honest insufficient answer', async () => {
    setProviderForTests(
      scriptedProvider(
        {
          intent: 'question',
          language: 'fa',
          action: 'answer',
          statePatch: {},
          retrievalQueries: ['قیمت بلیط قطار مشهد'],
          filters: {},
        },
        'SHOULD NOT BE STREAMED',
      ),
    );
    const events = await run('قیمت بلیط قطار مشهد چنده؟');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).not.toContain('SHOULD NOT');
    expect(text).toMatch(/پیدا نکردم|نیافتم/);
    // a refusal must NOT attach confident-looking citations (COMP-002/UX-002)
    expect(events.some((e) => e.type === 'citations')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('emits clarify question without retrieval when plan says clarify', async () => {
    setProviderForTests(
      scriptedProvider(
        {
          intent: 'troubleshooting',
          language: 'fa',
          action: 'clarify',
          statePatch: {},
          retrievalQueries: [],
          filters: {},
          clarifyQuestion: 'کدام دیتابیس را استفاده می‌کنید و متن دقیق خطا چیست؟',
        },
        'unused',
      ),
    );
    const events = await run('دیتابیسم وصل نمیشه');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('کدام دیتابیس');
  });

  it('runs the Fix flow (ranked hypotheses + state) even when retrieval is weak', async () => {
    // keyless troubleshooting: an error paste that gates low must NOT collapse
    // into a flat refusal — it should reason from the symptom
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    const events = await run('connect ECONNREFUSED 127.0.0.1:5432');
    const tr = events.find((e) => e.type === 'troubleshooting') as Extract<ChatEvent, { type: 'troubleshooting' }>;
    expect(tr, 'a troubleshooting event must be emitted').toBeTruthy();
    expect(tr.state.hypotheses.length).toBeGreaterThanOrEqual(2);
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).not.toMatch(/couldn't find|پیدا نکردم/); // not a bare refusal
    expect(text).toMatch(/check|بررسی/); // a diagnostic step is offered
  });

  it('runs the Guide flow (workflow checklist) for a deploy intent even keyless', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    const events = await run('من Django + PostgreSQL دارم و می‌خواهم روی لیارا مستقر کنم');
    const wf = events.find((e) => e.type === 'workflow') as Extract<ChatEvent, { type: 'workflow' }>;
    expect(wf, 'a workflow event must be emitted').toBeTruthy();
    expect(wf.workflow.steps.length).toBeGreaterThanOrEqual(5);
    expect(wf.workflow.steps.some((s) => s.status === 'current')).toBe(true);
  });

  it('refuses a not-offered feature honestly (GPU) before answering from unrelated pages', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    const events = await run('قیمت پلن GPU برای دیتابیس چنده؟');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toMatch(/ارائه نمی‌شود|isn't an offered/);
    expect(events.some((e) => e.type === 'citations')).toBe(false); // no misleading sources
  });

  it('degrades gracefully without a configured provider (sources only)', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    const events = await run('چطور متغیر محیطی اضافه کنم؟');
    const types = events.map((e) => e.type);
    expect(types).toContain('citations');
    expect(types[types.length - 1]).toBe('done');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('AI_BASE_URL');
  });

  it('maps provider failure to a useful error event', async () => {
    setProviderForTests({
      async generate() {
        // plan call succeeds so the pipeline reaches the answer stage
        return {
          text: JSON.stringify({
            intent: 'question',
            language: 'fa',
            action: 'answer',
            statePatch: {},
            retrievalQueries: ['تنظیم متغیرهای محیطی'],
            filters: {},
          }),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      },
      // eslint-disable-next-line require-yield
      async *generateStream() {
        throw new ModelError('model_unavailable', 'down');
      },
      async embed() {
        return [];
      },
    });
    const events = await run('چطور متغیر محیطی اضافه کنم؟');
    const err = events.find((e) => e.type === 'error') as Extract<ChatEvent, { type: 'error' }>;
    expect(err).toBeTruthy();
    expect(err.code).toBe('model_unavailable');
    expect(err.message).toMatch(/دسترس/);
  });

  it('emits a workflow checklist event when the plan builds one', async () => {
    setProviderForTests(
      scriptedProvider(
        {
          intent: 'workflow',
          language: 'fa',
          action: 'next_step',
          statePatch: {
            workflow: {
              goal: 'استقرار Django + PostgreSQL',
              detected: ['django', 'postgresql'],
              steps: [
                { id: 's1', label: 'ساخت دیتابیس', status: 'current' },
                { id: 's2', label: 'تنظیم متغیرها', status: 'pending' },
              ],
            },
          },
          // query matches the fixture so the gate passes and the answer path
          // (which emits workflow state) runs; the workflow patch itself is
          // what we are asserting, independent of the query
          retrievalQueries: ['تنظیم متغیرهای محیطی'],
          filters: {},
        },
        'ابتدا دیتابیس را بسازید [1].',
      ),
    );
    const events = await run('جنگو با پستگرس دارم، روی لیارا دیپلوی کنم');
    const wf = events.find((e) => e.type === 'workflow') as Extract<ChatEvent, { type: 'workflow' }>;
    expect(wf).toBeTruthy();
    expect(wf.workflow.steps[0].status).toBe('current');
  });

  it('never adopts an unknown caller-supplied id, even when other sessions exist', async () => {
    setProviderForTests(
      scriptedProvider(
        { intent: 'question', language: 'fa', action: 'answer', statePatch: {}, retrievalQueries: ['متغیر محیطی'], filters: {} },
        'پاسخ [1].',
      ),
    );
    // seed a REAL session so the store is non-empty (otherwise "unknown id
    // rejected" is trivially true because every id is unknown)
    const seed = await run('سوال اول');
    const realId = (seed.find((e) => e.type === 'session') as Extract<ChatEvent, { type: 'session' }>).sessionId;
    expect(realId).toBeTruthy();

    // an attacker supplies a DIFFERENT, guessed id → must not be adopted
    const attacker = 'victim00-guessed-id';
    const ev = await run('سلام سوال دارم', attacker);
    const sid = (ev.find((e) => e.type === 'session') as Extract<ChatEvent, { type: 'session' }>).sessionId;
    expect(sid).not.toBe(attacker); // fresh server UUID, not the attacker's id
    expect(sid).not.toBe(realId); // and not someone else's live session

    // sanity: a caller CAN still resume their OWN real id (functionality intact)
    const resumed = await run('سوال دوم', realId);
    const rid = (resumed.find((e) => e.type === 'session') as Extract<ChatEvent, { type: 'session' }>).sessionId;
    expect(rid).toBe(realId);
  });

  it('remembers session context across turns', async () => {
    setProviderForTests(
      scriptedProvider(
        {
          intent: 'question',
          language: 'fa',
          action: 'answer',
          statePatch: { context: { platform: 'nextjs', product: 'paas' } },
          retrievalQueries: ['استقرار NextJS'],
          filters: { platform: 'nextjs' },
        },
        'پاسخ [2].',
      ),
    );
    const first = await run('برنامه من Next.js است. چطور مستقرش کنم؟');
    const sid = (first.find((e) => e.type === 'session') as Extract<ChatEvent, { type: 'session' }>).sessionId;
    const second = await run('قدم بعدی چیست؟', sid);
    const ctx = second.find((e) => e.type === 'context') as Extract<ChatEvent, { type: 'context' }>;
    expect(ctx?.chips.join(' ')).toContain('Next.js');
  });
});
