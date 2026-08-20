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
import { useVoice, type VoiceState } from './useVoice';
import { useTts } from './useTts';
import Markdown from './Markdown';
import Sources from './Sources';
import WorkflowChecklist from './WorkflowChecklist';
import HypothesisList from './HypothesisList';
import Feedback from './Feedback';

const hasPersian = (t: string) => /[؀-ۿ]/.test(t);

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

function Icon({ children }: { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

const SendIcon = () => (
  <Icon>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </Icon>
);

const MicIcon = () => (
  <Icon>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Icon>
);

const StopIcon = () => (
  <Icon>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);

const SpeakerIcon = () => (
  <Icon>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
  </Icon>
);

const VOICE_LABEL: Record<VoiceState, string> = {
  idle: 'گفتن با صدا',
  unsupported: 'ضبط صدا در این مرورگر پشتیبانی نمی‌شود',
  requesting: 'در حال گرفتن اجازه‌ی میکروفون…',
  listening: 'در حال شنیدن — برای پایان، دوباره بزنید',
  processing: 'در حال تبدیل گفتار به متن…',
  error: 'خطای صدا — دوباره تلاش کنید',
};

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

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`; // CSS max-height caps at ~6 rows
  };

  // Voice: transcript is APPENDED to whatever the user already typed, so a mic
  // failure can never discard typed text (AC-VOICE-002).
  const voice = useVoice(
    useCallback((text: string) => {
      setValue((v) => (v ? v.trimEnd() + ' ' : '') + text);
    }, []),
  );

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  useEffect(() => {
    grow();
    if (value) ref.current?.focus();
  }, [value]);

  const recording = voice.state === 'listening' || voice.state === 'requesting';
  const micBusy = voice.state === 'processing';

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
    <div>
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
        {voice.supported && (
          <button
            type="button"
            className={`mic-btn${recording ? ' mic-recording' : ''}`}
            aria-label={VOICE_LABEL[voice.state]}
            aria-pressed={recording}
            title={VOICE_LABEL[voice.state]}
            disabled={disabled || micBusy}
            onClick={() => (recording ? voice.stop() : void voice.start())}
          >
            {recording ? <StopIcon /> : <MicIcon />}
          </button>
        )}
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
      {(recording || micBusy || voice.error) && (
        <p
          className={`voice-status${voice.error ? ' voice-status-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {voice.error ? voice.error.message : VOICE_LABEL[voice.state]}
        </p>
      )}
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
  tts,
}: {
  m: UIMessage;
  stage: string | null;
  showStage: boolean;
  onRetry: () => void;
  sessionId: string | null;
  onStillBroken: () => void;
  tts: ReturnType<typeof useTts>;
}) {
  const answered = m.done && !m.error && m.text !== '';
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
      {answered && (
        <div className="msg-actions">
          {tts.supported && (
            <button
              type="button"
              className={`listen-btn${tts.speakingId === m.id ? ' listen-active' : ''}`}
              aria-pressed={tts.speakingId === m.id}
              onClick={() => tts.toggle(m.id, m.text, hasPersian(m.text) ? 'fa' : 'en')}
            >
              <SpeakerIcon />
              {tts.speakingId === m.id ? 'توقف' : 'شنیدن'}
            </button>
          )}
          <Feedback sessionId={sessionId} messageId={m.id} onStillBroken={onStillBroken} />
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const { messages, send, retry, status, stage, contextChips, sessionId } = useChat();
  const tts = useTts();
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
                tts={tts}
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
