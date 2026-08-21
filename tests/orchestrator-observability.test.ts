// Regression locks for the expert-panel findings routed through the
// orchestrator: EP-RET-01, EP-OBS-01..04, EP-REL-01, EP-ANS-03, EP-COST-02,
// EP-PRD-04. Every case here FAILS against the pre-fix code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { NextRequest } from 'next/server';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import * as embedModule from '@/lib/retrieval/embed';
import { setProviderForTests } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import { lastTraces } from '@/lib/obs/trace';
import { POST as feedbackPOST } from '@/app/api/feedback/route';
import type { ChatEvent, DocChunk, ModelProvider } from '@/types';

function fixtureIndex(): LoadedIndex {
  const chunks: DocChunk[] = [
    {
      id: 'envs#0',
      sourcePath: 'public/llms/paas/nextjs/set-envs.md',
      url: 'https://docs.liara.ir/paas/nextjs/how-tos/set-envs/',
      anchor: 'set-envs',
      product: 'paas',
      platform: 'nextjs',
      title: 'تنظیم متغیرهای محیطی',
      heading: 'تنظیم',
      headingPath: ['تنظیم متغیرهای محیطی'],
      contentType: 'text',
      text: 'برای تنظیم متغیرهای محیطی (environment variables) و DATABASE_URL برنامه، وارد کنسول لیارا شوید و از بخش تنظیمات متغیرها را اضافه کنید.',
      hash: 'envs',
    },
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return { chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical, vectors: null, meta: { builtAt: 't', chunkCount: 1, anchorCoverage: 1, lexicalVersion: 2 } };
}

const QUESTION = 'چطور متغیر محیطی و DATABASE_URL تنظیم کنم؟';
const PLAN = { intent: 'question', language: 'fa', action: 'answer', statePatch: {}, retrievalQueries: [QUESTION], filters: {} };
// >=200 chars so verifyAnswer actually runs (verify.ts skips shorter answers)
const LONG_ANSWER =
  'برای تنظیم متغیرهای محیطی وارد کنسول لیارا شوید [1]. سپس از بخش تنظیمات برنامه، مقدار DATABASE_URL و سایر متغیرهای مورد نیاز را اضافه کنید و برنامه را دوباره راه‌اندازی کنید تا تغییرات اعمال شود و اتصال به دیتابیس برقرار گردد. این کار برای هر برنامه‌ای که روی لیارا مستقر می‌شود لازم است.';

function countingProvider(calls: { n: number }, answer = LONG_ANSWER, plan: object = PLAN): ModelProvider {
  return {
    async generate(opts) {
      calls.n++;
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 1, outputTokens: 1 } };
      return { text: JSON.stringify(plan), usage: { inputTokens: 5, outputTokens: 5 } };
    },
    async *generateStream() {
      calls.n++;
      for (const piece of answer.match(/.{1,20}/gs) ?? []) yield piece;
    },
    async embed() {
      throw new Error('not used');
    },
  };
}

async function run(message: string, requestId: string, sessionId?: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await handleChatMessage({ message, sessionId, requestId, emit: (e) => events.push(e) });
  return events;
}

