// Hybrid retrieval over the locally-built index: normalized lexical search
// (MiniSearch/BM25) + optional vector similarity, RRF fusion, metadata
// filters, deterministic rerank boosts, and the evidence-gate confidence.

import fs from 'node:fs';
import path from 'node:path';
import MiniSearch, { type Options as MiniOptions, type SearchResult } from 'minisearch';
import type { DocChunk, RetrievalFilters, RetrievalResult, ScoredChunk } from '@/types';
import { tokenizeFa, informativeTokens, normalizeFa } from '@/lib/text/persian';

const KNOWN_PLATFORMS = new Set([
  'nextjs', 'nodejs', 'react', 'vue', 'angular', 'django', 'flask', 'laravel',
  'php', 'python', 'dotnet', 'go', 'docker', 'static',
]);

// Niche products and the natural-language terms that legitimately invoke them.
// A query lacking any of these should not surface the product's pages — a plain
// "deploy my project" must not resolve to an AI FAQ or a package-mirror page.
// Terms are written naturally (incl. ZWNJ) and run through the SAME tokenizer +
// synonym fold as the query, so "وی‌پی‌اس"/"نگهداری" match after splitting
// (RETR-001/002). Broadened with paraphrase terms for need-description queries.
const NICHE_PRODUCT_TERMS: Record<string, string[]> = {
  ai: ['هوش مصنوعی', 'مدل زبانی', 'llm', 'چت‌بات', 'openai', 'embedding', 'پرامپت', 'gpt', 'ai'],
  mirrors: ['میرور', 'mirror', 'npm', 'pip', 'apt', 'مخزن', 'mirrors'],
  'email-server': ['ایمیل', 'email', 'smtp', 'imap', 'pop3', 'mail', 'ایمیل‌سرور'],
  iaas: ['سرور مجازی', 'وی‌پی‌اس', 'vps', 'iaas', 'ubuntu', 'debian', 'ماشین مجازی'],
  'object-storage': ['باکت', 'bucket', 'object storage', 's3', 'آبجکت', 'ذخیره', 'نگهداری فایل', 'آپلود فایل', 'فضای ذخیره'],
  'dns-management-system': ['dns', 'رکورد', 'نیم‌سرور', 'nameserver', 'دی‌ان‌اس'],
};
// pre-tokenize each product's trigger terms into the same token space as queries
const NICHE_TRIGGER_TOKENS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(NICHE_PRODUCT_TERMS).map(([p, terms]) => [p, new Set(terms.flatMap((t) => tokenizeFa(t)))]),
);
import { config } from '@/lib/config';

export const LEXICAL_VERSION = 3; // bump when miniOptions/tokenization change

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
  priorTurns?: number; // conversation depth — relaxes the all-stopword gate for follow-ups
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
  const platformNamed = Boolean(filters.platform) || [...qTokenSet].some((t) => KNOWN_PLATFORMS.has(t));
  // Niche products should not top a GENERAL query (a bare "deploy my project"
  // must not resolve to an /ai/faq page). Down-rank a niche product's chunks
  // unless the query references that product or the filter selects it.
  const nicheReferenced = new Set<string>();
  for (const [prod, triggerTokens] of Object.entries(NICHE_TRIGGER_TOKENS)) {
    if (filters.product === prod || [...triggerTokens].some((t) => qTokenSet.has(t))) nicheReferenced.add(prod);
  }
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
    // for a platform-less query, a framework-specific how-to is usually the
    // wrong first hit — the general reference/overview page is canonical
    if (!platformNamed && chunk.platform) score *= 0.85;
    // niche product not referenced by the query → likely cross-product noise.
    // A gentle penalty (not a burial) so a paraphrased need still surfaces the
    // right product if lexical relevance is strong (RETR-001).
    if (chunk.product in NICHE_TRIGGER_TOKENS && !nicheReferenced.has(chunk.product)) score *= 0.72;
    // `/about` and `/overview/about` hub pages are broad; a concrete
    // quick-start / how-to / details page answers better
    if (/\/about\.md$/.test(chunk.sourcePath)) score *= 0.85;
    if (/quick-start|quick-setup|getting-started|\/details\/|\/references\//.test(chunk.sourcePath)) score *= 1.08;
    score *= headingBoost(chunk, qs);
    fused.push({ chunk, score });
  }
  fused.sort((a, b) => b.score - a.score);

  // evidence selection: relative cutoff + char budget (enforced from chunk #1),
  // and DEDUP near-identical chunk bodies. Boilerplate sections (e.g. the
  // byte-identical "## اتصال به مدل" copied across every AI-provider page) were
  // filling all 8 evidence slots with 2 unique texts.
  const top = fused[0]?.score ?? 0;
  const selected: ScoredChunk[] = [];
  const seenBodies = new Set<string>();
  let chars = 0;
  for (const s of fused) {
    if (selected.length >= MAX_EVIDENCE_CHUNKS) break;
    if (s.score < top * 0.35) break;
    // dedup on the FULL normalized body (not a 400-char prefix, which would
    // collide two distinct chunks that merely share a templated header and drop
    // the one that actually answers the query) — CORR-R3-04
    const bodyKey = normalizeFa(s.chunk.text).replace(/\s+/g, ' ').trim();
    if (seenBodies.has(bodyKey)) continue; // duplicate/near-identical body
    if (chars + s.chunk.text.length > MAX_EVIDENCE_CHARS && selected.length >= 1) break;
    seenBodies.add(bodyKey);
    selected.push(s);
    chars += s.chunk.text.length;
  }

  // Exact-match coverage of informative query tokens (stopwords removed)
  // against the top selected chunks. Fuzzy/prefix matches deliberately do NOT
  // count — they are what let a cake recipe reach 'medium' before.
  const coverage = exactCoverage(qs, selected.slice(0, 3));

  // `high` also requires the TOP chunk's title/heading (not just its body) to
  // carry an informative query token. Corpus-ubiquitous body tokens ("install",
  // "cli", "دیتابیس") otherwise saturate coverage on the wrong page — e.g.
  // "install the CLI" reached high on liara.json rather than /references/cli/install.
  const topTitleMatch = selected.length ? headingCarriesQueryToken(selected[0].chunk, qs) : false;

  // ponytail: heuristic confidence gate (informative-token coverage + BM25
  // strength + fusion margin + title match), thresholds tuned on evals/cases via
  // `npm run evaluate:retrieval`; upgrade to a learned gate if eval demands it.
  const margin = fused.length > 1 ? fused[0].score / fused[1].score : fused.length ? 2 : 0;
  const confidence = gateConfidence(fused.length, coverage, bestScorePerToken, margin, deps.priorTurns ?? 0, topTitleMatch);

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
export interface Coverage {
  ratio: number; // matched / informative
  informative: number; // count of informative (non-stopword) query tokens
  matched: number; // absolute count that appear verbatim in the top chunks
}

