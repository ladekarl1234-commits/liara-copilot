// Hybrid retrieval over the locally-built index: normalized lexical search
// (MiniSearch/BM25) + optional vector similarity, RRF fusion, metadata
// filters, deterministic rerank boosts, and the evidence-gate confidence.

import fs from 'node:fs';
import path from 'node:path';
import MiniSearch, { type Options as MiniOptions, type SearchResult } from 'minisearch';
import type { DocChunk, RetrievalFilters, RetrievalResult, ScoredChunk } from '@/types';
import { tokenizeFa, informativeTokens } from '@/lib/text/persian';
import { config } from '@/lib/config';

export const LEXICAL_VERSION = 2; // bump when miniOptions/tokenization change

export function miniOptions(): MiniOptions {
  return {
    fields: ['title', 'heading', 'text'],
    storeFields: [],
    idField: 'id',
    tokenize: tokenizeFa,
    processTerm: (t: string) => t, // tokenizeFa already normalizes
  };
}

export interface LoadedIndex {
  chunks: DocChunk[];
  byId: Map<string, DocChunk>;
  lexical: MiniSearch;
  vectors: { dims: number; model: string; matrix: Float32Array; ids: string[] } | null;
  meta: { builtAt: string; docsCommit?: string; chunkCount: number; anchorCoverage: number; lexicalVersion?: number };
}

declare global {
  // survives Next.js dev hot reloads
  // eslint-disable-next-line no-var
  var __liaraIndex: LoadedIndex | null | undefined;
}

export function loadIndex(indexDir = config().INDEX_DIR): LoadedIndex {
  if (globalThis.__liaraIndex) return globalThis.__liaraIndex;
  const chunksPath = path.join(indexDir, 'chunks.json');
  const lexicalPath = path.join(indexDir, 'lexical.json');
  const metaPath = path.join(indexDir, 'meta.json');
  if (!fs.existsSync(chunksPath) || !fs.existsSync(lexicalPath)) {
    throw new IndexMissingError(indexDir);
  }
  const chunks: DocChunk[] = JSON.parse(fs.readFileSync(chunksPath, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.lexicalVersion !== LEXICAL_VERSION) throw new IndexMissingError(indexDir, 'index built with an older version — rebuild with `npm run build-index`');
  const lexical = MiniSearch.loadJSON(fs.readFileSync(lexicalPath, 'utf8'), miniOptions());

  let vectors: LoadedIndex['vectors'] = null;
  const embPath = path.join(indexDir, 'embeddings.json');
  if (fs.existsSync(embPath)) {
    const raw = JSON.parse(fs.readFileSync(embPath, 'utf8')) as {
      model: string;
      dims: number;
      vectors: Record<string, number[]>;
    };
    const ids: string[] = [];
    const rows: number[] = [];
    for (const c of chunks) {
      const v = raw.vectors[c.hash];
      if (v) {
        ids.push(c.id);
        rows.push(...v);
      }
    }
    if (ids.length) vectors = { dims: raw.dims, model: raw.model, matrix: Float32Array.from(rows), ids };
  }

  const loaded: LoadedIndex = {
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    lexical,
    vectors,
    meta,
  };
  globalThis.__liaraIndex = loaded;
  return loaded;
}

export function resetIndexForTests() {
  globalThis.__liaraIndex = null;
}

export class IndexMissingError extends Error {
  constructor(dir: string, msg = 'search index not built') {
    super(`${msg} (dir: ${dir})`);
    this.name = 'IndexMissingError';
  }
}

// ---------------- search ----------------

const RRF_K = 60;
const CANDIDATES_PER_QUERY = 40;
const MAX_EVIDENCE_CHUNKS = 8;
const MAX_EVIDENCE_CHARS = 7000;

export interface SearchDeps {
  embedQuery?: (texts: string[]) => Promise<number[][]>; // present when vector search enabled
}

export async function search(
  queries: string[],
  filters: RetrievalFilters,
  deps: SearchDeps = {},
  index?: LoadedIndex,
): Promise<RetrievalResult> {
  const t0 = Date.now();
  const idx = index ?? loadIndex();
  // empty strings from a sloppy model plan must not build an always-true filter
  filters = {
    ...(filters.product?.trim() ? { product: filters.product.trim() } : {}),
    ...(filters.platform?.trim() ? { platform: filters.platform.trim() } : {}),
  };
  const qs = queries.filter(Boolean).slice(0, 3);
  if (!qs.length) {
    return { chunks: [], confidence: 'low', queries: [], filters, latencyMs: 0 };
  }

  const rrf = new Map<string, number>();
  let bestScorePerToken = 0;

  const add = (ids: string[]) => {
    ids.forEach((id, rank) => rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + rank)));
  };

  const filterFn = buildFilter(idx, filters);
  const expanded = expandQueries(qs);
  for (const q of expanded) {
    const qTokens = tokenizeFa(q);
    let results = idx.lexical.search(q, {
      boost: { title: 3, heading: 2 },
      fuzzy: 0.15,
      prefix: true,
      filter: filterFn ?? undefined,
    }) as SearchResult[];
    // fallback: filters can be wrong or the evidence can live cross-product
    if (filterFn && results.length < 5) {
      const unfiltered = idx.lexical.search(q, { boost: { title: 3, heading: 2 }, fuzzy: 0.15, prefix: true });
      results = results.concat(unfiltered.filter((r) => !results.some((x) => x.id === r.id)));
    }
    results = results.slice(0, CANDIDATES_PER_QUERY);
    if (results.length && qTokens.length) {
      bestScorePerToken = Math.max(bestScorePerToken, results[0].score / new Set(qTokens).size);
    }
    add(results.map((r) => String(r.id)));
  }

  // vector lists
  if (idx.vectors && deps.embedQuery) {
    try {
      const embs = await deps.embedQuery(qs);
      for (const e of embs) add(vectorTopK(idx, e, CANDIDATES_PER_QUERY, filters));
    } catch {
      // vector search is an enhancement; lexical results stand alone
    }
  }

  // fuse + deterministic boosts
  const qTokenSet = new Set(qs.flatMap(tokenizeFa));
  const fused: ScoredChunk[] = [];
  for (const [id, base] of rrf) {
    const chunk = idx.byId.get(id);
    if (!chunk) continue;
    let score = base;
    if (filters.platform && chunk.platform === filters.platform) score *= 1.25;
    if (filters.product && chunk.product === filters.product) score *= 1.1;
    // the user named the platform/product in the query itself
    if (chunk.platform && qTokenSet.has(chunk.platform)) score *= 1.2;
    // link-hub pages cite everything and answer nothing
    if (/related-links\.md$/.test(chunk.sourcePath)) score *= 0.6;
    score *= headingBoost(chunk, qs);
    fused.push({ chunk, score });
  }
  fused.sort((a, b) => b.score - a.score);

  // evidence selection: relative cutoff + char budget (enforced from chunk #1)
  const top = fused[0]?.score ?? 0;
  const selected: ScoredChunk[] = [];
  let chars = 0;
  for (const s of fused) {
    if (selected.length >= MAX_EVIDENCE_CHUNKS) break;
    if (s.score < top * 0.35) break;
    if (chars + s.chunk.text.length > MAX_EVIDENCE_CHARS && selected.length >= 1) break;
    selected.push(s);
    chars += s.chunk.text.length;
  }

  // Exact-match coverage of informative query tokens (stopwords removed)
  // against the top selected chunks. Fuzzy/prefix matches deliberately do NOT
  // count — they are what let a cake recipe reach 'medium' before.
  const coverage = exactCoverage(qs, selected.slice(0, 3));

  // ponytail: heuristic confidence gate (informative-token coverage + BM25
  // strength + fusion margin), thresholds tuned on evals/cases via
  // `npm run evaluate:retrieval`; upgrade to a learned gate if eval demands it.
  const margin = fused.length > 1 ? fused[0].score / fused[1].score : fused.length ? 2 : 0;
  const confidence = gateConfidence(fused.length, coverage, bestScorePerToken, margin);

  return {
    chunks: selected,
    confidence,
    queries: qs,
    filters,
    latencyMs: Date.now() - t0,
    signals: { coverage: round3(coverage.ratio), scorePerToken: round3(bestScorePerToken), margin: round3(margin) },
  };
}

