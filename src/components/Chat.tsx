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
import Markdown, { hasPersian } from './Markdown';
import Sources from './Sources';
import WorkflowChecklist from './WorkflowChecklist';
import HypothesisList from './HypothesisList';
import Feedback from './Feedback';

// Every chip must retrieve answerable evidence — the first thing a new user
// clicks must not land on a refusal. The old "رفع یک خطا" wording named no
// artefact and gated 'low'; naming logs anchors it in the PaaS docs (UX-07).
// tests/ui-landing-chips.test.ts re-checks all four against the real index.
const CHIPS: { label: string; message: string }[] = [
  { label: 'استقرار پروژه‌ی من', message: 'می‌خواهم پروژه‌ام را روی لیارا مستقر کنم؛ از کجا شروع کنم؟' },
  { label: 'رفع یک خطا', message: 'برنامه‌ام روی لیارا اجرا نمی‌شود؛ چطور لاگ‌ها را ببینم و خطا را پیدا کنم؟' },
  { label: 'اتصال دیتابیس', message: 'چطور برنامه‌ام را به دیتابیس روی لیارا متصل کنم؟' },
  { label: 'تنظیم دامنه', message: 'چطور دامنه‌ی اختصاصی خودم را به برنامه‌ام روی لیارا وصل کنم؟' },
];

const PLACEHOLDER = 'چون من اینجام. سوالت رو ازم بپرس';

/** Mirrors config.ts MAX_INPUT_CHARS — the server rejects longer bodies with
 *  `invalid_input`, which costs a round trip and never names the real limit. */
const MAX_INPUT_CHARS = 8000;
const COUNTER_FROM = Math.floor(MAX_INPUT_CHARS * 0.9);

