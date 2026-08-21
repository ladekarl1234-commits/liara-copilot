// UX-07: the first thing a new user clicks must not dead-end in a refusal. The
// shipped "رفع یک خطا" chip gated 'low' against the real index (verified before
// this fix), so the app's own call-to-action produced its worst output.
//
// The chip texts are parsed out of Chat.tsx rather than copied, so rewording a
// chip without re-checking retrieval fails here instead of shipping.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { search, loadIndex } from '@/lib/retrieval/index';

const INDEX_DIR = process.env.INDEX_DIR || path.join('data', 'index');
const HAS_INDEX = fs.existsSync(path.join(INDEX_DIR, 'lexical.json'));

function chipMessages(): string[] {
  const src = fs.readFileSync(path.join('src', 'components', 'Chat.tsx'), 'utf8');
  const block = /const CHIPS[\s\S]*?\n\];/.exec(src)?.[0] ?? '';
  return [...block.matchAll(/message: '([^']+)'/g)].map((m) => m[1] as string);
}

// Prompts the low-evidence recovery panel sends when the user narrows a question.
function recoveryHints(): string[] {
  const src = fs.readFileSync(path.join('src', 'components', 'Chat.tsx'), 'utf8');
  const block = /const narrower = \[[\s\S]*?\n {2}\];/.exec(src)?.[0] ?? '';
  return [...block.matchAll(/hint: '([^']+)'/g)].map((m) => m[1] as string);
}

describe.skipIf(!HAS_INDEX)('landing chips retrieve answerable evidence', () => {
  it('parses all four chips out of the component', () => {
    expect(chipMessages()).toHaveLength(4);
  });

  it('no chip gates to a refusal', async () => {
    const idx = loadIndex(INDEX_DIR);
    for (const q of chipMessages()) {
      const r = await search([q], {}, {}, idx);
      expect(r.confidence, `chip "${q.slice(0, 28)}…" must not refuse`).not.toBe('low');
      expect(r.chunks.length, `chip "${q.slice(0, 28)}…" must retrieve evidence`).toBeGreaterThan(0);
    }
  });

  it('each recovery narrowing turns a vague question into a retrievable one', async () => {
    const idx = loadIndex(INDEX_DIR);
    const vague = 'یه چیزی درباره‌ی لیارا بگو';
    const hints = recoveryHints();
    expect(hints.length).toBeGreaterThanOrEqual(2);
    for (const h of hints) {
      const r = await search([`${vague}\n${h}`], {}, {}, idx);
      expect(r.confidence, `narrowing "${h}" must not refuse`).not.toBe('low');
    }
  });
});
