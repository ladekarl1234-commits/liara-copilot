import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consume, resetForTests } from '@/lib/security/ratelimit';
import { parseChatRequest, parseFeedback, ValidationError } from '@/lib/security/validate';
import { config } from '@/lib/config';

describe('ratelimit', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // fakes Date.now too
    resetForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows RPM requests, then blocks, then refills continuously', () => {
    const rpm = config().RATE_LIMIT_RPM;
    for (let i = 0; i < rpm; i++) {
      expect(consume('ip|sess').allowed).toBe(true);
    }
    const blocked = consume('ip|sess');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // after one token's worth of time, exactly one request goes through
    vi.advanceTimersByTime(Math.ceil(60_000 / rpm) + 5);
    expect(consume('ip|sess').allowed).toBe(true);
    expect(consume('ip|sess').allowed).toBe(false);

    // full refill after a minute
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < rpm; i++) {
      expect(consume('ip|sess').allowed).toBe(true);
    }
  });

  it('keys are independent', () => {
    const rpm = config().RATE_LIMIT_RPM;
    for (let i = 0; i < rpm; i++) consume('a|1');
    expect(consume('a|1').allowed).toBe(false);
    expect(consume('b|2').allowed).toBe(true);
  });
});

describe('parseChatRequest', () => {
  it('accepts good input and trims the message', () => {
    const r = parseChatRequest({ sessionId: 'abcd-1234', message: '  چطور دیپلوی کنم؟  ' });
    expect(r).toEqual({ sessionId: 'abcd-1234', message: 'چطور دیپلوی کنم؟' });
  });

  it('accepts a missing sessionId', () => {
    expect(parseChatRequest({ message: 'hi there' }).sessionId).toBeUndefined();
  });

  it('rejects an empty (whitespace-only) message', () => {
    expect(() => parseChatRequest({ message: '   ' })).toThrow(ValidationError);
  });

  it('rejects a message over MAX_INPUT_CHARS', () => {
    const tooLong = 'a'.repeat(config().MAX_INPUT_CHARS + 1);
    expect(() => parseChatRequest({ message: tooLong })).toThrow(ValidationError);
  });

  it('rejects a bad sessionId', () => {
    expect(() => parseChatRequest({ sessionId: 'BAD_ID!', message: 'hi' })).toThrow(ValidationError);
    expect(() => parseChatRequest({ sessionId: 'short', message: 'hi' })).toThrow(ValidationError);
  });

  it('rejects a non-object body', () => {
    expect(() => parseChatRequest('hi')).toThrow(ValidationError);
  });
});

describe('parseFeedback', () => {
  const good = { sessionId: 'sess-12345', messageId: 'msg-1', verdict: 'helpful' };

  it('accepts good input', () => {
    expect(parseFeedback(good)).toEqual({ ...good });
    expect(parseFeedback({ ...good, verdict: 'not_solved', comment: 'still broken' }).comment).toBe(
      'still broken',
    );
  });

  it('rejects a bad verdict', () => {
    expect(() => parseFeedback({ ...good, verdict: 'meh' })).toThrow(ValidationError);
  });

  it('rejects a missing sessionId', () => {
    expect(() => parseFeedback({ messageId: 'm', verdict: 'helpful' })).toThrow(ValidationError);
  });

  it('rejects an over-long comment', () => {
    expect(() => parseFeedback({ ...good, comment: 'x'.repeat(2001) })).toThrow(ValidationError);
  });
});
