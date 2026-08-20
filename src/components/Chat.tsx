'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useChat, type UIMessage } from './useChat';
import Markdown from './Markdown';
import Sources from './Sources';
import WorkflowChecklist from './WorkflowChecklist';
import HypothesisList from './HypothesisList';
import Feedback from './Feedback';

const CHIPS: { label: string; message: string }[] = [
  {
    label: 'استقرار پروژه‌ی من',
    message: 'می‌خواهم پروژه‌ام را روی لیارا مستقر کنم؛ از کجا شروع کنم؟',
  },
  {
    label: 'رفع یک خطا',
    message: 'برنامه‌ام روی لیارا به خطا خورده و می‌خواهم علتش را پیدا و رفع کنم.',
  },
  {
    label: 'اتصال دیتابیس',
    message: 'چطور برنامه‌ام را به دیتابیس روی لیارا متصل کنم؟',
  },
  {
    label: 'تنظیم دامنه',
    message: 'چطور دامنه‌ی اختصاصی خودم را به برنامه‌ام روی لیارا وصل کنم؟',
  },
];

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function Composer({
  onSend,
  disabled,
  large,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  large?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`; // CSS max-height caps at ~6 rows
  };

  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue('');
    const el = ref.current;
    if (el) el.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={`composer ${large ? 'composer-lg' : ''}`}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        autoFocus
        disabled={disabled}
        placeholder="سوال خود را درباره‌ی لیارا بنویسید…"
        aria-label="پیام شما"
        dir="auto"
        onChange={(e) => {
          setValue(e.target.value);
          grow();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="send-btn"
        aria-label="ارسال پیام"
        disabled={disabled || value.trim() === ''}
        onClick={submit}
      >
        <SendIcon />
      </button>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-block" role="alert">
      <span>{message}</span>
      <button type="button" className="retry-btn" onClick={onRetry}>
        تلاش دوباره
      </button>
    </div>
  );
}

function AssistantMessage({
  m,
  stage,
  showStage,
  onRetry,
  sessionId,
  onStillBroken,
}: {
  m: UIMessage;
  stage: string | null;
  showStage: boolean;
  onRetry: () => void;
  sessionId: string | null;
  onStillBroken: () => void;
}) {
  return (
    <div className="min-w-0">
      {m.workflow && <WorkflowChecklist workflow={m.workflow} />}
      {m.troubleshooting && <HypothesisList state={m.troubleshooting} />}
      {showStage && <p className="stage">{stage ?? 'در حال آماده‌سازی…'}</p>}
      {m.text !== '' && (
        <div dir="auto">
          <Markdown>{m.text}</Markdown>
        </div>
      )}
      {m.verificationNote && (
        <p className="note">
          <span className="note-label">اصلاحیه</span>
          {m.verificationNote}
        </p>
      )}
      {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
      {m.error && <ErrorBlock message={m.error.message} onRetry={onRetry} />}
      {m.done && !m.error && m.text !== '' && (
        <Feedback sessionId={sessionId} messageId={m.id} onStillBroken={onStillBroken} />
      )}
    </div>
  );
}

export default function Chat() {
  const { messages, send, retry, status, stage, contextChips, sessionId } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const streaming = status === 'streaming';

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onStillBroken = useCallback(() => send('هنوز حل نشده'), [send]);

  if (messages.length === 0) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="w-full max-w-2xl -mt-20">
          <h1 className="mb-8 text-center text-2xl font-bold sm:text-[1.7rem]">
            چطور می‌تونم در لیارا کمک‌تون کنم؟
          </h1>
          <Composer large onSend={send} disabled={streaming} />
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                className="chip"
                onClick={() => send(c.message)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-10 text-center text-xs text-mut">
            پاسخ‌ها بر پایه‌ی مستندات رسمی لیارا (docs.liara.ir) هستند.
          </p>
        </div>
      </main>
    );
  }

  const last = messages[messages.length - 1];

  return (
    <main className="flex h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-2xl items-baseline gap-2 px-4 py-3">
          <span className="text-sm font-bold">Liara Copilot</span>
          <span className="text-xs text-mut">دستیار هوشمند لیارا</span>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain">
        <div
          role="log"
          aria-live="polite"
          className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6"
        >
          {messages.map((m): ReactNode => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="msg-user" dir="auto">
                  {m.text}
                </div>
              );
            }
            const isLast = m.id === last?.id;
            const showStage =
              streaming &&
              isLast &&
              m.text === '' &&
              !m.error &&
              !m.workflow &&
              !m.troubleshooting;
            return (
              <AssistantMessage
                key={m.id}
                m={m}
                stage={stage}
                showStage={showStage}
                onRetry={retry}
                sessionId={sessionId}
                onStillBroken={onStillBroken}
              />
            );
          })}
        </div>
      </div>

      <div className="composer-area">
        <div className="mx-auto w-full max-w-2xl px-4">
          {contextChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {contextChips.map((chip) => (
                <span key={chip} className="ctx-chip">
                  {chip}
                </span>
              ))}
            </div>
          )}
          <Composer onSend={send} disabled={streaming} />
        </div>
      </div>
    </main>
  );
}
