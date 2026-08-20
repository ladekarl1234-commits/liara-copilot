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
import { useTheme } from './useTheme';
import Markdown from './Markdown';
import Sources from './Sources';
import WorkflowChecklist from './WorkflowChecklist';
import HypothesisList from './HypothesisList';
import Feedback from './Feedback';

const hasPersian = (t: string) => /[؀-ۿ]/.test(t);

const CHIPS: { label: string; message: string }[] = [
  { label: 'استقرار پروژه‌ی من', message: 'می‌خواهم پروژه‌ام را روی لیارا مستقر کنم؛ از کجا شروع کنم؟' },
  { label: 'رفع یک خطا', message: 'برنامه‌ام روی لیارا به خطا خورده و می‌خواهم علتش را پیدا و رفع کنم.' },
  { label: 'اتصال دیتابیس', message: 'چطور برنامه‌ام را به دیتابیس روی لیارا متصل کنم؟' },
  { label: 'تنظیم دامنه', message: 'چطور دامنه‌ی اختصاصی خودم را به برنامه‌ام روی لیارا وصل کنم؟' },
];

const PLACEHOLDER = 'چون من اینجام. سوالت رو ازم بپرس';

function Icon({ children, w = 16 }: { children: ReactNode; w?: number }) {
  return (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const SendIcon = () => <Icon w={18}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>;
const MicIcon = () => <Icon><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></Icon>;
const StopIcon = () => <Icon><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>;
const SpeakerIcon = () => <Icon><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></Icon>;
const SunIcon = () => <Icon w={17}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></Icon>;
const MoonIcon = () => <Icon w={17}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></Icon>;

const VOICE_LABEL: Record<VoiceState, string> = {
  idle: 'گفتن با صدا',
  unsupported: 'ضبط صدا در این مرورگر پشتیبانی نمی‌شود',
  requesting: 'در حال گرفتن اجازه‌ی میکروفون…',
  listening: 'در حال شنیدن — برای پایان، دوباره بزنید',
  processing: 'در حال تبدیل گفتار به متن…',
  error: 'خطای صدا — دوباره تلاش کنید',
};

function ThemeToggle() {
  const { effectiveDark, toggle } = useTheme();
  return (
    <button type="button" className="theme-toggle" onClick={toggle}
      aria-label="تغییر تم روشن و تاریک" title="تغییر تم">
      {effectiveDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function Composer({ onSend, disabled, large }: { onSend: (text: string) => void; disabled: boolean; large?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const voice = useVoice(
    useCallback((text: string) => setValue((v) => (v ? v.trimEnd() + ' ' : '') + text), []),
  );

  useEffect(() => { if (!disabled) ref.current?.focus(); }, [disabled]);
  useEffect(() => { grow(); if (value) ref.current?.focus(); }, [value]);

  const recording = voice.state === 'listening' || voice.state === 'requesting';
  const micBusy = voice.state === 'processing';

  const submit = () => {
    const t = value.trim();
    if (!t || disabled) return;
    onSend(t);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <div>
      <div className={`composer ${large ? 'composer-lg' : 'in-chat'}`}>
        {/* dir=auto (not the mock's hardcoded rtl): pasted English error logs and
            commands must render LTR while Persian prose stays RTL */}
        <textarea ref={ref} rows={1} value={value} autoFocus disabled={disabled}
          placeholder={PLACEHOLDER} aria-label="پیام شما" dir="auto"
          onChange={(e) => { setValue(e.target.value); grow(); }} onKeyDown={onKeyDown} />
        {voice.supported && (
          <button type="button" className={`mic-btn${recording ? ' mic-recording' : ''}`}
            aria-label={VOICE_LABEL[voice.state]} aria-pressed={recording} title={VOICE_LABEL[voice.state]}
            disabled={disabled || micBusy} onClick={() => (recording ? voice.stop() : void voice.start())}>
            {recording ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        <button type="button" className="send-btn" aria-label="ارسال پیام"
          disabled={disabled || value.trim() === ''} onClick={submit}>
          <SendIcon />
        </button>
      </div>
      {(recording || micBusy || voice.error) && (
        <p className={`voice-status${voice.error ? ' voice-status-error' : ''}`} role="status" aria-live="polite">
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
      <button type="button" className="retry-btn" onClick={onRetry}>تلاش دوباره</button>
    </div>
  );
}

function AssistantMessage({
  m, stage, showStage, onRetry, sessionId, onStillBroken, tts,
}: {
  m: UIMessage; stage: string | null; showStage: boolean; onRetry: () => void;
  sessionId: string | null; onStillBroken: () => void; tts: ReturnType<typeof useTts>;
}) {
  const answered = m.done && !m.error && m.text !== '';
  return (
    <div className="asst" style={{ minWidth: 0, animation: 'fadeUp .3s ease both' }}>
      {m.workflow && <WorkflowChecklist workflow={m.workflow} />}
      {m.troubleshooting && <HypothesisList state={m.troubleshooting} />}
      {showStage && <p className="stage">{stage ?? 'در حال آماده‌سازی…'}</p>}
      {m.text !== '' && <div dir="auto"><Markdown>{m.text}</Markdown></div>}
      {m.verificationNote && (
        <p className="note"><span className="note-label">اصلاحیه</span>{m.verificationNote}</p>
      )}
      {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
      {m.error && <ErrorBlock message={m.error.message} onRetry={onRetry} />}
      {answered && (
        <div className="msg-actions">
          {tts.supported && (
            <button type="button" className={`listen-btn${tts.speakingId === m.id ? ' listen-active' : ''}`}
              aria-pressed={tts.speakingId === m.id}
              onClick={() => tts.toggle(m.id, m.text, hasPersian(m.text) ? 'fa' : 'en')}>
              <SpeakerIcon />{tts.speakingId === m.id ? 'توقف' : 'شنیدن'}
            </button>
          )}
          <Feedback sessionId={sessionId} messageId={m.id} onStillBroken={onStillBroken} />
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const { messages, send, retry, reset, status, stage, contextChips, sessionId } = useChat();
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
      <main dir="rtl" className="shell">
        <ThemeToggle />
        <div className="blobs" aria-hidden="true"><div className="blob blob-a" /><div className="blob blob-b" /></div>
        <div className="landing">
          <div className="landing-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/liara-logo.jpg" alt="لیارا" width={60} height={60} className="landing-logo" />
            <h1 className="headline">دیگه لازم نیست، مستندات لیارا رو بخونی!</h1>
            <div style={{ width: '100%', animation: 'fadeUp .6s ease .55s both' }}>
              <Composer large onSend={send} disabled={streaming} />
            </div>
            <div className="chips" style={{ animation: 'fadeUp .6s ease .75s both' }}>
              {CHIPS.map((c) => (
                <button key={c.label} type="button" className="chip" onClick={() => send(c.message)}>{c.label}</button>
              ))}
            </div>
            <p className="landing-note">پاسخ‌ها بر پایه‌ی مستندات رسمی لیارا (docs.liara.ir) هستند.</p>
          </div>
        </div>
      </main>
    );
  }

  const last = messages[messages.length - 1];
  return (
    <main dir="rtl" className="shell chat">
      <ThemeToggle />
      <header className="chat-header">
        <div className="chat-header-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/liara-logo.jpg" alt="" width={28} height={28} className="header-logo" />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span className="brand-name">دستیار هوشمند لیارا</span>
            <span className="brand-sub">Liara Copilot</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="new-chat" onClick={reset}>گفت‌وگوی جدید</button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="chat-log">
        <div role="log" aria-live="polite" className="chat-log-inner">
          {messages.map((m): ReactNode => {
            if (m.role === 'user') {
              return <div key={m.id} className="msg-user" dir="auto">{m.text}</div>;
            }
            const isLast = m.id === last?.id;
            const showStage = streaming && isLast && m.text === '' && !m.error && !m.workflow && !m.troubleshooting;
            return (
              <AssistantMessage key={m.id} m={m} stage={stage} showStage={showStage} onRetry={retry}
                sessionId={sessionId} onStillBroken={onStillBroken} tts={tts} />
            );
          })}
        </div>
      </div>

      <div className="composer-area">
        <div className="composer-wrap">
          {contextChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {contextChips.map((chip) => <span key={chip} className="ctx-chip">{chip}</span>)}
            </div>
          )}
          <Composer onSend={send} disabled={streaming} />
        </div>
      </div>
    </main>
  );
}
