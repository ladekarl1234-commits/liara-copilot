// There is no DOM test environment in this project (node-only vitest, no jsdom /
// testing-library / jest-axe in package.json), so the markup-level accessibility
// invariants are asserted against the component sources. Each assertion below
// FAILS on the code as it was before this pass — they are regression locks for
// A11Y-01/03/05/06/07/09/11/12 and UX-02/03/05/08/12, not style checks.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (...p: string[]) => fs.readFileSync(path.join('src', ...p), 'utf8');

const CHAT = read('components', 'Chat.tsx');
const MARKDOWN = read('components', 'Markdown.tsx');
const SOURCES = read('components', 'Sources.tsx');
const CODE_BLOCK = read('components', 'CodeBlock.tsx');
const WORKFLOW = read('components', 'WorkflowChecklist.tsx');
const HYPOTHESES = read('components', 'HypothesisList.tsx');
const LAYOUT = read('app', 'layout.tsx');
const CSS = read('app', 'globals.css');

describe('A11Y-01: streamed tokens never enter a live region', () => {
  it('the chat log opts out of role=log\'s implicit aria-live="polite"', () => {
    expect(CHAT).toMatch(/role="log"\s+aria-live="off"/);
    // The only polite live regions left are the discrete status nodes.
    expect(CHAT).not.toMatch(/aria-live="polite"[^>]*className="chat-log-inner"/);
  });

  it('the in-flight turn is marked aria-busy instead', () => {
    expect(CHAT).toMatch(/aria-busy=\{streaming\}/);
  });

  it('a persistent status region carries the discrete announcements', () => {
    expect(CHAT).toMatch(/role="status" aria-live="polite">\{liveStatus\}/);
    expect(CHAT).toContain('پاسخ آماده شد');
  });
});

describe('A11Y-03: scroll containers are keyboard reachable (SC 2.1.1)', () => {
  it.each([
    ['chat log', CHAT],
    ['markdown tables', MARKDOWN],
    ['code blocks', CODE_BLOCK],
  ])('%s carries tabIndex={0}', (_n, src) => {
    expect(src).toContain('tabIndex={0}');
  });
});

