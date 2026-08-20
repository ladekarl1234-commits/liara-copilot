// End-to-end proof of AC-SEC-002: a pasted secret must never reach the model.
// Captures EVERY string handed to the provider (plan call, answer prompt, verify
// call) and asserts the raw secret value is absent while structure/keywords and
// the [REDACTED] placeholder survive.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { setProviderForTests } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import type { ChatEvent, DocChunk, ModelProvider } from '@/types';

function fixtureIndex(): LoadedIndex {
  const chunks: DocChunk[] = [
    {
      id: 'envs#0', sourcePath: 'public/llms/paas/nextjs/set-envs.md',
      url: 'https://docs.liara.ir/paas/nextjs/how-tos/set-envs/', anchor: 'set-envs',
      product: 'paas', platform: 'nextjs', title: 'تنظیم متغیرهای محیطی', heading: 'تنظیم',
      headingPath: ['تنظیم متغیرهای محیطی'], contentType: 'text',
      text: 'برای تنظیم متغیرهای محیطی (environment variables) و DATABASE_URL برنامه، وارد کنسول لیارا شوید و از بخش تنظیمات متغیرها را اضافه کنید.',
      hash: 'envs',
    },
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return { chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical, vectors: null, meta: { builtAt: 't', chunkCount: 1, anchorCoverage: 1, lexicalVersion: 2 } };
}

const PLAN = { intent: 'question', language: 'fa', action: 'answer', statePatch: {}, retrievalQueries: ['تنظیم متغیر محیطی DATABASE_URL'], filters: {} };

function capturingProvider(sink: string[]): ModelProvider {
  return {
    async generate(opts) {
      for (const m of opts.messages) sink.push(m.content);
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 1, outputTokens: 1 } };
      return { text: JSON.stringify(PLAN), usage: { inputTokens: 1, outputTokens: 1 } };
    },
    async *generateStream(opts) {
      for (const m of opts.messages) sink.push(m.content);
      yield 'برای تنظیم متغیر محیطی [1] وارد کنسول لیارا شوید.';
    },
    async embed() { throw new Error('not used'); },
  };
}

describe('redaction end-to-end (AC-SEC-002)', () => {
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

  it('never sends a pasted API key or connection-string password to the model', async () => {
    const sink: string[] = [];
    setProviderForTests(capturingProvider(sink));
    const secretKey = 'sk-live-abcdef1234567890';
    const dbPass = 'SuperSecretPw99';
    const msg = `چطور متغیر محیطی DATABASE_URL را تنظیم کنم؟ الان API_KEY=${secretKey} و DATABASE_URL=postgres://admin:${dbPass}@db:5432/app دارم`;

    const events: ChatEvent[] = [];
    await handleChatMessage({ message: msg, requestId: 'r', emit: (e) => events.push(e) });

    expect(sink.length).toBeGreaterThan(0); // the model WAS called (plan at minimum)
    const all = sink.join('\n');
    // the raw secrets must be absent from every string sent to the provider
    expect(all).not.toContain(secretKey);
    expect(all).not.toContain(dbPass);
    // structure/keywords survive (so retrieval + diagnosis still work) and the
    // placeholder is present
    expect(all).toContain('DATABASE_URL');
    expect(all).toContain('[REDACTED]');
    // and the request still produced a normal answer stream (no error)
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('does NOT leak a turn-1 secret to the model on turn 2 via the session summary', async () => {
    const sink: string[] = [];
    setProviderForTests(capturingProvider(sink));
    const secretKey = 'sk-live-zzz99887766554433';

    // turn 1 — paste a secret; capture the server session id
    const ev1: ChatEvent[] = [];
    await handleChatMessage({
      message: `چطور متغیر محیطی DATABASE_URL بسازم؟ API_KEY=${secretKey}`,
      requestId: 'r1',
      emit: (e) => ev1.push(e),
    });
    const sid = ev1.find((e): e is Extract<ChatEvent, { type: 'session' }> => e.type === 'session')!.sessionId;

    // turn 2 — same session, innocuous follow-up. The plan/answer prompt embeds
    // the rolling summary (which contains turn 1's message). It must be redacted.
    sink.length = 0;
    await handleChatMessage({ message: 'قدم بعدی چیست؟', sessionId: sid, requestId: 'r2', emit: () => {} });

    const turn2 = sink.join('\n');
    expect(sink.length).toBeGreaterThan(0); // the model WAS called on turn 2
    expect(turn2).toContain('DATABASE_URL'); // proves the summary IS being sent
    expect(turn2).not.toContain(secretKey); // ...but the secret is redacted out
  });
});
