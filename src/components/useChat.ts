'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEvent, Citation, ErrorCode, SessionState } from '@/types';

export type UIErrorCode = ErrorCode | 'network';

export interface UIMessage {
  /** Client-generated and STABLE for the lifetime of the message. It is the React
   *  key, so it must never change mid-stream: swapping it at `done` unmounts and
   *  remounts the whole turn, which makes a screen reader re-read the answer. */
  id: string;
  /** Server-assigned message id, adopted at `done`. Only for /api/feedback. */
  serverId?: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  workflow?: NonNullable<SessionState['workflow']>;
  troubleshooting?: NonNullable<SessionState['troubleshooting']>;
  verificationNote?: string;
  error?: { code: UIErrorCode; message: string };
  done?: boolean;
  /** The user pressed stop; the text is a partial answer, not a failure. */
  stopped?: boolean;
}

export type ChatStatus = 'idle' | 'streaming';

export const STAGE_FA: Record<string, string> = {
  understanding: 'در حال درک سوال…',
  searching: 'جستجو در مستندات لیارا…',
  checking: 'بررسی منابع…',
  answering: 'آماده‌سازی پاسخ…',
};

/** End-user copy, one entry per error code. Deliberately says nothing about env
 *  vars, npm scripts or which vendor is down: a Liara customer cannot act on any
 *  of that, and being told to run a command in a repo they do not have reads as
 *  an unfinished internal tool (PRD-05). The operator-facing detail stays in the
 *  structured log and on /internal. */
const FA_ERROR: Record<UIErrorCode, string> = {
  rate_limited: 'تعداد درخواست‌ها زیاد شد؛ چند لحظه دیگر دوباره امتحان کنید.',
  model_timeout: 'پاسخ‌دهی مدل بیش از حد طول کشید؛ لطفاً دوباره امتحان کنید.',
  model_unavailable: 'سرویس مدل در دسترس نیست؛ کمی بعد دوباره امتحان کنید.',
  index_missing: 'دستیار موقتاً در دسترس نیست؛ لطفاً کمی دیگر دوباره تلاش کنید.',
  invalid_input: 'پیام نامعتبر است؛ متن را کوتاه‌تر یا ساده‌تر بنویسید و دوباره بفرستید.',
  // only reachable from /api/voice/transcribe, but the table is exhaustive over
  // ErrorCode so a new server code cannot silently fall through to "خطای داخلی"
  voice_unavailable: 'تبدیل گفتار به متن در دسترس نیست؛ لطفاً پیام را تایپ کنید.',
  network: 'ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی و دوباره امتحان کنید.',
  internal: 'خطای داخلی رخ داد؛ لطفاً دوباره امتحان کنید.',
};

export function faError(code: UIErrorCode): string {
  // `code` crosses the wire, so an unrecognised value is reachable despite the type.
  return FA_ERROR[code] ?? FA_ERROR.internal;
}

/** Pick the message shown for a server `error` event.
 *
 *  MAINT-02 (client half): the client used to discard `ev.message` unconditionally,
 *  so a new server-side code could only ever render as "خطای داخلی". It is now the
 *  fallback for codes this table does not know, which removes the lockstep edit.
 *  Known codes keep the client's copy on purpose — the server's strings for those
 *  are operator diagnostics (`npm run index`, OPENROUTER_API_KEY), which is exactly
 *  what PRD-05 says must not reach a customer. Once the server-side i18n table is
 *  split into user copy + operator detail, this can invert to prefer `ev.message`. */
