// Ingestion: walk the official docs clone's public/llms tree, parse, chunk
// structurally, and recover heading anchors from the sibling MDX sources.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DocChunk } from '@/types';
import { normalizeFa } from '@/lib/text/persian';

const PAAS_PLATFORMS = new Set([
  'angular', 'django', 'docker', 'dotnet', 'flask', 'go', 'laravel',
  'nextjs', 'nodejs', 'php', 'python', 'react', 'static', 'vue',
]);
// products whose 2nd path segment is meaningful platform/service metadata
const PLATFORM_PRODUCTS = new Set(['paas', 'dbaas', 'one-click-apps']);

const MAX_CHUNK_CHARS = 2200;
const TARGET_CHUNK_CHARS = 1600;

export interface IngestStats {
  files: number;
  chunks: number;
  anchored: number;
  skipped: string[];
}

export function ingestDocs(docsDir: string): { chunks: DocChunk[]; stats: IngestStats } {
  const llmsRoot = path.join(docsDir, 'public', 'llms');
  if (!fs.existsSync(llmsRoot)) {
    throw new Error(`llms directory not found: ${llmsRoot} — run \`npm run sync-docs\` first`);
  }
  const files = walk(llmsRoot).filter((f) => f.endsWith('.md'));
  const chunks: DocChunk[] = [];
  const stats: IngestStats = { files: 0, chunks: 0, anchored: 0, skipped: [] };

  for (const file of files) {
    const rel = path.relative(llmsRoot, file).split(path.sep).join('/');
    const parsed = parseLlmsFile(fs.readFileSync(file, 'utf8'));
    if (!parsed) {
      stats.skipped.push(rel);
      continue;
    }
    stats.files++;
    const segs = rel.split('/');
    const product = segs[0];
    const platform =
      PLATFORM_PRODUCTS.has(product) && segs.length > 1 && !segs[1].endsWith('.md')
        ? (product === 'paas' && !PAAS_PLATFORMS.has(segs[1]) ? undefined : segs[1])
        : undefined;

    const anchors = loadAnchors(docsDir, rel);
    const fileChunks = chunkMarkdown(parsed.body, {
      sourcePath: `public/llms/${rel}`,
      url: parsed.url,
      title: parsed.title,
      product,
      platform,
      anchors,
    });
    for (const c of fileChunks) if (c.anchor) stats.anchored++;
    chunks.push(...fileChunks);
  }
  stats.chunks = chunks.length;
  return { chunks, stats };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function parseLlmsFile(raw: string): { url: string; title: string; body: string } | null {
  const text = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    // inline base64 blobs are retrieval noise and blow up chunk/prompt budgets
    // (measured: one 48KB data:image URI in ai/ai-sdk-ui/chatbot.md)
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{200,}/g, '[inline-data-removed]');
  const linkMatch = text.match(/^Original link:\s*(https:\/\/docs\.liara\.ir\S*)/m);
  if (!linkMatch) return null;
  const url = linkMatch[1];
  // strip the boilerplate trailing "## all links" section
  let body = text.slice(linkMatch.index! + linkMatch[0].length);
  body = body.replace(/\n## all links[\s\S]*$/i, '').trim();
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] ?? url).trim();
  return { url, title, body };
}

