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
import { DEFAULT_EMBEDDINGS_MODEL } from '@/lib/ai/local-embeddings';
import { localModelId } from '@/lib/retrieval/embed';

export const LEXICAL_VERSION = 4; // bump when miniOptions/tokenization change

export function miniOptions(): MiniOptions {
  return {
    // MEASURED, not assumed: adding the `headingPath` breadcrumb as a fourth
    // field (EP-RET-11's recommendation, boost 2.5) cost 3 cases — hit@5
    // 0.813→0.750, MRR 0.592→0.535 — because the h1 title is then counted twice
    // for every chunk of a page, flattening the ranking within it. Not indexed.
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
  /** lazily built by `corpusIdf()`; never set by the loader */
  idf?: CorpusIdf;
}

declare global {
  // survives Next.js dev hot reloads
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
  // Load vectors ONLY when this deployment is configured to embed queries with
  // the SAME model that produced them. Two reasons: (1) comparing a query
  // vector to passages from a different model silently compares incompatible
  // spaces and returns confident nonsense; (2) with embeddings off, parsing the
  // file costs ~30MB of JSON and a 5.7MB Float32Array on every cold start for
  // something no query will ever touch.
  // read straight from the environment, NOT config(): loading the index must
  // not materialize (and thereby freeze) the config singleton, which callers
  // legitimately set up after choosing an index directory
  // `??` (not `||`) so an explicit empty string still means "lexical-only";
  // the default itself is shared with config()'s zod schema so the two readers
  // cannot disagree about whether this deployment is hybrid.
  const embedModel = process.env.AI_EMBEDDINGS_MODEL?.trim() ?? DEFAULT_EMBEDDINGS_MODEL;
  if (embedModel && fs.existsSync(embPath)) {
    const raw = JSON.parse(fs.readFileSync(embPath, 'utf8')) as {
      model: string;
      dims: number;
      vectors: Record<string, number[]>;
    };
    // Compare RESOLVED model ids, not raw strings: `local:` and
    // `local:Xenova/multilingual-e5-small` are the same model (the bare prefix
    // means "the default local one"), and the second spelling is the one ADR
    // 0004 prints. Comparing raw strings made an identical configuration throw
    // IndexMissingError from loadIndex(), i.e. 500 every chat request.
    const same = (a: string) => localModelId(a) ?? a;
    if (same(raw.model) !== same(embedModel)) {
      throw new IndexMissingError(
        indexDir,
        `embeddings.json was built with "${raw.model}" but AI_EMBEDDINGS_MODEL is "${embedModel}" — rebuild with \`npm run build-index\``,
      );
    }
    const present = chunks.filter((c) => raw.vectors[c.hash]);
    if (present.length) {
      // written straight into the typed array: an intermediate number[] of
      // 1.4M elements costs ~11MB and a full copy for nothing
      const matrix = new Float32Array(present.length * raw.dims);
      present.forEach((c, i) => matrix.set(raw.vectors[c.hash], i * raw.dims));
      vectors = { dims: raw.dims, model: raw.model, matrix, ids: present.map((c) => c.id) };
    }
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

const FIELD_BOOSTS = { title: 3, heading: 2 };

// Lowered from 60 (EP-RET-01, measured via `npm run evaluate:retrieval`, both
// modes). At 60, RRF's rank-sum let a handful of near-duplicate boilerplate
// pages that merely happened to appear in BOTH the lexical and vector lists
// (e.g. every platform's own `how-tos/create-app` template, all semantically
// "about creating an app") outweigh a single strong, decisive rank-1 hit from
// one list alone — enabling hybrid search dislodged the true answer page from
// evidence for 3 cases it used to nail lexically (e.g. default-subdomain-suffix
// fell from rank 1 to rank 4), driving false-refusal 6.3%->12.5% and failing
// CI's ceiling. A small K weights top ranks far more steeply relative to the
// tail, so a decisive #1 in one list beats mediocre-but-doubled agreement
// across two — which is what "the vector and lexical signals corroborate each
// other" should actually mean.
//
// Not pushed lower than 10: K<=8 also amplifies the rerank multipliers'
// blast radius, because a fixed multiplicative penalty (e.g. the niche-product
// ×0.72 in the loop below) bites proportionally less once RRF's absolute score
// gap between adjacent ranks widens. At K=8 the niche `mirrors/npm` page's
// undisputed rank-1 lexical hit survived its own down-rank penalty and beat
// the general PaaS deploy page for a plain "deploy my project" query
// (tests/integration-realindex.test.ts) — a regression the eval's 48 cases
// don't cover but this repo's own real-index test does. Re-measured at
// k in {8,10,12,15,20,30}: that test fails at k<=8 and passes at k>=10, so 10
// is the lowest value clear of it. Net effect (both modes improved, not just
// hybrid): lexical hit@5 81.3%->83.3%, false-refusal 6.3%->4.2%; hybrid hit@5
// 83.3%->85.4%, MRR 0.623->0.719, false-refusal 12.5%->6.3% (== lexical
// baseline, same 3 pre-existing hard cases, zero new hybrid-specific misses).
// one-shot guard so a broken embedder does not log per query
let warnedVectorFailure = false;

// Boundary note (review follow-up): K=10 is the LOWEST value clear of the
// real-index mirrors regression, i.e. one step from the cliff at K<=8. K=12 was
// measured as an alternative for drift margin and is WORSE on ranking quality
// (MRR 0.698 vs 0.719; hit@5 and evidence-recall identical), so K=10 is kept
// deliberately, not by accident. The eval warns when the index docsCommit moves,
// which is the signal to re-sweep rather than a reason to pre-emptively detune.
const RRF_K = 10;
const CANDIDATES_PER_QUERY = 40;
const MAX_EVIDENCE_CHUNKS = 8;
const MAX_EVIDENCE_CHARS = 7000;

export interface SearchDeps {
  embedQuery?: (texts: string[]) => Promise<number[][]>; // present when vector search enabled
  priorTurns?: number; // conversation depth — relaxes the all-stopword gate for follow-ups
  /** benchmark only: gate which retrieval stages run. Omitted/undefined =
   * production behavior (lexical on; vector on when embeddings present; rerank
   * boosts on). Used by scripts/benchmark-retrieval-modes.ts to isolate modes. */
  mode?: { lexical?: boolean; vector?: boolean; rerank?: boolean };
  /** benchmark only: return the full fused ranking (skip evidence selection,
   * dedup, and the confidence gate) so Recall@k can be scored on the raw list. */
  rankOnly?: boolean;
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
  if (deps.mode?.lexical !== false) for (const q of expanded) {
    const qTokens = tokenizeFa(q);
    let results = idx.lexical.search(q, {
      boost: FIELD_BOOSTS,
      fuzzy: 0.15,
      prefix: true,
      filter: filterFn ?? undefined,
    }) as SearchResult[];
    // fallback: filters can be wrong or the evidence can live cross-product
    if (filterFn && results.length < 5) {
      const unfiltered = idx.lexical.search(q, { boost: FIELD_BOOSTS, fuzzy: 0.15, prefix: true });
      results = results.concat(unfiltered.filter((r) => !results.some((x) => x.id === r.id)));
    }
    results = results.slice(0, CANDIDATES_PER_QUERY);
    if (results.length && qTokens.length) {
      bestScorePerToken = Math.max(bestScorePerToken, results[0].score / new Set(qTokens).size);
    }
    add(results.map((r) => String(r.id)));
  }

  // vector lists
  let vectorUsed = false;
  if (deps.mode?.vector !== false && idx.vectors && deps.embedQuery) {
    try {
      const embs = await deps.embedQuery(qs);
      for (const e of embs) add(vectorTopK(idx, e, CANDIDATES_PER_QUERY, filters));
      vectorUsed = true;
    } catch (e) {
      // Vector search is an enhancement — lexical results stand alone — but now
      // that hybrid is the DEFAULT, a silent fall-through is a 16-point hit@1
      // regression with nothing in the logs to explain it (no HF-hub egress, no
      // writable model cache, OOM...). Warn ONCE per process: the failure is
      // almost always environmental and identical for every subsequent query.
      if (!warnedVectorFailure) {
        warnedVectorFailure = true;
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'vector_search_failed',
            msg: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
            effect: 'retrieval degraded to lexical-only for this process',
          }),
        );
      }
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
  const rerank = deps.mode?.rerank !== false;
  const fused: ScoredChunk[] = [];
  for (const [id, base] of rrf) {
    const chunk = idx.byId.get(id);
    if (!chunk) continue;
    let score = base;
    if (rerank) {
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
      // …but never for a FOREIGN product: the boost used to pull
      // `dbaas/postgresql/quick-setup` into the evidence for a DNS question
      // (EP-RET-05). Ablation on the eval set: deleting the boost outright costs
      // a case (hit@5 0.813→0.792), scoping it to the selected product does not.
      if (
        /quick-start|quick-setup|getting-started|\/details\/|\/references\//.test(chunk.sourcePath) &&
        (!filters.product || chunk.product === filters.product)
      )
        score *= 1.08;
      score *= headingBoost(chunk, qs);
    }
    fused.push({ chunk, score });
  }
  fused.sort((a, b) => b.score - a.score);

  // benchmark: raw ranking (no evidence selection / gate) for Recall@k scoring
  if (deps.rankOnly) {
    return { chunks: fused.slice(0, 50), confidence: 'low', queries: qs, filters, latencyMs: Date.now() - t0 };
  }

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
  const coverage = exactCoverage(qs, selected.slice(0, 3), corpusIdf(idx));

  // ponytail: heuristic confidence gate (informative-token coverage + BM25
  // strength + fusion margin + title match), thresholds tuned on evals/cases via
  // `npm run evaluate:retrieval`; upgrade to a learned gate if eval demands it.
  const margin = fused.length > 1 ? fused[0].score / fused[1].score : fused.length ? 2 : 0;

  // `high` also requires the TOP chunk's title/heading (not just its body) to
  // carry an informative query token. Corpus-ubiquitous body tokens ("install",
  // "cli", "دیتابیس") otherwise saturate coverage on the wrong page — e.g.
  // "install the CLI" reached high on liara.json rather than /references/cli/install.
  //
  // When the top two chunks are within RRF noise of each other (margin < the
  // same 1.05 bar the 'high' tier itself uses as "a real separation" — so this
  // never leaks into 'high', which independently requires margin >= 1.05),
  // which one fusion sorted into index 0 is arbitrary. Hybrid fusion adds a
  // SECOND ranked list, so a chunk that used to be the sole, decisive lexical
  // #1 can be nudged to #2 by a coincidental vector-side corroboration of an
  // unrelated neighbor (EP-RET-01: "دو تا برنامه... وصلشون کنم" — the
  // private-network page was lexical rank 1 alone, fused rank 2 at margin
  // 1.004 behind an unrelated framework page). Checking only index 0 in that
  // band measures fusion's tie-break, not evidence quality, so extend the
  // check to the runner-up when the two are effectively tied.
  const nearTie = selected.length > 1 && margin < 1.05;
  const topTitleMatch = selected.length
    ? headingCarriesQueryToken(selected[0].chunk, qs) ||
      (nearTie && headingCarriesQueryToken(selected[1].chunk, qs))
    : false;

  // evidence convergence: do the two strongest chunks agree on a product?
  const converged = selected.length < 2 || selected[0].chunk.product === selected[1].chunk.product;
  const confidence = gateConfidence(fused.length, coverage, bestScorePerToken, margin, deps.priorTurns ?? 0, topTitleMatch, converged);

  return {
    chunks: selected,
    confidence,
    queries: qs,
    filters,
    latencyMs: Date.now() - t0,
    vectorUsed,
    signals: { coverage: round3(coverage.ratio), scorePerToken: round3(bestScorePerToken), margin: round3(margin) },
  };
}

/**
 * Corpus document frequency → IDF, over the SAME token space queries use.
 * Built once per loaded index (~320ms / 3.7k chunks) and memoized on it.
 *
 * The gate needs this to tell a rare, page-identifying term («خصوصی», df 161)
 * from a corpus-ubiquitous one («اتصال», df 1134): counting them equally is
 * what made coverage a measure of query verbosity rather than groundedness.
 */
export interface CorpusIdf {
  weight: Map<string, number>;
  /** weight for a token absent from the corpus: the maximum, log(N) */
  oov: number;
}

export function corpusIdf(idx: LoadedIndex): CorpusIdf {
  if (idx.idf) return idx.idf;
  const n = idx.chunks.length || 1;
  const df = new Map<string, number>();
  for (const c of idx.chunks) {
    for (const t of new Set(tokenizeFa(`${c.title} ${c.heading ?? ''} ${c.text}`))) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const weight = new Map<string, number>();
  for (const [t, d] of df) weight.set(t, Math.log(n / d));
  idx.idf = { weight, oov: Math.log(n) };
  return idx.idf;
}

/**
 * Exact-match coverage: which informative tokens of any ORIGINAL query
 * (never the synthetic expanded ones) literally appear in the top chunks'
 * title/heading/text. Returns the best per-query ratio + that query's
 * informative token count.
 *
 * `ratio` is IDF-WEIGHTED when an idf map is supplied: a query is "covered"
 * when the evidence carries its rare, discriminating terms, not when it carries
 * a majority of its words. A token absent from the whole corpus keeps the
 * maximum weight (log N) — it is real evidence the docs do not cover the
 * question, and zeroing it would let genuinely unsupported questions ("gpu",
 * "kubernetes") sail through the gate.
 */
export interface Coverage {
  ratio: number; // IDF-weighted matched / informative (unweighted when no idf map)
  informative: number; // count of informative (non-stopword) query tokens
  matched: number; // absolute count that appear verbatim in the top chunks
  /** summed IDF of the matched tokens — absolute evidence mass, not a ratio.
   * Absent when `exactCoverage` was called without an idf map. */
  matchedWeight?: number;
}

export function exactCoverage(
  queries: string[],
  topChunks: ScoredChunk[],
  idf?: CorpusIdf,
): Coverage {
  if (!topChunks.length) return { ratio: 0, informative: 0, matched: 0 };
  const haystack = new Set(
    topChunks.flatMap((s) => tokenizeFa(`${s.chunk.title} ${s.chunk.heading ?? ''} ${s.chunk.text}`)),
  );
  const weight = (t: string) => (idf ? (idf.weight.get(t) ?? idf.oov) : 1);
  let best: Coverage = { ratio: 0, informative: 0, matched: 0 };
  for (const q of queries) {
    const tokens = [...new Set(informativeTokens(q))];
    if (!tokens.length) continue;
    const hits = tokens.filter((t) => haystack.has(t));
    let total = 0;
    for (const t of tokens) total += weight(t);
    let hit = 0;
    for (const t of hits) hit += weight(t);
    // all-zero weights (every token appears in every chunk) → fall back to counts
    const ratio = total > 0 ? hit / total : hits.length / tokens.length;
    if (ratio > best.ratio || (ratio === best.ratio && tokens.length > best.informative)) {
      best = {
        ratio,
        informative: tokens.length,
        matched: hits.length,
        ...(idf ? { matchedWeight: hit } : {}),
      };
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
//   - very low coverage (< 0.34) even with a match: 'low' — UNLESS the evidence
//     is strong in absolute terms (see STRONG_* below).
//   - 'high' (fast model + FAQ-cacheable) stays conservative: >=70% coverage of
//     >=2 informative tokens, strong BM25 density, a real margin, and CONVERGED
//     evidence — the top two chunks must name the same product. An ambiguous
//     question («چطور به دیتابیس وصل بشم؟») covers its tokens perfectly while
//     the evidence splits across dbaas and a PaaS framework page: that split is
//     the ambiguity, and it must not buy the cheap fast-model route or a FAQ
//     cache entry.

// Absolute-evidence escape (EP-ANS-01). Coverage is a ratio over the QUESTION's
// vocabulary, so it measures how verbosely the user typed, not how well the
// docs answer them: «چطور برنامه و دیتابیسم رو توی یک شبکه خصوصی بذارم که از
// بیرون قابل دسترسی نباشن؟» retrieves the private-network page at ranks 1-3 and
// still scored 0.33. When the evidence is strong on its own terms — the top
// page's TITLE carries a non-generic query term, several query terms appear
// verbatim, and BM25 density is high — the question is answerable regardless of
// how many extra words came with it.
//
// "Strong" is measured in IDF MASS, not token count: «دستور پخت کیک شکلاتی»
// matches «دستور» and «مرحله» — two tokens, but corpus-generic ones worth 4.7
// nats together — while the private-network question matches 11.4 nats of rare
// vocabulary. Counting tokens would let the cake recipe through; counting mass
// does not. Everything the escape rescues still lands at 'medium', never 'high'.
const STRONG_MATCHED_TOKENS = 2;
const STRONG_MATCHED_IDF = 6; // nats; measured separation is 4.7 (off-topic) vs 7.2+ (answerable)
const STRONG_SCORE_PER_TOKEN = 40; // ponytail: absolute BM25 density, corpus-scale-dependent like the 'high' threshold; make both percentile-based if the corpus grows materially (EP-RET-12)

export function gateConfidence(
  resultCount: number,
  coverage: Coverage,
  scorePerToken: number,
  margin: number,
  priorTurns = 0,
  topTitleMatch = true,
  converged = true,
): RetrievalResult['confidence'] {
  if (!resultCount) return 'low';
  const strongEvidence =
    topTitleMatch &&
    coverage.matched >= STRONG_MATCHED_TOKENS &&
    (coverage.matchedWeight ?? 0) >= STRONG_MATCHED_IDF &&
    scorePerToken >= STRONG_SCORE_PER_TOKEN;
  // Nothing matched. Relax to 'medium' ONLY for a pure-stopword follow-up
  // ("قدم بعدی چیست؟") where the raw message carries no informative token but
  // the conversation does. Gibberish with informative tokens that simply don't
  // appear in the corpus ("asdkjhasd qwe") stays 'low' at EVERY depth —
  // otherwise turn 1 onward would answer it.
  if (coverage.matched === 0) return coverage.informative === 0 && priorTurns > 0 ? 'medium' : 'low';
  if (coverage.ratio < 0.34 && !strongEvidence) return 'low';
  // Weak-and-off-target: the top page's TITLE shares no query token and coverage
  // is thin → retrieval likely missed the answering page, so an answer would be
  // grounded-but-off-target. Refuse instead (CORR-R3-01).
  if (!topTitleMatch && coverage.ratio < 0.5) return 'low';
  if (
    topTitleMatch &&
    converged &&
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

/**
 * Sub-tier inside 'medium': the evidence is answerable-shaped but NOT clearly
 * on target — the top page's title shares no query term, or barely half the
 * query's weight is covered. 'medium' is the overwhelming operating mode
 * (46/61 eval cases) and the orchestrator only refuses on 'low', so this is the
 * class where a confident, cited answer gets generated from a page that does
 * not contain the answer (EP-ANS-04).
 *
 * Computable entirely from a RetrievalResult, so any caller can hedge on it:
 * the orchestrator should append a one-line directive to the answer system
 * prompt telling the model to open by naming the page it found and warning it
 * may not be the right one. Free, deterministic, self-labelling.
 *
 * The test is JUST the title match, tuned for PRECISION on the 41 'medium' eval
 * cases (7 of them off-target). Measured flagged / caught-off-target / false
 * alarms:
 *   !titleMatch                    5 / 2 of 7 / 3   ← chosen
 *   !titleMatch || coverage < 0.4  15 / 4 of 7 / 11
 *   !titleMatch || coverage < 0.5  20 / 5 of 7 / 15  (EP-ANS-04's proposal)
 * The last hedges half of ALL answers, which costs more UX than the 3 extra
 * catches buy. Widen it only alongside a larger eval set.
 */
export function evidenceIsWeak(r: RetrievalResult): boolean {
  if (r.confidence !== 'medium' || !r.chunks.length) return false;
  return !headingCarriesQueryToken(r.chunks[0].chunk, r.queries);
}

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

/**
 * The ONE metadata predicate. Both retrieval halves route through it — the
 * lexical half used to apply product+platform while the vector half applied
 * platform only, so enabling vectors would have re-admitted exactly the
 * cross-product candidates the filter exists to exclude (EP-RET-08).
 */
export function chunkFilter(filters: RetrievalFilters): ((c: DocChunk) => boolean) | null {
  if (!filters.product && !filters.platform) return null;
  return (c: DocChunk) => {
    // both filters apply independently; a chunk with no platform of its own
    // (e.g. general PaaS pages) passes a platform filter
    if (filters.platform && c.platform && c.platform !== filters.platform) return false;
    if (filters.product && c.product !== filters.product) return false;
    return true;
  };
}

function buildFilter(idx: LoadedIndex, filters: RetrievalFilters) {
  const pred = chunkFilter(filters);
  if (!pred) return null;
  return (result: SearchResult) => {
    const c = idx.byId.get(String(result.id));
    return c ? pred(c) : false;
  };
}

function headingBoost(chunk: DocChunk, queries: string[]): number {
  const qTokens = new Set(queries.flatMap(tokenizeFa));
  if (!qTokens.size) return 1;
  const hTokens = tokenizeFa(`${chunk.title} ${chunk.heading ?? ''}`);
  const overlap = hTokens.filter((t) => qTokens.has(t)).length;
  return 1 + Math.min(0.2, overlap * 0.05);
}

/**
 * Top-k by cosine over the chunk matrix.
 *
 * Filtered BEFORE scoring and selected with a bounded insertion instead of an
 * array of n objects plus a full sort: same result, O(n·d + n·log k), zero
 * per-row allocation. The old shape cost 3.5ms/query at 3.7k chunks and 29ms at
 * 10x — blocking event-loop time on every chat request, up to 3 queries each
 * (EP-SCALE-02).
 * ponytail: still a linear scan. Move vectors to an ANN index (pgvector/hnsw)
 * when the corpus passes ~50k chunks, where the scan alone reaches ~40ms.
 */
function vectorTopK(idx: LoadedIndex, q: number[], k: number, filters: RetrievalFilters): string[] {
  const pred = chunkFilter(filters);
  const hits = vectorScan(idx, q, k, pred);
  // mirror the lexical half's relaxation: a wrong/over-narrow filter must not
  // starve the fused list
  if (pred && hits.length < 5) {
    for (const id of vectorScan(idx, q, k, null)) if (!hits.includes(id)) hits.push(id);
  }
  return hits.slice(0, k);
}

function vectorScan(
  idx: LoadedIndex,
  q: number[],
  k: number,
  pred: ((c: DocChunk) => boolean) | null,
): string[] {
  const v = idx.vectors!;
  const dims = v.dims;
  let norm = 0;
  for (const x of q) norm += x * x;
  norm = 1 / (Math.sqrt(norm) || 1);
  const topIds: string[] = [];
  const topScores: number[] = [];
  for (let i = 0; i < v.ids.length; i++) {
    const id = v.ids[i];
    const c = idx.byId.get(id);
    if (!c || (pred && !pred(c))) continue;
    const s = dot(v, i, dims, q) * norm; // matrix rows pre-normalized at build
    if (topScores.length === k && s <= topScores[k - 1]) continue;
    let j = topScores.length;
    while (j > 0 && topScores[j - 1] < s) j--;
    topScores.splice(j, 0, s);
    topIds.splice(j, 0, id);
    if (topScores.length > k) {
      topScores.pop();
      topIds.pop();
    }
  }
  return topIds;
}

function dot(v: NonNullable<LoadedIndex['vectors']>, row: number, dims: number, q: number[]): number {
  let d = 0;
  const off = row * dims;
  for (let i = 0; i < dims; i++) d += v.matrix[off + i] * q[i];
  return d;
}

// ---------------- citation helper ----------------

export function citationUrl(chunk: DocChunk): string {
  if (chunk.anchor) return `${chunk.url.replace(/\/?$/, '/')}#${chunk.anchor}`;
  // Deep-anchor fallback. Only 36.6% of chunks carry an authored <Section id=>,
  // so two thirds of citations used to drop the reader at the TOP of a long
  // Persian page and make them hunt for the paragraph the answer came from —
  // which is the verifiability the product is built on (EP-RET-09). A
  // `#:~:text=` fragment scrolls to and highlights the chunk's opening
  // sentence; browsers that do not support it ignore it, so the link is never
  // worse than the bare URL it replaces.
  // ponytail: exact-text matching. It silently no-ops when the rendered page
  // phrases the sentence differently (MDX components, inline links). The real
  // fix is authoring `id=` on every <Section> upstream in the docs repo.
  const frag = textFragment(chunk.text);
  return frag ? `${chunk.url}#:~:text=${frag}` : chunk.url;
}

const NON_PROSE = /^(?:\s*(?:```|#{1,6}\s|[-*+>|]\s|\d+[.)]\s|!\[|\|))/;

/** First prose sentence of a chunk, encoded for a `:~:text=` fragment. */
export function textFragment(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || NON_PROSE.test(line)) continue;
    const plain = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → their label
      .replace(/[`*_~]/g, '')
      .trim();
    // a fragment must be long enough to be unique on the page, short enough to
    // survive a stray character further along the sentence
    const sentence = plain.split(/(?<=[.!?؟。])\s/)[0].slice(0, 90).trim();
    if (sentence.length < 20) continue;
    // `-` and `,` delimit the text-fragment grammar itself; encodeURIComponent
    // escapes `,` but not `-`
    return encodeURIComponent(sentence).replace(/-/g, '%2D');
  }
  return '';
}
