import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLlmsFile, chunkMarkdown, splitLong, sha16, loadAnchors } from '@/lib/docs/ingest';
import { normalizeFa } from '@/lib/text/persian';

describe('parseLlmsFile', () => {
  const raw =
    '﻿' +
    [
      'Original link: https://docs.liara.ir/paas/nextjs/getting-started',
      '',
      '# شروع به کار Next.js',
      '',
      'بدنه اصلی سند.',
      '',
      '## All links',
      '- [صفحه](https://docs.liara.ir/)',
      '',
    ].join('\r\n');

  it('parses BOM + CRLF input, extracts url/title, strips all-links boilerplate', () => {
    const parsed = parseLlmsFile(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe('https://docs.liara.ir/paas/nextjs/getting-started');
    expect(parsed!.title).toBe('شروع به کار Next.js');
    expect(parsed!.body.startsWith('# شروع به کار Next.js')).toBe(true);
    expect(parsed!.body.toLowerCase()).not.toContain('all links');
    expect(parsed!.body).not.toContain('\r');
  });

  it('returns null when no Original link line exists', () => {
    expect(parseLlmsFile('# صفحه\r\nمتن بدون لینک')).toBeNull();
  });

  it('falls back to url as title when no h1', () => {
    const p = parseLlmsFile('Original link: https://docs.liara.ir/x\r\n\r\nفقط متن.');
    expect(p!.title).toBe('https://docs.liara.ir/x');
  });
});

describe('chunkMarkdown', () => {
  const longPara = 'این یک پاراگراف آزمایشی نسبتا طولانی برای بخش بلند سند است. '.repeat(25);
  const fence = [
    '```bash',
    ...Array.from({ length: 15 }, (_, i) => `echo "خط شماره ${i}"`),
    '',
    'echo done',
    '```',
  ].join('\n');
  const body = [
    '# عنوان صفحه',
    '',
    'مقدمه کوتاه.',
    '',
    '## بخش بلند',
    longPara,
    '',
    fence,
    '',
    longPara,
    '',
    '### زیر بخش',
    'متن زیر بخش.',
  ].join('\n');

  const ctx = {
    sourcePath: 'public/llms/paas/nextjs/page.md',
    url: 'https://docs.liara.ir/paas/nextjs/page',
    title: 'عنوان صفحه',
    product: 'paas',
    platform: 'nextjs',
    anchors: new Map([[normalizeFa('بخش بلند'), 'long-sec']]),
  };

  it('splits at h2/h3, attaches heading + anchor, never splits mid-fence', () => {
    const chunks = chunkMarkdown(body, ctx);
    const longChunks = chunks.filter((c) => c.heading === 'بخش بلند');
    expect(longChunks.length).toBeGreaterThan(1); // >2200 chars section was split
    for (const c of longChunks) {
      expect(c.text.startsWith('## بخش بلند')).toBe(true);
      expect(c.anchor).toBe('long-sec');
      expect(c.headingPath).toEqual(['عنوان صفحه', 'بخش بلند']);
      // code fence intact: even number of ``` markers in every piece
      expect(((c.text.match(/```/g) ?? []).length) % 2).toBe(0);
    }
    expect(longChunks.some((c) => c.text.includes('```bash'))).toBe(true);
  });

  it('builds h3 breadcrumbs under the current h2', () => {
    const chunks = chunkMarkdown(body, ctx);
    const h3 = chunks.find((c) => c.heading === 'زیر بخش');
    expect(h3).toBeDefined();
    expect(h3!.headingPath).toEqual(['عنوان صفحه', 'بخش بلند', 'زیر بخش']);
    expect(h3!.anchor).toBeUndefined(); // not in anchors map
  });

  it('assigns stable ids and 16-char hashes', () => {
    const chunks = chunkMarkdown(body, ctx);
    chunks.forEach((c, i) => {
      expect(c.id).toBe(`${ctx.sourcePath}#${i}`);
      expect(c.hash).toMatch(/^[0-9a-f]{16}$/);
    });
    const again = chunkMarkdown(body, ctx);
    expect(again.map((c) => c.hash)).toEqual(chunks.map((c) => c.hash));
  });

  it('ignores # headings inside fences', () => {
    const b = '# ت\n\n```\n## نه یک عنوان\n```\nمتن.';
    const chunks = chunkMarkdown(b, { ...ctx, anchors: new Map() });
    expect(chunks.every((c) => c.heading !== 'نه یک عنوان')).toBe(true);
  });
});

describe('splitLong', () => {
  it('returns short text unchanged', () => {
    expect(splitLong('کوتاه')).toEqual(['کوتاه']);
  });

  it('splits long text at paragraph boundaries, never inside a fence, respects size', () => {
    const para = 'پاراگراف متنی تکراری برای تست تقسیم. '.repeat(20); // ~740 chars
    const fence = ['```js', 'const a = 1;', '', '// blank line inside fence', 'const b = 2;', '```'].join('\n');
    const text = [para, '', para, '', fence, '', para, '', para].join('\n');
    expect(text.length).toBeGreaterThan(2200);
    const pieces = splitLong(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(((p.match(/```/g) ?? []).length) % 2).toBe(0); // fences balanced
      expect(p.length).toBeLessThanOrEqual(2200 * 1.5 + 100); // hard cap respected
    }
    // nothing lost
    expect(pieces.join('\n')).toContain('blank line inside fence');
  });
});

describe('sha16', () => {
  it('is stable, 16 hex chars, input-sensitive', () => {
    expect(sha16('لیارا')).toBe(sha16('لیارا'));
    expect(sha16('لیارا')).toMatch(/^[0-9a-f]{16}$/);
    expect(sha16('a')).not.toBe(sha16('b'));
  });
});

describe('loadAnchors', () => {
  it('reads Section id/title from sibling mdx, both quote styles + swapped attr order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-anchors-'));
    try {
      fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'pages', 'x.mdx'),
        `<Section id='a' title="عنوان تست" />\r\n<Section title='بخش دوم' id="b"/>\r\n<Section id="no-title" />\r\n`,
        'utf8',
      );
      const map = loadAnchors(dir, 'x.md');
      expect(map.get(normalizeFa('عنوان تست'))).toBe('a');
      expect(map.get(normalizeFa('بخش دوم'))).toBe('b');
      expect(map.size).toBe(2); // Section without title ignored
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty map when mdx sibling is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liara-anchors-'));
    try {
      expect(loadAnchors(dir, 'nope.md').size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