export function userError(code: UIErrorCode, serverMessage?: string): string {
  return FA_ERROR[code] ?? (serverMessage?.trim() || FA_ERROR.internal);
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
      return { ...m, serverId: ev.messageId, done: true };
    case 'error':
      return { ...m, done: true, error: { code: ev.code, message: userError(ev.code, ev.message) } };
    default:
      return m;
  }
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++uid}`;

/* ── transcript persistence (PRD-09) ─────────────────────────────────────────
 * UX-04 was closed by dropping the session-id restore, because restoring the id
 * alone re-attached 24h of invisible server context (summary, workflow,
 * hypotheses) to what looked like a blank chat. The other half of that trade was
 * that any reload silently destroyed the conversation. Both halves are now
 * persisted together, so visible and hidden state can never diverge.
 *
 * sessionStorage, not localStorage: the session id is a credential (sessions.ts)
 * and the transcript can contain pasted logs, so per-tab lifetime is the right
 * default — it still survives reload, back/forward and tab restore, which is the
 * case the finding describes.
 * ponytail: last 40 turns, JSON, no compression. Move to IndexedDB only if real
 * transcripts start hitting the ~5MB quota. */
const STORE_KEY = 'liara.chat.v1';
const STORE_MAX_MESSAGES = 40;
/** Mirrors TTL_MS in src/lib/state/sessions.ts: past it the server has already
 *  dropped its half, so restoring ours would resurrect a dead session id. */
const STORE_TTL_MS = 24 * 60 * 60 * 1000;

interface Persisted {
  at: number;
  sessionId: string | null;
  /** Signed conversation state from the server; echoed back so a follow-up
   *  resumes even when it lands on a different serverless instance. Opaque and
   *  unreadable to us — the server rejects anything it did not sign. */
  state: string | null;
  messages: UIMessage[];
}

/** Parse a stored snapshot. Anything malformed, empty or expired restores nothing
 *  — a corrupt entry must never be able to break the chat on load. */
export function readPersisted(raw: string | null, now = Date.now()): Persisted | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Persisted>;
    if (typeof p.at !== 'number' || now - p.at > STORE_TTL_MS) return null;
    if (!Array.isArray(p.messages) || p.messages.length === 0) return null;
    return {
      at: p.at,
      sessionId: typeof p.sessionId === 'string' ? p.sessionId : null,
      state: typeof p.state === 'string' ? p.state : null,
      messages: p.messages,
    };
  } catch {
    return null;
  }
}

/** Serialize a snapshot, or null when there is nothing to keep. */
export function writePersisted(
  messages: UIMessage[],
  sessionId: string | null,
  state: string | null = null,
  now = Date.now(),
): string | null {
  if (messages.length === 0) return null;
  const snapshot: Persisted = { at: now, sessionId, state, messages: messages.slice(-STORE_MAX_MESSAGES) };
  return JSON.stringify(snapshot);
}

export function useChat() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [contextChips, setContextChips] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Not state: it changes once per turn and nothing renders from it, so a ref
  // keeps it out of the render path while staying readable by the next send().
  const stateRef = useRef<string | null>(null);

  const sessionRef = useRef<string | null>(null);
  const lastUserRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Restore transcript + session id together, never one without the other (PRD-09,
  // UX-04). After mount, not in a useState initializer: reading sessionStorage
  // during render would desync from the server-rendered empty shell.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(STORE_KEY);
    } catch {
      return; // storage blocked (private mode / cookies off) — start fresh
    }
    const p = readPersisted(raw);
    if (!p) return;
    sessionRef.current = p.sessionId;
    stateRef.current = p.state;
    setSessionId(p.sessionId);
    setMessages(p.messages);
    // so "تلاش دوباره" works on the first turn after a reload
    for (let i = p.messages.length - 1; i >= 0; i--) {
      const m = p.messages[i];
      if (m?.role === 'user') {
        lastUserRef.current = m.text;
        break;
      }
    }
  }, []);

  // Persist only while idle: mid-stream the trailing turn is incomplete, and one
  // write per token would be pure waste. `skipFirstSave` keeps this pass from
  // clearing storage on mount, before the restore above has been committed.
  const skipFirstSave = useRef(true);
  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    if (status !== 'idle') return;
    const raw = writePersisted(messages, sessionId, stateRef.current);
    try {
      if (raw === null) window.sessionStorage.removeItem(STORE_KEY);
      else window.sessionStorage.setItem(STORE_KEY, raw);
    } catch {
      // quota exceeded or storage blocked — persistence is best-effort and must
      // never take the conversation down with it
    }
  }, [messages, status, sessionId]);

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
    const fail = (code: UIErrorCode) =>
      patch(asstId, (m) => ({ ...m, done: true, error: { code, message: faError(code) } }));

    const handle = (ev: ChatEvent) => {
      switch (ev.type) {
        case 'session':
          sessionRef.current = ev.sessionId;
          if (ev.state) stateRef.current = ev.state;
          setSessionId(ev.sessionId);
          break;
        case 'stage':
          setStage(STAGE_FA[ev.stage] ?? null);
          break;
        case 'context':
          setContextChips(ev.chips);
          break;
        default: {
          if (ev.type === 'delta') setStage(null);
          patch(asstId, (m) => applyEvent(m, ev));
        }
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionRef.current ?? undefined,
          state: stateRef.current ?? undefined,
          message: text,
        }),
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
      // stream ended without done/error — unless the user stopped it, which is
      // not a network failure and must not surface a retry block.
      if (!terminal && !ac.signal.aborted) fail('network');
    } catch {
      if (!ac.signal.aborted) fail('network');
    } finally {
      // A user-initiated stop is not a failure: close the partial answer so its
      // actions (listen, feedback) render instead of leaving it mid-stream.
      if (ac.signal.aborted) patch(asstId, (m) => ({ ...m, done: true, stopped: true }));
      streamingRef.current = false;
      abortRef.current = null;
      setStatus('idle');
      setStage(null);
    }
  }, []);

  /** Stop the in-flight answer, keeping whatever has already streamed in. */
  const abort = useCallback(() => abortRef.current?.abort(), []);

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

  /** Start a fresh conversation: drop history and the server session id. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    streamingRef.current = false;
    sessionRef.current = null;
    // must be cleared with the id, or "new conversation" would hand the server
    // the previous conversation's summary and profile under a fresh id
    stateRef.current = null;
    lastUserRef.current = '';
    setSessionId(null);
    setMessages([]);
    setContextChips([]);
    setStatus('idle');
    setStage(null);
  }, []);

  return { messages, send, retry, reset, abort, status, stage, contextChips, sessionId };
}
