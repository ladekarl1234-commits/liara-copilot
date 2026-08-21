import { describe, it, expect } from 'vitest';
import MiniSearch from 'minisearch';
import type { DocChunk } from '@/types';
import {
  search,
  miniOptions,
  loadIndex,
  resetIndexForTests,
  IndexMissingError,
  citationUrl,
  type LoadedIndex,
} from '@/lib/retrieval/index';

function mkChunk(o: {
  id: string;
  product: string;
  platform?: string;
  title: string;
  heading?: string;
  text: string;
  url?: string;
  anchor?: string;
}): DocChunk {
  return {
    id: o.id,
    sourcePath: o.id.split('#')[0],
    url: o.url ?? `https://docs.liara.ir/${o.product}/${o.platform ?? 'general'}/page`,
    anchor: o.anchor,
    product: o.product,
    platform: o.platform,
    title: o.title,
    heading: o.heading,
    headingPath: [o.title],
    contentType: 'text',
    text: o.text,
    hash: o.id,
  };
}

function mkIndex(chunks: DocChunk[]): LoadedIndex {
  const lexical = new MiniSearch(miniOptions());
  lexical.addAll(chunks);
  return {
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    lexical,
    vectors: null,
    meta: { builtAt: '2026-01-01T00:00:00Z', chunkCount: chunks.length, anchorCoverage: 0, lexicalVersion: 2 },
  };
}

const corpus: DocChunk[] = [
  mkChunk({
    id: 'paas/nextjs/getting-started.md#0',
    product: 'paas',
    platform: 'nextjs',
    title: 'استقرار Next.js',
    heading: 'استقرار برنامه',
    anchor: 'deploy',
    url: 'https://docs.liara.ir/paas/nextjs/getting-started',
    text: 'برای استقرار برنامه Next.js در لیارا از دستور liara deploy استفاده کنید.',
  }),
  mkChunk({
    id: 'paas/nextjs/envs.md#0',
    product: 'paas',
    platform: 'nextjs',
    title: 'متغیرهای محیطی Next.js',
    text: 'تنظیم متغیر محیطی DATABASE_URL برای برنامه Next.js از بخش تنظیمات.',
  }),
  mkChunk({
    id: 'paas/django/getting-started.md#0',
    product: 'paas',
    platform: 'django',
    title: 'استقرار Django',
    text: 'برای استقرار برنامه Django در لیارا فایل requirements.txt لازم است.',
  }),
  mkChunk({
    id: 'paas/docker/getting-started.md#0',
    product: 'paas',
    platform: 'docker',
    title: 'استقرار Docker',
    text: 'برای استقرار برنامه Docker یک Dockerfile معتبر بسازید.',
  }),
  mkChunk({
    id: 'dbaas/postgresql/how-to-connect.md#0',
    product: 'dbaas',
    platform: 'postgresql',
    title: 'اتصال به PostgreSQL',
    text: 'اتصال به دیتابیس PostgreSQL با ساخت DATABASE_URL انجام می‌شود.',
  }),
  mkChunk({
    id: 'object-storage/buckets.md#0',
    product: 'object-storage',
    title: 'Object Storage Buckets',
    text: 'Create a bucket in object storage and access it with the S3 API.',
  }),
  mkChunk({
    id: 'dns/records.md#0',
    product: 'dns',
    title: 'مدیریت رکوردهای DNS',
    text: 'رکورد A و CNAME را از پنل مدیریت دامنه اضافه کنید.',
  }),
];

const idx = mkIndex(corpus);

describe('search', () => {
  it('ranks the relevant chunk first for a Persian query', async () => {
    const res = await search(['استقرار next.js'], {}, {}, idx);
    expect(res.chunks.length).toBeGreaterThan(0);
    expect(res.chunks[0].chunk.id).toBe('paas/nextjs/getting-started.md#0');
  });

  it('platform filter prefers the platform but falls back when <5 results', async () => {
    const res = await search(['استقرار'], { platform: 'nextjs' }, {}, idx);
    expect(res.chunks[0].chunk.platform).toBe('nextjs');
    // fallback kicked in: cross-platform chunks appear after the filtered ones
    const platforms = res.chunks.map((s) => s.chunk.platform);
    expect(platforms.some((p) => p !== 'nextjs')).toBe(true);
  });

  it('platform filter boosts the matching platform to the top', async () => {
    const a = await search(['استقرار برنامه'], { platform: 'django' }, {}, idx);
    expect(a.chunks[0].chunk.platform).toBe('django');
    const b = await search(['استقرار برنامه'], { platform: 'nextjs' }, {}, idx);
    expect(b.chunks[0].chunk.platform).toBe('nextjs');
  });

  it('returns low confidence for an out-of-scope query', async () => {
    const res = await search(['خرید بلیط هواپیما قسطی'], {}, {}, idx);
    expect(res.confidence).toBe('low');
  });

  it('returns non-low confidence for an exact-match query', async () => {
    const res = await search(['استقرار next.js'], {}, {}, idx);
    expect(res.confidence).not.toBe('low');
  });

  it('returns low confidence + empty for no queries', async () => {
    const res = await search([], {}, {}, idx);
    expect(res.confidence).toBe('low');
    expect(res.chunks).toEqual([]);
  });

  it('caps evidence at 8 chunks', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      mkChunk({
        id: `overview/about.md#${i}`,
        product: 'overview',
        title: `سند ${i}`,
        text: `لیارا سرویس ابری شماره ${i} است.`,
      }),
    );
    const res = await search(['لیارا'], {}, {}, mkIndex(many));
    expect(res.chunks.length).toBe(8);
  });
});

describe('citationUrl', () => {
  it('appends #anchor with a guaranteed trailing slash', () => {
    expect(citationUrl(corpus[0])).toBe('https://docs.liara.ir/paas/nextjs/getting-started/#deploy');
  });

  // UPDATED (EP-RET-09): a chunk with no authored anchor no longer degrades to
  // a bare page link — it deep-links to its opening sentence with a
  // `#:~:text=` fragment. Chunks with no usable prose still return the plain
  // url (asserted below).
  it('falls back to a text-fragment deep link when there is no anchor', () => {
    const url = citationUrl(corpus[2]);
    expect(url.startsWith(`${corpus[2].url}#:~:text=`)).toBe(true);
    expect(decodeURIComponent(url.split('#:~:text=')[1])).toContain('استقرار برنامه Django');
  });

  it('leaves url untouched when the chunk has no usable prose', () => {
    expect(citationUrl({ ...corpus[2], text: '```bash\nliara deploy\n```' })).toBe(corpus[2].url);
  });
});

describe('loadIndex', () => {
  it('throws IndexMissingError for a missing directory', () => {
    resetIndexForTests();
    expect(() => loadIndex('nonexistent-dir-xyz')).toThrow(IndexMissingError);
    resetIndexForTests();
  });
});