describe('orchestrator observability + fixes (EP-RET-01, EP-OBS-01..04, EP-REL-01, EP-ANS-03, EP-COST-02)', () => {
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
    delete process.env.AI_EMBEDDINGS_MODEL;
    resetConfigForTests();
    vi.restoreAllMocks();
  });

  it('EP-RET-01: wires embedQuery via queryEmbedder(), reachable with no provider configured', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    process.env.AI_EMBEDDINGS_MODEL = 'local:some-test-model';
    resetConfigForTests();
    const spy = vi.spyOn(embedModule, 'queryEmbedder');
    await run(QUESTION, 'req-ret01');
    // Before the fix, orchestrator built embedQuery inline gated on `provider`
    // and never called queryEmbedder() at all — this call is the wiring itself.
    expect(spy).toHaveBeenCalled();
    // a `local:` model must resolve to a usable embedder with NO provider/API key
    expect(typeof spy.mock.results[0]?.value).toBe('function');
  });

  it('EP-OBS-02: no provider configured -> planRoute "none" (no model call attempted)', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    await run(QUESTION, 'req-none');
    expect(lastTraces(1)[0].planRoute).toBe('none');
  });

  it('EP-OBS-02: a successful structured plan call -> planRoute "model"', async () => {
    setProviderForTests(countingProvider({ n: 0 }));
    await run(QUESTION, 'req-model');
    expect(lastTraces(1)[0].planRoute).toBe('model');
  });

  it('EP-OBS-02: unparseable plan JSON silently degrades -> planRoute "fallback" + a warn log with a reason', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
      logs.push(String(s));
    });
    setProviderForTests({
      async generate() {
        return { text: 'NOT VALID JSON !!!', usage: { inputTokens: 1, outputTokens: 1 } };
      },
      async *generateStream() {
        throw new Error('not used');
      },
      async embed() {
        throw new Error('not used');
      },
    });
    await run('قیمت بلیط قطار مشهد چنده؟', 'req-fallback');
    expect(lastTraces(1)[0].planRoute).toBe('fallback');
    const fallbackLine = logs.find((l) => l.includes('"event":"plan_fallback"'));
    expect(fallbackLine, 'a plan_fallback warning must be logged').toBeTruthy();
    expect(fallbackLine).toContain('"reason":"parse-error"');
    spy.mockRestore();
  });

  it('EP-OBS-03 / EP-OBS-01 / EP-OBS-04: verified, unsupportedClaims, messageId and outcome all land in the trace', async () => {
    setProviderForTests(countingProvider({ n: 0 }));
    const events = await run(QUESTION, 'req-verify');
    const done = events.find((e): e is Extract<ChatEvent, { type: 'done' }> => e.type === 'done')!;
    expect(done.messageId).toBe('req-verify'); // EP-OBS-01: messageId === requestId
    const trace = lastTraces(1)[0];
    expect(trace.requestId).toBe('req-verify');
    expect(trace.messageId).toBe('req-verify');
    expect(trace.outcome).toBe('answered'); // EP-OBS-04
    expect(trace.verified).toBe(true); // EP-OBS-03: the >=200-char answer WAS checked
    expect(trace.unsupportedClaims).toBe(0);
  });

  it('EP-OBS-03: verification disabled logs verify_skipped with a reason distinguishing it from "checked, clean"', async () => {
    process.env.VERIFY_CLAIMS = 'off'; // config.ts defaults to 'on', so this must be explicit
    resetConfigForTests();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s: unknown) => {
      logs.push(String(s));
    });
    setProviderForTests(countingProvider({ n: 0 }));
    await run(QUESTION, 'req-skip');
    const trace = lastTraces(1)[0];
    expect(trace.verified).toBe(false);
    const skipLine = logs.find((l) => l.includes('"event":"verify_skipped"'));
    expect(skipLine, 'a verify_skipped warning must be logged').toBeTruthy();
    expect(skipLine).toContain('"reason":"disabled"');
    spy.mockRestore();
  });

  it('EP-REL-01: answer-model failure with usable evidence in hand degrades to sources, not a bare error', async () => {
    setProviderForTests({
      async generate(opts) {
        const sys = opts.messages[0]?.content ?? '';
        if (sys.includes('grounding checker')) return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 1, outputTokens: 1 } };
        return { text: JSON.stringify(PLAN), usage: { inputTokens: 5, outputTokens: 5 } };
      },
      async *generateStream() {
        throw new Error('down');
      },
      async embed() {
        throw new Error('not used');
      },
    });
    const events = await run(QUESTION, 'req-relfallback');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
    const cit = events.find((e): e is Extract<ChatEvent, { type: 'citations' }> => e.type === 'citations');
    expect(cit?.citations.length).toBeGreaterThan(0);
    expect(lastTraces(1)[0].outcome).toBe('sources_fallback');
  });

  it('EP-ANS-03: the low-evidence Fix flow frames its hypotheses as untriaged guesses, not documented fact', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    resetConfigForTests();
    const events = await run('connect ECONNREFUSED 127.0.0.1:5432', 'req-fix');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('⚠️');
    expect(text).toMatch(/حدس|guess/i);
  });

  it('EP-COST-02: FAQ cache write now fires on medium confidence, not only high', async () => {
    const calls = { n: 0 };
    setProviderForTests(countingProvider(calls));
    await run(QUESTION, 'req-cost-write');
    const trace = lastTraces(1)[0];
    expect(trace.retrieval?.confidence).toBe('medium'); // this fixture yields medium, not high
    expect(trace.outcome).toBe('answered');
    // a second, fresh session asking the identical question must now be a
    // cache hit — proof the medium-confidence answer WAS written to the cache
    const calls2 = { n: 0 };
    setProviderForTests(countingProvider(calls2));
    await run(QUESTION, 'req-cost-write-2');
    expect(calls2.n).toBe(0); // zero model calls: served from cache
    expect(lastTraces(1)[0].outcome).toBe('cache');
  });

  it('EP-COST-02: FAQ cache read is eligible past turn 0 as long as the session stayed stateless', async () => {
    const calls1 = { n: 0 };
    setProviderForTests(countingProvider(calls1));
    const ev1 = await run(QUESTION, 'req-stateless-1');
    const sid = ev1.find((e): e is Extract<ChatEvent, { type: 'session' }> => e.type === 'session')!.sessionId;
    expect(calls1.n).toBeGreaterThan(0);

    // same (now turns=1) session, identical question again — statePatch was
    // empty both times, so the session never accumulated any context/profile.
    const calls2 = { n: 0 };
    setProviderForTests(countingProvider(calls2));
    await run(QUESTION, 'req-stateless-2', sid);
    expect(calls2.n).toBe(0); // zero model calls: the (turns>0) session still hit the cache
    expect(lastTraces(1)[0].outcome).toBe('cache');
  });

  it('EP-COST-02: FAQ cache read is correctly REFUSED once the session accumulated context', async () => {
    const statefulPlan = { ...PLAN, statePatch: { context: { platform: 'nextjs' } } };
    const calls1 = { n: 0 };
    setProviderForTests(countingProvider(calls1, LONG_ANSWER, statefulPlan));
    const ev1 = await run(QUESTION, 'req-stateful-1');
    const sid = ev1.find((e): e is Extract<ChatEvent, { type: 'session' }> => e.type === 'session')!.sessionId;

    // same question again, same session — but the session now carries
    // context.platform='nextjs' from turn 1, so a generic cached answer would
    // ignore it. The read guard must refuse the cache and call the model again.
    const calls2 = { n: 0 };
    setProviderForTests(countingProvider(calls2, LONG_ANSWER, statefulPlan));
    await run(QUESTION, 'req-stateful-2', sid);
    expect(calls2.n).toBeGreaterThan(0); // NOT served from cache
    expect(lastTraces(1)[0].outcome).not.toBe('cache');
  });
});

