// A platform filter and a non-paas product filter are mutually exclusive.
//
// Judge finding AQ-02. "How do I connect a Django app on Liara to a managed
// PostgreSQL database?" sets platform=django from the literal word "Django" and
// product=dbaas from the literal word "database". Every platform page lives
// under product=paas, so the pair selects the empty set — and the system
// refused a question whose answering page it ranks FIRST unfiltered. Measured
// against the shipped index:
//   {platform:django, product:dbaas}  -> confidence low,    gold ABSENT
//   {platform:django}                 -> confidence medium, gold rank 1
// The refusal looked like a retrieval failure and was a filter bug.

import { describe, it, expect } from 'vitest';
import { preClassify, fallbackPlan, makePlan } from '@/lib/agent/plan';
import type { ModelProvider, SessionState } from '@/types';

function state(): SessionState {
  return { id: 't', language: 'en', profile: {}, context: { triedActions: [] }, summary: '', turns: 1, updatedAt: Date.now() };
}

const CROSS_SERVICE = 'How do I connect a Django app on Liara to a managed Liara PostgreSQL database?';

describe('plan filters can never contradict themselves', () => {
  it('the deterministic plan keeps the platform and drops the guessed product', () => {
    const s = preClassify(CROSS_SERVICE);
    // the raw signals genuinely disagree — that is the input to the bug
    expect(s.platform).toBe('django');
    expect(s.product).toBe('dbaas');

    const plan = fallbackPlan(CROSS_SERVICE, s, state());
    expect(plan.filters.platform).toBe('django');
    expect(plan.filters.product).toBeUndefined();
  });

  it('a product-only question still gets its product filter', () => {
    const q = 'How do I create an object storage bucket on Liara?';
    const plan = fallbackPlan(q, preClassify(q), state());
    expect(plan.filters.platform).toBeUndefined();
    expect(plan.filters.product).toBe('object-storage');
  });

  it('the MODEL plan is held to the same rule', async () => {
    const provider: ModelProvider = {
      async generate() {
        return {
          text: JSON.stringify({
            intent: 'question',
            language: 'en',
            action: 'answer',
            statePatch: {},
            retrievalQueries: ['django postgres'],
            // the model emits exactly the contradiction
            filters: { platform: 'django', product: 'dbaas' },
          }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      async *generateStream() {
        throw new Error('not used');
      },
      async embed() {
        throw new Error('not used');
      },
    };
    const { plan, route } = await makePlan(CROSS_SERVICE, state(), provider);
    expect(route).toBe('model');
    expect(plan.filters.platform).toBe('django');
    expect(plan.filters.product).toBeUndefined();
  });

  it('paas is not a contradiction — it is where platforms live', async () => {
    const provider: ModelProvider = {
      async generate() {
        return {
          text: JSON.stringify({
            intent: 'question',
            language: 'en',
            action: 'answer',
            statePatch: {},
            retrievalQueries: ['nextjs deploy'],
            filters: { platform: 'nextjs', product: 'paas' },
          }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      async *generateStream() {
        throw new Error('not used');
      },
      async embed() {
        throw new Error('not used');
      },
    };
    const { plan } = await makePlan('How do I deploy Next.js?', state(), provider);
    expect(plan.filters.platform).toBe('nextjs');
    expect(plan.filters.product).toBe('paas');
  });
});
