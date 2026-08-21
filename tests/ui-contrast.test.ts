// WCAG contrast is arithmetic, so it can be certified without a browser: parse
// the token blocks out of globals.css and compute the real ratios. This is the
// gate for A11Y-02 (1.4.3 text / 1.4.11 focus indicator) and A11Y-08 (control
// boundaries), both of which passed a human review while failing by 1.5x.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.join('src', 'app', 'globals.css'), 'utf8');

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function ratio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Pull `--name: #rrggbb;` declarations out of one brace-delimited block. */
function tokensIn(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector);
  expect(at, `${selector} must exist in globals.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of CSS.slice(open, close).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
    out[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return out;
}

const LIGHT = tokensIn(':root {');
const DARK = tokensIn(':root[data-theme="dark"]');

const need = (t: Record<string, string>, k: string): string => {
  const v = t[k];
  expect(v, `--${k} must be defined`).toBeTruthy();
  return v as string;
};

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s palette', (_name, t) => {
  it('accent text clears 4.5:1 on every surface it is drawn on', () => {
    const fg = need(t, 'accent-text');
    // .md a and .note-label sit on --bg; chips/panels on --surface; inline code
    // and the user bubble on --code-bg / --user-bg.
    for (const bg of ['bg', 'surface', 'code-bg', 'user-bg']) {
      expect(ratio(fg, need(t, bg)), `--accent-text on --${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the focus ring clears 3:1 against the surfaces it is drawn over', () => {
    const fg = need(t, 'focus');
    for (const bg of ['bg', 'surface']) {
      expect(ratio(fg, need(t, bg)), `--focus on --${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('interactive boundaries clear 3:1 (SC 1.4.11)', () => {
    const fg = need(t, 'border-strong');
    for (const bg of ['bg', 'surface']) {
      expect(ratio(fg, need(t, bg)), `--border-strong on --${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('code comments and muted body text clear 4.5:1', () => {
    expect(ratio(need(t, 'hl-comment'), need(t, 'code-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(need(t, 'muted'), need(t, 'bg'))).toBeGreaterThanOrEqual(4.5);
  });
});

it('the prefers-color-scheme block defines the same tokens as the toggle block', () => {
  const media = tokensIn(':root:not([data-theme="light"])');
  for (const k of ['accent-text', 'focus', 'border-strong']) {
    expect(media[k], `--${k} must exist in the media-query dark block too`).toBe(DARK[k]);
  }
});

it('the decorative --accent is still the brand colour, not the darkened text token', () => {
  // Guards against "fixing" contrast by darkening the brand fill everywhere.
  expect(LIGHT['accent']).toBe('#149ec4');
  expect(LIGHT['accent-text']).not.toBe(LIGHT['accent']);
});
