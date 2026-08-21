// Regression locks for the client-side half of the expert-panel product findings:
// PRD-05 (operator diagnostics leaking into user copy), PRD-09 (transcript does not
// survive a reload), PRD-11 (landing promise overshoots delivered behaviour) and the
// client half of MAINT-02 (the server's error message was discarded unconditionally).
// Every assertion below fails on the code as it was before this pass.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  faError,
  readPersisted,
  userError,
  writePersisted,
  type UIErrorCode,
  type UIMessage,
} from '@/components/useChat';

const CHAT = fs.readFileSync(path.join('src', 'components', 'Chat.tsx'), 'utf8');

const msg = (i: number, role: UIMessage['role'] = 'user'): UIMessage => ({
  id: `m-${i}`,
  role,
  text: `پیام ${i}`,
});

describe('PRD-05: user copy never contains operator diagnostics', () => {
  const codes: UIErrorCode[] = [
    'rate_limited',
    'model_timeout',
    'model_unavailable',
    'index_missing',
    'invalid_input',
    'internal',
    'network',
  ];

  it.each(codes)('%s names no env var, npm script or repo command', (code) => {
    const m = faError(code);
    expect(m).not.toMatch(/npm|OPENROUTER|API_KEY|env|localhost|\.ts\b/i);
    expect(m).toMatch(/[؀-ۿ]/);
  });

  it('index_missing tells the user to come back, not to build an index', () => {
    // was: 'ایندکس مستندات آماده نیست؛ ابتدا دستور npm run index را اجرا کنید.'
    expect(faError('index_missing')).not.toContain('ایندکس');
    expect(faError('index_missing')).toContain('دوباره تلاش');
  });
});

describe('MAINT-02 (client half): the server message is a fallback, not dead weight', () => {
  it('an unknown server code renders the server text instead of "خطای داخلی"', () => {
    const unknown = 'quota_exhausted' as UIErrorCode;
    expect(userError(unknown, 'سهمیه‌ی امروز تمام شد.')).toBe('سهمیه‌ی امروز تمام شد.');
    // the old client behaviour, and what it does with no server text to fall back on
    expect(faError(unknown)).toBe(faError('internal'));
    expect(userError(unknown)).toBe(faError('internal'));
    expect(userError(unknown, '   ')).toBe(faError('internal'));
  });

  it('a known code keeps the client copy, so PRD-05 cannot regress through the wire', () => {
    expect(userError('index_missing', 'دستور `npm run index` را اجرا کنید.')).toBe(
      faError('index_missing'),
    );
  });
});

describe('PRD-09: transcript and session id are persisted together', () => {
  it('round-trips the transcript with its session id', () => {
    const messages = [msg(1), msg(2, 'assistant')];
    const raw = writePersisted(messages, 's-1', 1000);
    expect(raw).not.toBeNull();
    expect(readPersisted(raw, 1000)).toEqual({ at: 1000, sessionId: 's-1', messages });
  });

  it('keeps only the most recent 40 messages', () => {
    const messages = Array.from({ length: 55 }, (_, i) => msg(i));
    const restored = readPersisted(writePersisted(messages, 's-1', 1000), 1000);
    expect(restored?.messages).toHaveLength(40);
    expect(restored?.messages[0]?.id).toBe('m-15');
    expect(restored?.messages.at(-1)?.id).toBe('m-54');
  });

  it('an empty transcript stores nothing', () => {
    expect(writePersisted([], 's-1', 1000)).toBeNull();
  });

  it('expires with the 24h server session TTL, so a dead id is never re-sent', () => {
    const raw = writePersisted([msg(1)], 's-1', 0);
    const day = 24 * 60 * 60 * 1000;
    expect(readPersisted(raw, day - 1)).not.toBeNull();
    expect(readPersisted(raw, day + 1)).toBeNull();
  });

  it('restores nothing from absent, malformed or empty snapshots', () => {
    expect(readPersisted(null)).toBeNull();
    expect(readPersisted('not json')).toBeNull();
    expect(readPersisted('{"messages":[{"id":"a"}]}')).toBeNull(); // no timestamp
    expect(readPersisted(JSON.stringify({ at: Date.now(), messages: [] }))).toBeNull();
  });

  it('the hook restores both halves and persists only when idle', () => {
    const HOOK = fs.readFileSync(path.join('src', 'components', 'useChat.ts'), 'utf8');
    // UX-04's fix was to restore neither; PRD-09's is to restore both at once.
    expect(HOOK).toMatch(/sessionRef\.current = p\.sessionId;\s*\n\s*setSessionId\(p\.sessionId\);\s*\n\s*setMessages\(p\.messages\);/);
    expect(HOOK).toMatch(/if \(status !== 'idle'\) return;/);
    // sessionStorage, not localStorage: the session id is a credential
    expect(HOOK).toContain('window.sessionStorage');
    expect(HOOK).not.toMatch(/window\.localStorage/);
  });
});

describe('PRD-11: the landing promises what actually ships', () => {
  it('drops the "you never need to read the docs again" headline', () => {
    expect(CHAT).not.toMatch(/<h1 className="headline">دیگه لازم نیست/);
    expect(CHAT).toMatch(/<h1 className="headline">پاسخ مستند و ارجاع‌دار/);
  });

  it('states the docs-only scope and the honest refusal under the composer', () => {
    expect(CHAT).toMatch(/className="landing-note"[\s\S]{0,240}docs\.liara\.ir/);
    expect(CHAT).toMatch(/className="landing-note"[\s\S]{0,240}نمی‌دانم/);
  });
});