describe('EP-PRD-04: feedback resolves messageId back to the question it answered', () => {
  let dir: string;
  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-obs-'));
    process.env.RUNTIME_DIR = dir;
    process.env.RATE_LIMIT_RPM = '100';
    resetConfigForTests();
    resetSessionsForTests();
    resetIndexForTests();
    resetAgentCachesForTests();
    globalThis.__liaraIndex = fixtureIndex();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
  });
  afterEach(() => {
    delete process.env.RUNTIME_DIR;
    delete process.env.RATE_LIMIT_RPM;
    resetConfigForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a thumbs-down gap row carries the real question, not an opaque message:<id>', async () => {
    // Produce a real pipeline run so a trace with this requestId/messageId exists.
    const events = await run(QUESTION, 'req-fb-1', sessionId);
    const done = events.find((e): e is Extract<ChatEvent, { type: 'done' }> => e.type === 'done')!;

    const res = await feedbackPOST(
      new NextRequest('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, messageId: done.messageId, verdict: 'not_helpful' }),
      }),
    );
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 50)); // recordGap is fire-and-forget

    const gaps = fs.readFileSync(path.join(dir, 'gaps.jsonl'), 'utf8');
    expect(gaps).not.toContain(`message:${done.messageId}`);
    expect(gaps).toContain('DATABASE_URL'); // the resolved question text, not the opaque id
  });
});