/**
 * Exact-match coverage: which informative tokens of any ORIGINAL query
 * (never the synthetic expanded ones) literally appear in the top chunks'
 * title/heading/text. Returns the best per-query ratio + that query's
 * informative token count.
 */
export function exactCoverage(
  queries: string[],
  topChunks: ScoredChunk[],
): { ratio: number; informative: number } {
  if (!topChunks.length) return { ratio: 0, informative: 0 };
  const haystack = new Set(
    topChunks.flatMap((s) => tokenizeFa(`${s.chunk.title} ${s.chunk.heading ?? ''} ${s.chunk.text}`)),
  );
  let best = { ratio: 0, informative: 0 };
  for (const q of queries) {
    const tokens = [...new Set(informativeTokens(q))];
    if (!tokens.length) continue;
    const matched = tokens.filter((t) => haystack.has(t)).length;
    const ratio = matched / tokens.length;
    if (ratio > best.ratio || (ratio === best.ratio && tokens.length > best.informative)) {
      best = { ratio, informative: tokens.length };
    }
  }
  return best;
}

// Thresholds measured on evals/cases (see docs/EVALUATION.md): every
// unsupported/adversarial case must come back 'low' (the orchestrator refuses
// to answer on 'low'); ambiguous cases must not be 'high'. 'high'
// additionally routes to the fast model and allows FAQ caching, so it is
// deliberately conservative: it requires >=70% exact coverage of >=2
// informative tokens. A query whose informative tokens are all absent from
// the top evidence is 'low' regardless of BM25 score.
export function gateConfidence(
  resultCount: number,
  coverage: { ratio: number; informative: number },
  scorePerToken: number,
  margin: number,
): RetrievalResult['confidence'] {
  if (!resultCount) return 'low';
  if (coverage.informative === 0) return 'medium'; // pure-stopword follow-up: planner decides
  if (coverage.ratio < 0.34) return 'low';
  if (coverage.ratio >= 0.7 && coverage.informative >= 2 && scorePerToken >= 25 && margin >= 1.05) return 'high';
  return 'medium';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Bounded EN→FA vocabulary expansion so English questions reach the Persian
 * corpus. Adds ONE extra query containing the translations; originals always
 * searched as-is.
 */
const EN_FA: Record<string, string> = {
  deploy: 'استقرار', deployment: 'استقرار', deploying: 'استقرار',
  environment: 'متغیر محیطی', env: 'متغیر محیطی', variable: 'متغیر', variables: 'متغیرها',
  domain: 'دامنه', subdomain: 'زیردامنه', database: 'دیتابیس', install: 'نصب',
  error: 'خطا', log: 'لاگ', logs: 'لاگ', disk: 'دیسک', disks: 'دیسک',
  build: 'ساخت', certificate: 'گواهی', ssl: 'ssl گواهی', upload: 'آپلود',
  connect: 'اتصال', connection: 'اتصال', backup: 'پشتیبان‌گیری', restore: 'بازیابی',
  price: 'هزینه', cost: 'هزینه', plan: 'پلن', email: 'ایمیل', settings: 'تنظیمات',
  create: 'ساخت ایجاد', delete: 'حذف', scale: 'مقیاس', restart: 'ری‌استارت',
};

export function expandQueries(qs: string[]): string[] {
  const out = [...qs];
  for (const q of qs) {
    const extras: string[] = [];
    for (const w of q.toLowerCase().match(/[a-z][a-z.-]*/g) ?? []) {
      const t = EN_FA[w];
      if (t && !extras.includes(t)) extras.push(t);
    }
    if (extras.length >= 1) out.push(`${extras.join(' ')} ${keepTechTerms(q)}`.trim());
  }
  return out.slice(0, 5);
}

const EN_STOP = new Set([
  'how', 'do', 'does', 'the', 'my', 'your', 'on', 'in', 'a', 'an', 'to', 'for',
  'with', 'can', 'i', 'is', 'are', 'it', 'and', 'of', 'what', 'why', 'when',
  'app', 'application', 'use', 'using', 'not', 'work', 'working', 'get', 'set',
]);

/** keep identifiers like Next.js, DATABASE_URL from the original query */
function keepTechTerms(q: string): string {
  return (q.match(/[A-Za-z][A-Za-z0-9._-]{2,}/g) ?? [])
    .filter((w) => !(w.toLowerCase() in EN_FA) && !EN_STOP.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ');
}

function buildFilter(idx: LoadedIndex, filters: RetrievalFilters) {
  if (!filters.product && !filters.platform) return null;
  return (result: SearchResult) => {
    const c = idx.byId.get(String(result.id));
    if (!c) return false;
    // both filters apply independently; a chunk with no platform of its own
    // (e.g. general PaaS pages) passes a platform filter
    if (filters.platform && c.platform && c.platform !== filters.platform) return false;
    if (filters.product && c.product !== filters.product) return false;
    return true;
  };
}

function headingBoost(chunk: DocChunk, queries: string[]): number {
  const qTokens = new Set(queries.flatMap(tokenizeFa));
  if (!qTokens.size) return 1;
  const hTokens = tokenizeFa(`${chunk.title} ${chunk.heading ?? ''}`);
  const overlap = hTokens.filter((t) => qTokens.has(t)).length;
  return 1 + Math.min(0.2, overlap * 0.05);
}

function vectorTopK(idx: LoadedIndex, q: number[], k: number, filters: RetrievalFilters): string[] {
  const v = idx.vectors!;
  const dims = v.dims;
  // normalize query
  let norm = 0;
  for (const x of q) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  const scores: { id: string; s: number }[] = [];
  for (let i = 0; i < v.ids.length; i++) {
    let dot = 0;
    const off = i * dims;
    for (let d = 0; d < dims; d++) dot += v.matrix[off + d] * q[d];
    scores.push({ id: v.ids[i], s: dot / norm }); // matrix rows pre-normalized at build
  }
  scores.sort((a, b) => b.s - a.s);
  const out: string[] = [];
  for (const { id } of scores) {
    if (out.length >= k) break;
    const c = idx.byId.get(id);
    if (!c) continue;
    if (filters.platform && c.platform && c.platform !== filters.platform) continue;
    out.push(id);
  }
  return out;
}

// ---------------- citation helper ----------------

export function citationUrl(chunk: DocChunk): string {
  return chunk.anchor ? `${chunk.url.replace(/\/?$/, '/')}#${chunk.anchor}` : chunk.url;
}