/** Recover authored heading anchors from the sibling MDX source. */
export function loadAnchors(docsDir: string, relMdPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const mdxPath = path.join(docsDir, 'src', 'pages', relMdPath.replace(/\.md$/, '.mdx'));
  if (!fs.existsSync(mdxPath)) return map;
  const mdx = fs.readFileSync(mdxPath, 'utf8');
  for (const m of mdx.matchAll(/<Section\s+([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const id = attrs.match(/id\s*=\s*["']([^"']+)["']/)?.[1];
    const title = attrs.match(/title\s*=\s*["']([^"']+)["']/)?.[1];
    if (id && title) map.set(normalizeFa(title.trim()), id);
  }
  return map;
}

interface ChunkCtx {
  sourcePath: string;
  url: string;
  title: string;
  product: string;
  platform?: string;
  anchors: Map<string, string>;
}

interface Section {
  heading?: string;
  level: number;
  lines: string[];
}

/**
 * Structural chunking: split at h2/h3 boundaries, keep code fences intact and
 * attached to the prose before them, split oversized sections at paragraph
 * boundaries, keep heading breadcrumbs.
 */
export function chunkMarkdown(body: string, ctx: ChunkCtx): DocChunk[] {
  const lines = body.split('\n');
  const sections: Section[] = [{ level: 1, lines: [] }];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{2,3})\s+(.+)$/);
    if (h) sections.push({ heading: h[2].trim(), level: h[1].length, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const chunks: DocChunk[] = [];
  let currentH2: string | undefined;
  sections.forEach((sec) => {
    if (sec.level === 2) currentH2 = sec.heading;
    const headingPath = [ctx.title];
    if (sec.level === 3 && currentH2) headingPath.push(currentH2);
    if (sec.heading) headingPath.push(sec.heading);

    const text = sec.lines.join('\n').trim();
    if (!text && !sec.heading) return;
    // drop pure link-hub leftovers (empty or only links/images)
    if (!text) return;

    for (const piece of splitLong(text)) {
      const anchor = sec.heading ? ctx.anchors.get(normalizeFa(sec.heading)) : undefined;
      const full = sec.heading ? `## ${sec.heading}\n\n${piece}` : piece;
      chunks.push({
        id: '', // assigned below
        sourcePath: ctx.sourcePath,
        url: ctx.url,
        anchor,
        product: ctx.product,
        platform: ctx.platform,
        title: ctx.title,
        heading: sec.heading,
        headingPath,
        contentType: classify(piece),
        text: full,
        hash: '',
      });
    }
  });

  chunks.forEach((c, i) => {
    c.id = `${ctx.sourcePath}#${i}`;
    c.hash = sha16(`${c.url}|${c.anchor ?? ''}|${c.text}`);
  });
  return chunks;
}

/** Split at paragraph boundaries; never inside a code fence; code block stays with the paragraph before it. */
export function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const blocks: string[] = [];
  const lines = text.split('\n');
  let buf: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    buf.push(line);
    // paragraph boundary: blank line outside a fence
    if (!inFence && line.trim() === '') {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length) blocks.push(buf.join('\n'));

  const out: string[] = [];
  let acc = '';
  for (const b of blocks) {
    const isFenceBlock = /```/.test(b);
    if (acc && acc.length + b.length > TARGET_CHUNK_CHARS && !isFenceBlock) {
      out.push(acc.trim());
      acc = '';
    }
    acc += b + '\n';
    // hard cap safety (same bound as the final slice, so the two agree)
    if (acc.length > MAX_CHUNK_CHARS) {
      out.push(acc.trim());
      acc = '';
    }
  }
  if (acc.trim()) out.push(acc.trim());
  // absolute enforcement: the chunk BODY is <= MAX_CHUNK_CHARS. A single
  // blank-line-free block (huge table, minified content) is sliced as a last
  // resort — at a line/word boundary, never mid-word or mid-token. (The stored
  // chunk later gains a "## heading\n\n" prefix, so the final text can exceed
  // this by the heading length; the body itself is bounded here.)
  return out.filter(Boolean).flatMap(boundarySlice);
}

/** Split an over-cap piece at the last newline (then space) before the cap. */
export function boundarySlice(piece: string): string[] {
  if (piece.length <= MAX_CHUNK_CHARS) return [piece];
  const out: string[] = [];
  let rest = piece;
  while (rest.length > MAX_CHUNK_CHARS) {
    let cut = rest.lastIndexOf('\n', MAX_CHUNK_CHARS);
    if (cut < MAX_CHUNK_CHARS * 0.7) cut = rest.lastIndexOf(' ', MAX_CHUNK_CHARS);
    if (cut < MAX_CHUNK_CHARS * 0.7) cut = MAX_CHUNK_CHARS; // no boundary: hard cut
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

function classify(text: string): DocChunk['contentType'] {
  const fences = (text.match(/```/g) ?? []).length / 2;
  const codeChars = [...text.matchAll(/```[\s\S]*?```/g)].reduce((n, m) => n + m[0].length, 0);
  if (codeChars > text.length * 0.6) return 'code';
  if (fences >= 2 || /^\s*\d+[.)]\s/m.test(text)) return 'procedure';
  if (fences >= 1) return 'mixed';
  return 'text';
}

export function sha16(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}