export function exactCoverage(queries: string[], topChunks: ScoredChunk[]): Coverage {
  if (!topChunks.length) return { ratio: 0, informative: 0, matched: 0 };
  const haystack = new Set(
    topChunks.flatMap((s) => tokenizeFa(`${s.chunk.title} ${s.chunk.heading ?? ''} ${s.chunk.text}`)),
  );
  let best: Coverage = { ratio: 0, informative: 0, matched: 0 };
  for (const q of queries) {
    const tokens = [...new Set(informativeTokens(q))];
    if (!tokens.length) continue;
    const matched = tokens.filter((t) => haystack.has(t)).length;
    const ratio = matched / tokens.length;
    if (ratio > best.ratio || (ratio === best.ratio && tokens.length > best.informative)) {
      best = { ratio, informative: tokens.length, matched };
    }
  }
  return best;
}

// The gate is ONE of three defenses (gate → grounded answer model → claim
// verification), not a topic classifier. A lexical index over 3,663 chunks
// always returns *something*, and a query sharing ONE real Liara word with the
// corpus ("cake recipe" matches nothing meaningful; "چطور دامنه وصل کنم"
// matches "دامنه") is lexically indistinguishable from a legit one-concept
// query — the two produce identical coverage signals (verified). Trying to
// separate them at the gate wrongly refuses real questions, so that class is
// deliberately left at 'medium', where the answer model (instructed to answer
// only from evidence and otherwise say "not in the docs") is the real defense.
// What the gate CAN do without false positives:
//   - matched === 0 (no informative query token appears in the evidence at
//     all): 'low' on a fresh turn — catches gibberish, all-stopword input,
//     and genuinely off-vocabulary questions. 'medium' mid-conversation, where
//     the planner's context-enriched queries carry the intent even when the
//     raw message is all stopwords ("قدم بعدی چیست؟").
//   - very low coverage (< 0.34) even with a match: 'low'.
//   - 'high' (fast model + FAQ-cacheable) stays conservative: >=70% coverage of
//     >=2 informative tokens, strong BM25 density, and a real margin.
export function gateConfidence(
  resultCount: number,
  coverage: Coverage,
  scorePerToken: number,
  margin: number,
  priorTurns = 0,
  topTitleMatch = true,
): RetrievalResult['confidence'] {
  if (!resultCount) return 'low';
  // Nothing matched. Relax to 'medium' ONLY for a pure-stopword follow-up
  // ("قدم بعدی چیست؟") where the raw message carries no informative token but
  // the conversation does. Gibberish with informative tokens that simply don't
  // appear in the corpus ("asdkjhasd qwe") stays 'low' at EVERY depth —
  // otherwise turn 1 onward would answer it.
  if (coverage.matched === 0) return coverage.informative === 0 && priorTurns > 0 ? 'medium' : 'low';
  if (coverage.ratio < 0.34) return 'low';
  // Weak-and-off-target: the top page's TITLE shares no query token and coverage
  // is thin → retrieval likely missed the answering page, so an answer would be
  // grounded-but-off-target. Refuse instead (CORR-R3-01).
  if (!topTitleMatch && coverage.ratio < 0.5) return 'low';
  if (
    topTitleMatch &&
    coverage.ratio >= 0.7 &&
    coverage.informative >= 2 &&
    scorePerToken >= 25 &&
    margin >= 1.05
  )
    return 'high';
  return 'medium';
}

// Tokens so common across the corpus that a title carrying one tells us
// nothing about whether the page ANSWERS the query (every /references/cli/*
// page has "cli" in a heading). Excluded from the high-gate title check.
const GENERIC_TITLE_TOKENS = new Set(['cli', 'install', 'setup', 'app', 'liara', 'json', 'file', 'فایل', 'ساخت']);

/** True when the chunk's title/heading shares a NON-generic informative token with any query. */
export function headingCarriesQueryToken(chunk: DocChunk, queries: string[]): boolean {
  const head = new Set(tokenizeFa(`${chunk.title} ${chunk.heading ?? ''}`));
  return queries.some((q) =>
    informativeTokens(q).some((t) => !GENERIC_TITLE_TOKENS.has(t) && head.has(t)),
  );
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