describe('A11Y-05: turns are attributed and the page has an h1', () => {
  it('both roles render as <article> with a visually hidden heading', () => {
    expect(CHAT).toMatch(/<article [^>]*className="msg-user"/);
    expect(CHAT).toMatch(/<article className="asst"/);
    expect(CHAT).toContain('<h2 className="sr-only">پیام شما</h2>');
    expect(CHAT).toContain('<h2 className="sr-only">پاسخ دستیار</h2>');
  });

  it('the chat view has a top-level heading', () => {
    expect(CHAT).toMatch(/<h1 className="brand-name">/);
  });

  it('model markdown headings are downshifted so they never outrank the page', () => {
    expect(MARKDOWN).toMatch(/h1: .*<h3 /);
    expect(MARKDOWN).toMatch(/h2: .*<h4 /);
    // The visual scale must follow the tags that are actually emitted.
    expect(CSS).toMatch(/\.md h3,\n\.md h4,\n\.md h5,\n\.md h6 \{/);
  });
});

describe('A11Y-06: panel status is not colour/glyph only', () => {
  it.each([
    ['workflow', WORKFLOW, ['انجام‌شده', 'در حال انجام', 'باقی‌مانده']],
    ['hypotheses', HYPOTHESES, ['تأیید شد', 'رد شد', 'در حال بررسی']],
  ])('%s states each item status in words', (_n, src, words) => {
    expect(src).toContain('sr-only');
    for (const w of words) expect(src).toContain(w);
  });
});

describe('A11Y-07: live regions are mounted before they have content', () => {
  it('the voice status paragraph is unconditional', () => {
    // Previously `{(recording || micBusy || voice.error) && <p role="status">…}`.
    expect(CHAT).not.toMatch(/\(recording \|\| micBusy \|\| voice\.error\) && \(/);
    expect(CHAT).toMatch(/role="status" aria-live="polite">\s*\{voiceMsg\}/);
  });

  it('the empty regions collapse so they cost no layout', () => {
    expect(CSS).toMatch(/\.voice-status:empty/);
  });
});

describe('A11Y-11: Latin content declares its language', () => {
  it.each([
    ['brand subtitle + context chips', CHAT],
    ['source labels', SOURCES],
    ['code', CODE_BLOCK],
  ])('%s carry lang="en"', (_n, src) => {
    expect(src).toContain('lang="en"');
  });
});

describe('A11Y-12: toggles expose their state in the accessible name', () => {
  it('the theme toggle is a pressed-state button with a state-bearing label', () => {
    expect(CHAT).toMatch(/aria-pressed=\{effectiveDark\}/);
    expect(CHAT).toContain('تم تاریک، فعال است');
  });

  it('the listen button names its action rather than relying on flipping text', () => {
    expect(CHAT).toMatch(/aria-label=\{speaking \? 'توقف خواندن پاسخ' : 'خواندن پاسخ با صدا'\}/);
  });
});

describe('UX-02/05: direction is chosen per block, not inferred per node', () => {
  it('Markdown sets one base direction from the answer language', () => {
    expect(MARKDOWN).toMatch(/const dir = hasPersian\(children\) \? 'rtl' : 'ltr'/);
    // dir="auto" on p/li is what flipped Persian paragraphs opening with a command.
    expect(MARKDOWN).not.toMatch(/p: .*dir="auto"/);
    expect(MARKDOWN).not.toMatch(/li: .*dir="auto"/);
  });

  it('citation labels no longer force LTR over Persian titles', () => {
    expect(SOURCES).not.toMatch(/<bdi dir="ltr">\s*\n?\s*Liara Docs · \{c\.product\} · \{c\.title\}/);
    expect(SOURCES).toMatch(/<bdi>\{c\.title\}<\/bdi>/);
  });
});

describe('UX-03: generation can be stopped and the composer stays usable', () => {
  it('a stop button replaces send while streaming', () => {
    expect(CHAT).toMatch(/streaming \? \(\s*<button type="button" className="stop-btn"/);
    expect(CHAT).toContain('توقف پاسخ‌دهی');
  });

  it('the textarea and mic are no longer disabled by streaming', () => {
    expect(CHAT).not.toMatch(/<textarea[^>]*disabled=/s);
    expect(CHAT).not.toMatch(/disabled=\{disabled \|\| micBusy\}/);
  });
});

describe('UX-08/12: landing reachability and input guard', () => {
  it('the landing scrolls instead of clipping a too-tall stack', () => {
    expect(CSS).toMatch(/\.landing \{[^}]*overflow-y: auto/s);
    expect(CSS).toMatch(/\.landing-inner \{[^}]*margin-block: auto/s);
    expect(CSS).not.toMatch(/margin-top: -8dvh/);
  });

  it('autofocus is gated on a fine pointer rather than set unconditionally', () => {
    expect(CHAT).not.toMatch(/<textarea[^>]*autoFocus/s);
    expect(CHAT).toContain("matchMedia('(pointer: fine)')");
  });

  it('the composer enforces the server input limit client-side', () => {
    expect(CHAT).toMatch(/const MAX_INPUT_CHARS = 8000/);
    expect(CHAT).toMatch(/maxLength=\{MAX_INPUT_CHARS\}/);
  });
});

describe('UX-01: the mobile keyboard shrinks the layout viewport', () => {
  it('the viewport export opts into resizes-content', () => {
    expect(LAYOUT).toMatch(/interactiveWidget: 'resizes-content'/);
  });
});

it('a .sr-only utility actually exists (it was referenced nowhere before)', () => {
  expect(CSS).toMatch(/\.sr-only \{[^}]*clip-path: inset\(50%\)/s);
});
