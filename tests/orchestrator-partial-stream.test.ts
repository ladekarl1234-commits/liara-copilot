// EP-REL-01 follow-up: the sources-only fallback was written for a provider that
// fails BEFORE the first token. When the stream dies PART-WAY — the common
// streaming failure, and the reason MODEL_STREAM_TIMEOUT_MS exists — it appended
// "the model couldn't generate an answer" to a half-written answer, producing
// text that is both garbage and false.
//
// The existing coverage in tests/orchestrator.test.ts throws before yielding, so
// it could never catch this. This file covers the mid-stream path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MiniSearch from 'minisearch';
import { handleChatMessage, resetAgentCachesForTests } from '@/lib/agent/orchestrator';
import { miniOptions, resetIndexForTests, type LoadedIndex } from '@/lib/retrieval/index';
import { setProviderForTests } from '@/lib/ai/provider';
import { resetConfigForTests } from '@/lib/config';
import { resetSessionsForTests } from '@/lib/state/sessions';
import { CANNED } from '@/lib/agent/prompts';
import type { ChatEvent, DocChunk, ModelProvider } from '@/types';

const PARTIAL = 'برای تنظیم متغیر محیطی وارد کنسول لیارا شوید ';

function fixtureIndex(): LoadedIndex {
  const chunks: DocChunk[] = [
    {
      id: 'envs#0', sourcePath: 'public/llms/paas/nextjs/set-envs.md',
      url: 'https://docs.liara.ir/paas/nextjs/how-tos/set-envs/', anchor: 'set-envs',
      product: 'paas', platform: 'nextjs', title: 'تنظیم متغیرهای محیطی', heading: 'تنظیم',
      headingPath: ['تنظیم متغیرهای محیطی'], contentType: 'text',
      text: 'برای تنظیم متغیرهای محیطی environment variables برنامه وارد کنسول لیارا شوید و متغیرها را اضافه کنید سپس برنامه را ری‌استارت کنید',
      hash: 'envs',
    },
  ];
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks as unknown as Record<string, unknown>[]);
  return {
    chunks, byId: new Map(chunks.map((c) => [c.id, c])), lexical, vectors: null,
    meta: { builtAt: 't', chunkCount: 1, anchorCoverage: 1, lexicalVersion: 4 },
  };
}

/** Streams a few tokens, then dies — exactly what a dropped connection looks like. */
function dyingStreamProvider(): ModelProvider {
  return {
    async generate(opts) {
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('grounding checker')) {
        return { text: JSON.stringify({ unsupported: [], note: '' }), usage: { inputTokens: 1, outputTokens: 1 } };
      }
      return {
        text: JSON.stringify({
          intent: 'question', language: 'fa', action: 'answer', statePatch: {},
          retrievalQueries: ['تنظیم متغیر محیطی'], filters: {},
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    async *generateStream() {
      yield PARTIAL;
      throw new Error('connection reset by peer');
    },
    async embed() { throw new Error('not used'); },
  };
}

describe('mid-stream provider failure (EP-REL-01 follow-up)', () => {
  beforeEach(() => {
    resetConfigForTests();
    resetSessionsForTests();
    resetIndexForTests();
    resetAgentCachesForTests();
    globalThis.__liaraIndex = fixtureIndex();
    process.env.AI_BASE_URL = 'https://example.invalid/v1';
    process.env.AI_API_KEY = 'k';
    process.env.AI_EMBEDDINGS_MODEL = '';
  });
  afterEach(() => {
    setProviderForTests(null);
    resetIndexForTests();
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_EMBEDDINGS_MODEL;
    resetConfigForTests();
  });

  it('keeps the partial answer and appends a truncation notice — never "could not generate"', async () => {
    setProviderForTests(dyingStreamProvider());
    const events: ChatEvent[] = [];
    await handleChatMessage({ message: 'چطور متغیر محیطی اضافه کنم؟', requestId: 'r-partial', emit: (e) => events.push(e) });

    const text = events.filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.text).join('');

    // the grounded text the user was already reading survives
    expect(text).toContain(PARTIAL.trim());
    // ...and is NOT contradicted by "the model couldn't generate an answer"
    expect(text).not.toContain(CANNED.answerUnavailable.fa);
    expect(text).toContain(CANNED.answerTruncated.fa);

    // still a well-formed turn: sources attached, exactly one terminal event
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('a failure BEFORE the first token still uses the plain unavailable message', async () => {
    setProviderForTests({
      ...dyingStreamProvider(),
            async *generateStream() { throw new Error('handshake failed'); },
    } as ModelProvider);
    const events: ChatEvent[] = [];
    await handleChatMessage({ message: 'چطور متغیر محیطی اضافه کنم؟', requestId: 'r-nostream', emit: (e) => events.push(e) });

    const text = events.filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.text).join('');
    expect(text).toContain(CANNED.answerUnavailable.fa);
    expect(text).not.toContain(CANNED.answerTruncated.fa);
  });
});
