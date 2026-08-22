// The language the user is answered in must come from their SCRIPT, not from
// the model's opinion about it.
//
// Reproduced live: 1 of 3 runs of «چطور یک دیتابیس PostgreSQL روی لیارا بسازم؟»
// returned the ENGLISH canned refusal for a question written entirely in
// Persian, because the planner reported language:'en'. Every user-facing string
// — greeting, clarification, refusal, degraded notice — is selected by this one
// field, so a wrong value is visible in the worst possible place: the message
// shown when nothing else worked.

import { describe, it, expect } from 'vitest';
import { makePlan } from '@/lib/agent/plan';
import type { ModelProvider, SessionState } from '@/types';

function state(): SessionState {
  return { id: 't', language: 'fa', profile: {}, context: { triedActions: [] }, summary: '', turns: 1, updatedAt: Date.now() };
}

/** A planner that confidently reports the WRONG language. */
function providerSaying(language: string): ModelProvider {
  return {
    async generate() {
      return {
        text: JSON.stringify({
          intent: 'question',
          language,
          action: 'answer',
          statePatch: {},
          retrievalQueries: ['postgres'],
          filters: {},
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
}

describe('plan language is detected, not delegated', () => {
  it('keeps Persian when the model claims English', async () => {
    // turns:1 so the deterministic skip-path does not short-circuit the model call
    const { plan, route } = await makePlan(
      'چطور یک دیتابیس PostgreSQL روی لیارا بسازم؟',
      state(),
      providerSaying('en'),
    );
    expect(route).toBe('model'); // the model plan WAS used...
    expect(plan.language).toBe('fa'); // ...but not for this field
  });

  it('keeps English when the model claims Persian', async () => {
    const { plan } = await makePlan('How do I create a PostgreSQL database on Liara?', state(), providerSaying('fa'));
    expect(plan.language).toBe('en');
  });

  it('a Persian question with Latin product names is still Persian', async () => {
    // the exact shape that regressed: mostly Persian, with PostgreSQL/Liara in Latin
    const { plan } = await makePlan(
      'چطور یک دیتابیس PostgreSQL روی لیارا بسازم؟',
      state(),
      providerSaying('en'),
    );
    expect(plan.language).toBe('fa');
  });
});
