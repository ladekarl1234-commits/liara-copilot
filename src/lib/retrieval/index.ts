// Hybrid retrieval over the locally-built index: normalized lexical search
// (MiniSearch/BM25) + optional vector similarity, RRF fusion, metadata
// filters, deterministic rerank boosts, and the evidence-gate confidence.

import fs from 'node:fs';
import path from 'node:path';
import MiniSearch, { type Options as MiniOptions, type SearchResult } from 'minisearch';
import type { DocChunk, RetrievalFilters, RetrievalResult, ScoredChunk } from '@/types';
import { tokenizeFa } from '@/lib/text/persian';
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
  const qs = queries.filter(Boolean).slice(0, 3);
  if (!qs.length) {
    return { chunks: [], confidence: 'low', queries: [], filters, latencyMs: 0 };
  }

  const rrf = new Map<string, number>();
  let bestCoverage = 0;
  let bestScorePerToken = 0;
  let listCount = 0;

  const add = (ids: string[]) => {
    listCount++;
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
      const unique = new Set(qTokens).size;
      // queryTerms = the query-side terms that actually matched (bounded by
      // the query itself, unlike `terms` which lists expanded index terms)
      const matched = new Set(results[0].queryTerms ?? results[0].terms ?? []);
      bestCoverage = Math.max(bestCoverage, Math.min(1, matched.size / unique));
      bestScorePerToken = Math.max(bestScorePerToken, results[0].score / unique);
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

  // evidence selection: relative cutoff + char budget
  const top = fused[0]?.score ?? 0;
  const selected: ScoredChunk[] = [];
  let chars = 0;
  for (const s of fused) {
    if (selected.length >= MAX_EVIDENCE_CHUNKS) break;
    if (s.score < top * 0.35) break;
    if (chars + s.chunk.text.length > MAX_EVIDENCE_CHARS && selected.length >= 2) break;
    selected.push(s);
    chars += s.chunk.text.length;
  }

  // ponytail: heuristic confidence gate (term coverage + BM25 strength +
  // fusion margin), thresholds tuned on evals/cases via
  // `npm run evaluate:retrieval`; upgrade to a learned gate if eval demands it.
  const margin = fused.length > 1 ? fused[0].score / fused[1].score : fused.length ? 2 : 0;
  const confidence = gateConfidence(fused.length, bestCoverage, bestScorePerToken, margin);

  return {
    chunks: selected,
    confidence,
    queries: qs,
    filters,
    latencyMs: Date.now() - t0,
    signals: { coverage: round3(bestCoverage), scorePerToken: round3(bestScorePerToken), margin: round3(margin) },
  };
}

// Thresholds measured on evals/cases (see docs/EVALUATION.md): every
// ambiguous/unsupported/adversarial case must NOT come back 'high'; 'low'
// blocks answering entirely. 'high' additionally routes to the fast model and
// allows FAQ caching, so it is deliberately conservative.
export function gateConfidence(
  resultCount: number,
  coverage: number,
  scorePerToken: number,
  margin: number,
): RetrievalResult['confidence'] {
  if (!resultCount || coverage < 0.25 || scorePerToken < 4) return 'low';
  if (coverage >= 0.6 && scorePerToken >= 25 && margin >= 1.05) return 'high';
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
    if (filters.platform && c.platform && c.platform !== filters.platform) return false;
    if (filters.product && filters.platform === undefined && c.product !== filters.product) return false;
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
