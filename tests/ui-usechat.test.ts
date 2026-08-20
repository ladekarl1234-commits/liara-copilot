import { describe, expect, it } from 'vitest';
import { applyEvent, faError, parseSSE, STAGE_FA, type UIMessage } from '@/components/useChat';
import type { ErrorCode } from '@/types';

const base: UIMessage = { id: 'local-1', role: 'assistant', text: '' };

describe('parseSSE', () => {
  it('parses complete events and keeps the partial tail unconsumed', () => {
    const { events, rest } = parseSSE(
      'data: {"type":"delta","text":"سلام"}\n\ndata: {"type":"del',
    );
    expect(events).toEqual([{ type: 'delta', text: 'سلام' }]);
    expect(rest).toBe('data: {"type":"del');
  });

  it('handles CRLF frames and skips malformed data lines', () => {
    const { events, rest } = parseSSE(
      'data: {"type":"stage","stage":"searching"}\r\n\r\ndata: not-json\r\n\r\n',
    );
    expect(events).toEqual([{ type: 'stage', stage: 'searching' }]);
    expect(rest).toBe('');
  });

  it('parses multiple events in one chunk and ignores non-data lines', () => {
    const { events } = parseSSE(
      ': keepalive\n\ndata: {"type":"session","sessionId":"s1"}\n\ndata: {"type":"done","messageId":"m1"}\n\n',
    );
    expect(events).toEqual([
      { type: 'session', sessionId: 's1' },
      { type: 'done', messageId: 'm1' },
    ]);
  });
});

describe('applyEvent', () => {
  it('accumulates deltas, attaches citations, adopts server id on done', () => {
    let m = applyEvent(base, { type: 'delta', text: 'یک' });
    m = applyEvent(m, { type: 'delta', text: ' دو' });
    m = applyEvent(m, {
      type: 'citations',
      citations: [{ title: 'استقرار Next.js', url: 'https://docs.liara.ir/x#y', product: 'paas' }],
    });
    m = applyEvent(m, { type: 'verification', note: 'یک ادعا اصلاح شد.' });
    m = applyEvent(m, { type: 'done', messageId: 'srv-1' });
    expect(m.text).toBe('یک دو');
    expect(m.citations).toHaveLength(1);
    expect(m.verificationNote).toBe('یک ادعا اصلاح شد.');
    expect(m.id).toBe('srv-1');
    expect(m.done).toBe(true);
  });

  it('verification without a note changes nothing', () => {
    expect(applyEvent(base, { type: 'verification' })).toBe(base);
  });

  it('stores workflow and troubleshooting payloads', () => {
    const wf = {
      goal: 'استقرار',
      detected: ['Next.js'],
      steps: [{ id: '1', label: 'ساخت برنامه', status: 'current' as const }],
    };
    const ts = {
      problem: 'خطای اتصال',
      hypotheses: [{ id: 'h1', text: 'پورت اشتباه', status: 'testing' as const }],
      resolved: false,
    };
    expect(applyEvent(base, { type: 'workflow', workflow: wf }).workflow).toEqual(wf);
    expect(applyEvent(base, { type: 'troubleshooting', state: ts }).troubleshooting).toEqual(ts);
  });

  it('marks error terminal with a Persian message for the code', () => {
    const m = applyEvent(base, { type: 'error', code: 'rate_limited', message: 'server text' });
    expect(m.done).toBe(true);
    expect(m.error).toEqual({ code: 'rate_limited', message: faError('rate_limited') });
  });
});

it('faError has a distinct Persian message per code', () => {
  const codes: (ErrorCode | 'network')[] = [
    'rate_limited',
    'model_timeout',
    'model_unavailable',
    'index_missing',
    'invalid_input',
    'internal',
    'network',
  ];
  const messages = codes.map(faError);
  expect(new Set(messages).size).toBe(codes.length);
  for (const msg of messages) expect(msg).toMatch(/[؀-ۿ]/);
});

it('STAGE_FA covers all protocol stages', () => {
  for (const s of ['understanding', 'searching', 'checking', 'answering']) {
    expect(STAGE_FA[s]).toMatch(/[؀-ۿ]/);
  }
});
