'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, Citation, ErrorCode, SessionState } from '@/types';

export type UIErrorCode = ErrorCode | 'network';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  workflow?: NonNullable<SessionState['workflow']>;
  troubleshooting?: NonNullable<SessionState['troubleshooting']>;
  verificationNote?: string;
  error?: { code: UIErrorCode; message: string };
  done?: boolean;
}

export type ChatStatus = 'idle' | 'streaming';

const SESSION_KEY = 'liara-copilot-session';

export const STAGE_FA: Record<string, string> = {
  understanding: 'در حال درک سوال…',
  searching: 'جستجو در مستندات لیارا…',
  checking: 'بررسی منابع…',
  answering: 'آماده‌سازی پاسخ…',
};

export function faError(code: UIErrorCode): string {
  switch (code) {
    case 'rate_limited':
      return 'تعداد درخواست‌ها زیاد شد؛ چند لحظه دیگر دوباره امتحان کنید.';
    case 'model_timeout':
      return 'پاسخ‌دهی مدل بیش از حد طول کشید؛ لطفاً دوباره امتحان کنید.';
    case 'model_unavailable':
      return 'سرویس مدل در دسترس نیست؛ کمی بعد دوباره امتحان کنید.';
    case 'index_missing':
      return 'ایندکس مستندات آماده نیست؛ ابتدا دستور npm run index را اجرا کنید.';
    case 'invalid_input':
      return 'پیام نامعتبر است؛ متن را کوتاه‌تر یا ساده‌تر بنویسید و دوباره بفرستید.';
    case 'network':
      return 'ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره امتحان کنید.';
    default:
      return 'خطای داخلی رخ داد؛ لطفاً دوباره امتحان کنید.';
  }
}

/** Split an SSE buffer into parsed events + unconsumed tail. Malformed lines are skipped. */
export function parseSSE(buffer: string): { events: ChatEvent[]; rest: string } {
  const parts = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const events: ChatEvent[] = [];
  for (const block of parts) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        events.push(JSON.parse(line.slice(5).trim()) as ChatEvent);
      } catch {
        // malformed event — ignore, the stream stays usable
      }
    }
  }
  return { events, rest };
}

/** Fold one ChatEvent into an assistant message. Session/stage/context events are handled by the hook. */
export function applyEvent(m: UIMessage, ev: ChatEvent): UIMessage {
  switch (ev.type) {
    case 'delta':
      return { ...m, text: m.text + ev.text };
    case 'citations':
      return { ...m, citations: ev.citations };
    case 'workflow':
      return { ...m, workflow: ev.workflow };
    case 'troubleshooting':
      return { ...m, troubleshooting: ev.state };
    case 'verification':
      return ev.note ? { ...m, verificationNote: ev.note } : m;
    case 'done':
      return { ...m, id: ev.messageId, done: true };
    case 'error':
      return { ...m, done: true, error: { code: ev.code, message: faError(ev.code) } };
    default:
      return m;
  }
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++uid}`;

export function useChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [contextChips, setContextChips] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const lastUserRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        sessionRef.current = saved;
        setSessionId(saved);
      }
    } catch {
      // storage blocked — session just won't persist across reloads
    }
    return () => abortRef.current?.abort();
  }, []);

  const patch = (id: string, fn: (m: UIMessage) => UIMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const run = useCallback(async (text: string, appendUser: boolean) => {
    if (streamingRef.current) return;
    streamingRef.current = true;
    lastUserRef.current = text;
    // clear stale context chips: the server re-emits a `context` event only when
    // the new turn has context, so without a reset old chips would persist (UX-301)
    setContextChips([]);

    const asstId = nextId('a');
    setMessages((ms) => [
      ...ms,
      ...(appendUser ? [{ id: nextId('u'), role: 'user' as const, text }] : []),
      { id: asstId, role: 'assistant' as const, text: '' },
    ]);
    setStatus('streaming');
    setStage(STAGE_FA['understanding'] ?? null);

    const ac = new AbortController();
    abortRef.current = ac;
    let currentId = asstId;
    const fail = (code: UIErrorCode) =>
      patch(currentId, (m) => ({ ...m, done: true, error: { code, message: faError(code) } }));

    const handle = (ev: ChatEvent) => {
      switch (ev.type) {
        case 'session':
          sessionRef.current = ev.sessionId;
          setSessionId(ev.sessionId);
          try {
            sessionStorage.setItem(SESSION_KEY, ev.sessionId);
          } catch {
            // non-fatal
          }
          break;
        case 'stage':
          setStage(STAGE_FA[ev.stage] ?? null);
          break;
        case 'context':
          setContextChips(ev.chips);
          break;
        default: {
          if (ev.type === 'delta') setStage(null);
          const before = currentId;
          if (ev.type === 'done') currentId = ev.messageId; // server id becomes the message id
          patch(before, (m) => applyEvent(m, ev));
        }
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current ?? undefined, message: text }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        let code: UIErrorCode =
          res.status === 429 ? 'rate_limited' : res.status === 400 ? 'invalid_input' : 'internal';
        try {
          const body = (await res.json()) as { error?: { code?: string } };
          if (body.error?.code) code = body.error.code as UIErrorCode;
        } catch {
          // keep status-derived code
        }
        fail(code);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let terminal = false;
      const consume = (events: ChatEvent[]) => {
        for (const ev of events) {
          if (ev.type === 'done' || ev.type === 'error') terminal = true;
          handle(ev);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSE(buf);
        buf = rest;
        consume(events);
      }
      consume(parseSSE(buf + decoder.decode() + '\n\n').events);
      if (!terminal) fail('network'); // stream ended without done/error
    } catch {
      if (!ac.signal.aborted) fail('network');
    } finally {
      streamingRef.current = false;
      abortRef.current = null;
      setStatus('idle');
      setStage(null);
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (t) void run(t, true);
    },
    [run],
  );

  /** Re-send the last user message, replacing a trailing errored assistant message. */
  const retry = useCallback(() => {
    if (!lastUserRef.current || streamingRef.current) return;
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      return last && last.role === 'assistant' && last.error ? ms.slice(0, -1) : ms;
    });
    void run(lastUserRef.current, false);
  }, [run]);

  return { messages, send, retry, status, stage, contextChips, sessionId };
}