const faNum = (n: number) => n.toLocaleString('fa-IR');

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
  // The icon alone carries the current theme, and both icons are aria-hidden.
  // aria-pressed + a state-bearing name make the toggle readable (A11Y-12).
  const label = effectiveDark ? 'تم تاریک، فعال است' : 'تم روشن، فعال است';
  return (
    <button type="button" className="theme-toggle" onClick={toggle}
      aria-label={label} aria-pressed={effectiveDark} title={label}>
      {effectiveDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function Composer({
  onSend, onStop, streaming, large,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  large?: boolean;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  // Only a voice transcript may pull focus back into the box; a keystroke must not,
  // or focus is stolen from whatever the user tabbed to (A11Y-04).
  const fromVoiceRef = useRef(false);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const voice = useVoice(
    useCallback((text: string) => {
      fromVoiceRef.current = true;
      setValue((v) => (v ? v.trimEnd() + ' ' : '') + text);
    }, []),
  );

  // Autofocus only on a fine pointer: on touch it opens the keyboard before the
  // user has seen the suggestion chips, and halves the usable viewport (UX-08).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (document.activeElement === document.body) ref.current?.focus();
  }, []);

  useEffect(() => {
    grow();
    if (fromVoiceRef.current) {
      fromVoiceRef.current = false;
      ref.current?.focus();
    }
  }, [value]);

  const recording = voice.state === 'listening' || voice.state === 'requesting';
  const micBusy = voice.state === 'processing';
  const tooLong = value.length > MAX_INPUT_CHARS;

  const submit = () => {
    const t = value.trim();
    // The composer stays usable while an answer streams (UX-03); only sending is
    // held back, so the user can draft the next question in the meantime.
    if (!t || streaming || tooLong) return;
    onSend(t);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const voiceMsg = voice.error ? voice.error.message : recording || micBusy ? VOICE_LABEL[voice.state] : '';

  return (
    <div>
      <div className={`composer ${large ? 'composer-lg' : 'in-chat'}`}>
        {/* dir=auto (not the mock's hardcoded rtl): pasted English error logs and
            commands must render LTR while Persian prose stays RTL */}
        <textarea ref={ref} rows={1} value={value}
          placeholder={PLACEHOLDER} aria-label="پیام شما" dir="auto"
          maxLength={MAX_INPUT_CHARS} aria-describedby="composer-count"
          onChange={(e) => { setValue(e.target.value); grow(); }} onKeyDown={onKeyDown} />
        {voice.supported && (
          <button type="button" className={`mic-btn${recording ? ' mic-recording' : ''}`}
            aria-label={VOICE_LABEL[voice.state]} aria-pressed={recording} title={VOICE_LABEL[voice.state]}
            disabled={micBusy} onClick={() => (recording ? voice.stop() : void voice.start())}>
            {recording ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        {streaming ? (
          <button type="button" className="stop-btn" aria-label="توقف پاسخ‌دهی"
            title="توقف پاسخ‌دهی" onClick={onStop}>
            <StopIcon />
          </button>
        ) : (
          <button type="button" className="send-btn" aria-label="ارسال پیام"
            disabled={value.trim() === '' || tooLong} onClick={submit}>
            <SendIcon />
          </button>
        )}
      </div>
      {/* Both regions are mounted permanently and empty: a live region created
          together with its text is generally not announced at all (A11Y-07). */}
      <p className={`voice-status${voice.error ? ' voice-status-error' : ''}`} role="status" aria-live="polite">
        {voiceMsg}
      </p>
      <p id="composer-count" className={`char-count${tooLong ? ' char-count-over' : ''}`}>
        {value.length >= COUNTER_FROM
          ? `${faNum(value.length)} از ${faNum(MAX_INPUT_CHARS)} نویسه`
          : ''}
      </p>
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

/** A grounded answer always carries citations. A done answer with none is the
 *  refusal / low-evidence path, which otherwise dead-ends with no next step (UX-07). */
function Recovery({ question, onAsk }: { question: string; onAsk: (t: string) => void }) {
  // Scoped to the three largest product families in the index (paas, dbaas,
  // one-click-apps): naming a service is what usually turns a no-evidence
  // question into a retrievable one.
  const narrower = [
    { label: 'درباره‌ی اپلیکیشن (PaaS)', hint: 'منظورم سرویس اپلیکیشن (PaaS) لیارا است.' },
    { label: 'درباره‌ی دیتابیس', hint: 'منظورم سرویس دیتابیس لیارا است.' },
    { label: 'درباره‌ی دامنه و DNS', hint: 'منظورم تنظیم دامنه و DNS در لیارا است.' },
  ];
  const search = `https://www.google.com/search?q=${encodeURIComponent(`site:docs.liara.ir ${question}`)}`;
  return (
    <div className="recovery">
      <p className="recovery-title">می‌توانید سوال را دقیق‌تر کنید:</p>
      <div className="recovery-chips">
        {narrower.map((n) => (
          <button key={n.label} type="button" className="chip"
            onClick={() => onAsk(`${question}\n${n.hint}`)}>
            {n.label}
          </button>
        ))}
      </div>
      <a className="recovery-link" href={search} target="_blank" rel="noopener noreferrer nofollow">
        جست‌وجوی همین سوال در مستندات لیارا
      </a>
    </div>
  );
}

function AssistantMessage({
  m, stage, showStage, streaming, question, onRetry, onAsk, sessionId, onStillBroken, tts,
}: {
  m: UIMessage; stage: string | null; showStage: boolean; streaming: boolean; question: string;
  onRetry: () => void; onAsk: (t: string) => void;
  sessionId: string | null; onStillBroken: () => void; tts: ReturnType<typeof useTts>;
}) {
  const answered = m.done && !m.error && m.text !== '';
  const speaking = tts.speakingId === m.id;
  const lowEvidence =
    answered && !m.stopped && question !== '' && (m.citations?.length ?? 0) === 0;
  return (
    // aria-busy marks the turn as in-flight instead of streaming every token into
    // a live region; the log itself is aria-live="off" (A11Y-01).
    <article className="asst" aria-busy={streaming}
      style={{ minWidth: 0, animation: 'fadeUp .3s ease both' }}>
      <h2 className="sr-only">پاسخ دستیار</h2>
      {m.workflow && <WorkflowChecklist workflow={m.workflow} />}
      {m.troubleshooting && <HypothesisList state={m.troubleshooting} />}
      {showStage && <p className="stage">{stage ?? 'در حال آماده‌سازی…'}</p>}
      {m.text !== '' && <Markdown citations={m.citations}>{m.text}</Markdown>}
      {m.stopped && <p className="note">پاسخ به درخواست شما متوقف شد.</p>}
      {m.verificationNote && (
        <p className="note"><span className="note-label">اصلاحیه</span>{m.verificationNote}</p>
      )}
      {m.citations && m.citations.length > 0 && <Sources citations={m.citations} />}
      {m.error && <ErrorBlock message={m.error.message} onRetry={onRetry} />}
      {lowEvidence && <Recovery question={question} onAsk={onAsk} />}
      {answered && (
        <div className="msg-actions">
          {tts.supported && (
            <button type="button" className={`listen-btn${speaking ? ' listen-active' : ''}`}
              aria-pressed={speaking} aria-label={speaking ? 'توقف خواندن پاسخ' : 'خواندن پاسخ با صدا'}
              onClick={() => tts.toggle(m.id, m.text, hasPersian(m.text) ? 'fa' : 'en')}>
              <SpeakerIcon />{speaking ? 'توقف' : 'شنیدن'}
            </button>
          )}
          <Feedback sessionId={sessionId} messageId={m.serverId ?? m.id} onStillBroken={onStillBroken} />
        </div>
      )}
      {/* role=alert, not status: this node is inserted together with its text, and
          an assertive region is the one kind that is still announced on insert. */}
      {tts.error?.id === m.id && (
        <p className="voice-status voice-status-error" role="alert">{tts.error.message}</p>
      )}
    </article>
  );
}

export default function Chat() {
  const { messages, send, retry, reset, abort, status, stage, contextChips, sessionId } = useChat();
  const tts = useTts();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const streaming = status === 'streaming';
  const [liveStatus, setLiveStatus] = useState('');

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onStillBroken = useCallback(() => send('هنوز حل نشده'), [send]);

  // The single announcement channel: discrete status only, never answer tokens.
  // Streaming the answer itself through a live region makes a screen reader
  // re-read the whole Persian paragraph on every delta (A11Y-01).
  useEffect(() => {
    if (streaming) {
      setLiveStatus(stage ?? 'در حال آماده‌سازی پاسخ…');
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.done) return;
    if (last.error) setLiveStatus(last.error.message);
    else if (last.stopped) setLiveStatus('پاسخ متوقف شد.');
    else {
      const n = last.citations?.length ?? 0;
      setLiveStatus(n > 0 ? `پاسخ آماده شد؛ ${faNum(n)} منبع.` : 'پاسخ آماده شد.');
    }
  }, [streaming, stage, messages]);

  const onReset = useCallback(() => {
    if (messages.length > 0 && !window.confirm('گفت‌وگوی فعلی پاک می‌شود. ادامه می‌دهید؟')) return;
    reset();
  }, [messages.length, reset]);

  // Rendered first in BOTH branches so React reconciles it across the
  // landing→chat switch and the region is never re-created with content in it.
  const live = <p className="sr-only" role="status" aria-live="polite">{liveStatus}</p>;

  if (messages.length === 0) {
    return (
      <main dir="rtl" className="shell">
        {live}
        <ThemeToggle />
        <div className="blobs" aria-hidden="true"><div className="blob blob-a" /><div className="blob blob-b" /></div>
        <div className="landing">
          <div className="landing-inner">
            <img src="/liara-logo.jpg" alt="لیارا" width={60} height={60} className="landing-logo" />
            {/* PRD-11: the old headline ("دیگه لازم نیست، مستندات لیارا رو بخونی!")
                promised what the honest-refusal design is built to violate — at
                hit@1 well under 100% and a gate that deliberately refuses on low
                confidence, a first-turn refusal read as the product failing rather
                than as the product being careful. This promises what actually ships. */}
            <h1 className="headline">پاسخ مستند و ارجاع‌دار از مستندات رسمی لیارا</h1>
            <div style={{ width: '100%', animation: 'fadeUp .6s ease .55s both' }}>
              <Composer large onSend={send} onStop={abort} streaming={streaming} />
            </div>
            <div className="chips" style={{ animation: 'fadeUp .6s ease .75s both' }}>
              {CHIPS.map((c) => (
                <button key={c.label} type="button" className="chip" onClick={() => send(c.message)}>{c.label}</button>
              ))}
            </div>
            {/* The scope line, under the composer: says up front that the corpus is
                docs-only and that a miss ends in an honest "نمی‌دانم" (PRD-11). */}
            <p className="landing-note">
              پاسخ‌ها فقط از مستندات رسمی لیارا (docs.liara.ir) ساخته می‌شوند؛ اگر پاسخ در مستندات نباشد، صادقانه می‌گویم که نمی‌دانم.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const last = messages[messages.length - 1];
  return (
    <main dir="rtl" className="shell chat">
      {live}
      <ThemeToggle />
      <header className="chat-header">
        <div className="chat-header-inner">
          <img src="/liara-logo.jpg" alt="" width={28} height={28} className="header-logo" />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            {/* The chat view's top-level heading. Visually identical to the old
                span; it just stops the page from having no h1 at all (A11Y-05). */}
            <h1 className="brand-name">دستیار هوشمند لیارا</h1>
            <span className="brand-sub" lang="en">Liara Copilot</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="new-chat" onClick={onReset}>گفت‌وگوی جدید</button>
        </div>
      </header>

      {/* tabIndex: a scroll container with no focusable children cannot be reached
          or scrolled by keyboard (SC 2.1.1). aria-live="off" overrides role=log's
          implicit polite, which is what re-read the answer on every token. */}
      <div ref={scrollRef} onScroll={onScroll} className="chat-log"
        tabIndex={0} role="log" aria-live="off" aria-label="گفت‌وگو">
        <div className="chat-log-inner">
          {messages.map((m, i): ReactNode => {
            if (m.role === 'user') {
              return (
                <article key={m.id} className="msg-user" dir="auto">
                  <h2 className="sr-only">پیام شما</h2>
                  {m.text}
                </article>
              );
            }
            const isLast = m.id === last?.id;
            const showStage = streaming && isLast && m.text === '' && !m.error && !m.workflow && !m.troubleshooting;
            const prev = messages[i - 1];
            return (
              <AssistantMessage key={m.id} m={m} stage={stage} showStage={showStage}
                streaming={streaming && isLast} question={prev?.role === 'user' ? prev.text : ''}
                onRetry={retry} onAsk={send} sessionId={sessionId}
                onStillBroken={onStillBroken} tts={tts} />
            );
          })}
        </div>
      </div>

      <div className="composer-area">
        <div className="composer-wrap">
          {contextChips.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {contextChips.map((chip) => <span key={chip} className="ctx-chip" lang="en">{chip}</span>)}
            </div>
          )}
          <Composer onSend={send} onStop={abort} streaming={streaming} />
        </div>
      </div>
    </main>
  );
}
