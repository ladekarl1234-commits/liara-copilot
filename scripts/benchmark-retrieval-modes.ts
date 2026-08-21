// Hybrid retrieval benchmark — compares lexical / lexical+rerank (the mode that
// actually ships) / vector / hybrid / hybrid+rerank on the fixed eval set, using
// a LOCAL multilingual embedding model (no API key). Answers the amendment's
// "hybrid retrieval benchmark" requirement with reproducible, in-repo numbers.
//
//   npm run benchmark:retrieval-modes
//
// It (1) embeds every chunk once with the local model and caches the vectors to
// data/index/embeddings.json (keyed by chunk hash, reused across runs), then
// (2) drives the SHIPPED search() five ways via its mode flags, scoring
// hit@1/3/5 + true recall@5 + MRR + latency per mode against the eval gold
// sources, and emitting per-case ranks plus paired McNemar p-values so a claim
// that one mode beats another can actually be tested rather than asserted.
// NOTE: retrieval/index (MiniSearch) and ./env are imported DYNAMICALLY inside
// main() — loading them alongside the local WASM embedding runtime crashes the
// process. Embedding runs must not touch them; the eval phase runs in a fresh
// process (after embeddings are cached) where no WASM is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { embedTexts, DEFAULT_LOCAL_EMBED_MODEL } from '../src/lib/ai/local-embeddings';
import type { DocChunk, RetrievalFilters } from '../src/types';
import type { SearchDeps } from '../src/lib/retrieval/index'; // type-only (erased at runtime)

interface EvalCase {
  id: string;
  question: string;
  category: string;
  expectedSources: string[];
  filters?: RetrievalFilters;
}

const CASES_DIR = path.join('evals', 'cases');
const INDEX_DIR = path.join('data', 'index');
const OUT_DIR = path.join('benchmarks', 'retrieval');
// benchmark vector cache lives in .cache — NEVER data/index, which is the live
// production index dir (writing e5 vectors there would clobber the production
// embeddings and mismatch dims against a different configured embed model).
const EMB_CACHE = path.join('.cache', 'retrieval-modes-embeddings.json');
const MODEL = process.env.EMBED_MODEL || DEFAULT_LOCAL_EMBED_MODEL;

/** canonical page path — must match evaluate.ts::pagePath */
function pagePath(url: string): string {
  let p = url.replace(/^https?:\/\/[^/]+/, '').split('#')[0];
  p = p.replace(/^\/llms\//, '/').replace(/\.md$/, '');
  return p.replace(/\/+$/, '').replace(/^\/+/, '/');
}

function loadCases(): EvalCase[] {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const all: EvalCase[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(CASES_DIR, f), 'utf8').replace(/\r\n?/g, '\n');
    all.push(...(JSON.parse(raw) as EvalCase[]));
  }
  return all;
}

// Bounded embeddings-per-invocation. Local WASM inference is slow (~150ms/text)
// and a single 3.7k-chunk process can exhaust the WASM heap; embedding a bounded
// slice per run (each a fresh process) and appending to the cache is stable and
// resumable. Returns the number embedded THIS run (0 when everything is cached).
async function ensureEmbeddings(): Promise<number> {
  const chunks: DocChunk[] = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'chunks.json'), 'utf8'));
  const embPath = EMB_CACHE;
  fs.mkdirSync(path.dirname(embPath), { recursive: true });
  const maxPerRun = Number(process.env.EMBED_MAX_PER_RUN || 800);

  // one vector per UNIQUE chunk hash (dedup identical bodies before embedding)
  const byHash = new Map<string, string>();
  for (const c of chunks) if (!byHash.has(c.hash)) byHash.set(c.hash, [c.title, c.heading, c.text].filter(Boolean).join('\n'));

  // load existing (possibly partial) cache; reset if the model changed
  let vectors: Record<string, number[]> = {};
  let dims = 0;
  if (fs.existsSync(embPath)) {
    const cached = JSON.parse(fs.readFileSync(embPath, 'utf8')) as { model: string; dims: number; vectors: Record<string, number[]> };
    if (cached.model === MODEL) { vectors = cached.vectors; dims = cached.dims; }
  }

  const missing = [...byHash.keys()].filter((h) => !vectors[h]);
  if (!missing.length) {
    console.log(`embeddings complete (${Object.keys(vectors).length} vectors, ${MODEL})`);
    return 0;
  }

  const slice = missing.slice(0, maxPerRun);
  console.log(`embedding ${slice.length}/${missing.length} remaining (of ${byHash.size} unique) with ${MODEL} ...`);
  const t0 = Date.now();
  const BATCH = 16;
  const write = () => fs.writeFileSync(embPath, JSON.stringify({ model: MODEL, dims, vectors }));
  // persist after every batch: the local WASM runtime crashes intermittently, so
  // incremental writes guarantee the resumable driver always makes progress.
  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = slice.slice(i, i + BATCH);
    const rows = await embedTexts(batch.map((h) => byHash.get(h)!), 'passage', MODEL);
    dims = dims || rows[0].length;
    batch.forEach((h, j) => (vectors[h] = rows[j].map((x) => Math.round(x * 1e6) / 1e6)));
    write();
    process.stdout.write(`\r  ${Math.min(i + BATCH, slice.length)}/${slice.length}  ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  process.stdout.write('\n');
  const remaining = missing.length - slice.length;
  console.log(`wrote ${Object.keys(vectors).length} vectors in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${embPath}${remaining ? ` (${remaining} still remaining)` : ' (corpus complete)'}`);
  return slice.length;
}

type ModeName = 'lexical' | 'lexical+rerank' | 'vector' | 'hybrid' | 'hybrid+rerank';
const MODES: { name: ModeName; deps: (eq: SearchDeps['embedQuery']) => SearchDeps }[] = [
  { name: 'lexical', deps: () => ({ mode: { vector: false, rerank: false }, rankOnly: true }) },
  // the mode that actually SHIPS: data/index carries embeddedCount 0, so the
  // deployed ranker is lexical + the deterministic rerank boosts. The vector
  // rows below are potential, not shipped, until an embeddings model is set.
  { name: 'lexical+rerank', deps: () => ({ mode: { vector: false }, rankOnly: true }) },
  { name: 'vector', deps: (eq) => ({ embedQuery: eq, mode: { lexical: false, rerank: false }, rankOnly: true }) },
  { name: 'hybrid', deps: (eq) => ({ embedQuery: eq, mode: { rerank: false }, rankOnly: true }) },
  { name: 'hybrid+rerank', deps: (eq) => ({ embedQuery: eq, mode: {}, rankOnly: true }) },
];

interface Agg {
  n: number;
  hit1: number;
  hit3: number;
  hit5: number;
  /** TRUE recall@5: |gold pages in top 5| / |gold pages|, summed. hit@k only asks
   * whether ONE gold page was found, which over-credits the 13 multi-source
   * cases — exactly the multi-hop workflow cases the Guide capability leans on. */
  recall5Sum: number;
  mrr: number;
  latencies: number[];
}

function p(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1))];
}

/** Exact two-sided McNemar p-value on the discordant pairs (b, c).
 * Without this, a 2-of-48 difference between two modes reads as a "lift" when
 * it is indistinguishable from a coin flip. n is at most 48, so exact beats
 * the chi-square approximation and costs nothing. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let logC = 0; // log C(n, i), updated incrementally
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    tail += Math.exp(logC + n * Math.log(0.5));
  }
  return Math.min(1, 2 * tail);
}

async function main() {
  const embedded = await ensureEmbeddings();
  if (embedded > 0) {
    // This process loaded the WASM embedding runtime; the eval must NOT load
    // retrieval/MiniSearch in the same process (that combination crashes). Exit
    // 2 so the driver re-invokes; a run that embeds 0 (all cached) runs the eval.
    console.log('EMBED_STEP_DONE — re-run to continue/eval.');
    process.exit(2);
  }
  // fresh process, no WASM: safe to load env + retrieval and run the eval.
  await import('./env');
  const { loadIndex, resetIndexForTests, search } = await import('../src/lib/retrieval/index');
  resetIndexForTests();
  const idx = loadIndex(INDEX_DIR);
  // Inject the BENCHMARK vectors (from .cache) into the loaded lexical index —
  // we never read/write data/index/embeddings.json, so this can't affect a
  // production vector index. Align vectors to chunks by hash (mirrors loadIndex).
  const cache = JSON.parse(fs.readFileSync(EMB_CACHE, 'utf8')) as { model: string; dims: number; vectors: Record<string, number[]> };
  const ids: string[] = [];
  const rows: number[] = [];
  for (const c of idx.chunks) {
    const v = cache.vectors[c.hash];
    if (v) { ids.push(c.id); rows.push(...v); }
  }
  if (!ids.length) throw new Error(`no benchmark vectors in ${EMB_CACHE} — run the embedding step first`);
  idx.vectors = { dims: cache.dims, model: cache.model, matrix: Float32Array.from(rows), ids };
  console.log(`index: ${idx.chunks.length} chunks, ${idx.vectors.ids.length} vectors (${idx.vectors.dims}d, ${idx.vectors.model})`);

  const cases = loadCases().filter((c) => c.expectedSources.length > 0); // sourced cases only
  const embedQuery = (texts: string[]) => embedTexts(texts, 'query', MODEL);

  const aggs = new Map<ModeName, Agg>(MODES.map((m) => [m.name, { n: 0, hit1: 0, hit3: 0, hit5: 0, recall5Sum: 0, mrr: 0, latencies: [] }]));
  // per-case ranks, so a reader can see WHICH cases each mode fixed or broke and
  // a paired significance test is possible at all. Aggregates alone cannot
  // support the claim that one mode beats another.
  const perCase: { id: string; category: string; mode: ModeName; rank: number | null; recall5: number }[] = [];

  for (const c of cases) {
    for (const m of MODES) {
      const t0 = Date.now();
      const res = await search([c.question], c.filters ?? {}, m.deps(embedQuery), idx);
      const ms = Date.now() - t0;
      const expected = new Set(c.expectedSources.map(pagePath));
      const pages: string[] = [];
      for (const s of res.chunks) {
        const pp = pagePath(s.chunk.url);
        if (!pages.includes(pp)) pages.push(pp);
      }
      const rank = pages.findIndex((pp) => expected.has(pp)) + 1; // 0 = miss
      const found = pages.slice(0, 5).filter((pp) => expected.has(pp)).length;
      const recall5 = found / expected.size;
      const a = aggs.get(m.name)!;
      a.n++;
      if (rank === 1) a.hit1++;
      if (rank >= 1 && rank <= 3) a.hit3++;
      if (rank >= 1 && rank <= 5) a.hit5++;
      a.recall5Sum += recall5;
      // MRR truncated at rank 5 (a hit at rank ≥6 scores 0, consistent with the
      // hit@5 window). This is truncated MRR@5, reported as MRR for brevity.
      if (rank >= 1 && rank <= 5) a.mrr += 1 / rank;
      a.latencies.push(ms);
      perCase.push({ id: c.id, category: c.category, mode: m.name, rank: rank || null, recall5: Math.round(recall5 * 1000) / 1000 });
    }
  }

  const modeRows = MODES.map((m) => {
    const a = aggs.get(m.name)!;
    const lat = [...a.latencies].sort((x, y) => x - y);
    return {
      mode: m.name,
      n: a.n,
      // hit@k, NOT recall@k: these ask only whether ONE gold page was found.
      // The field was called recall1/3/5 before, which is a different metric.
      hit1: a.hit1 / a.n,
      hit3: a.hit3 / a.n,
      hit5: a.hit5 / a.n,
      /** genuine recall@5, averaged over cases: |gold ∩ top5| / |gold| */
      recall5: a.recall5Sum / a.n,
      mrr: a.mrr / a.n,
      p50ms: p(lat, 50),
      p95ms: p(lat, 95),
    };
  });

  // print
  const header = ['mode', 'n', 'hit@1', 'hit@3', 'hit@5', 'recall@5', 'MRR', 'p50', 'p95'];
  const table = [header, ...modeRows.map((r) => [
    r.mode, String(r.n), (r.hit1 * 100).toFixed(1) + '%', (r.hit3 * 100).toFixed(1) + '%',
    (r.hit5 * 100).toFixed(1) + '%', (r.recall5 * 100).toFixed(1) + '%', r.mrr.toFixed(3), r.p50ms + 'ms', r.p95ms + 'ms',
  ])];
  const w = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
  console.log();
  for (const r of table) console.log(r.map((c, i) => c.padEnd(w[i] + 2)).join(''));

  // paired McNemar over the shared cases, for every mode pair and both hit@1 and
  // hit@5 — the only way to say whether a 2-of-48 difference means anything.
  const hitVec = (mode: ModeName, k: number) =>
    new Map(perCase.filter((r) => r.mode === mode).map((r) => [r.id, r.rank !== null && r.rank <= k]));
  const pairs: { a: ModeName; b: ModeName; metric: string; aOnly: number; bOnly: number; p: number; verdict: string }[] = [];
  for (const k of [1, 5]) {
    for (let i = 0; i < MODES.length; i++) {
      for (let j = i + 1; j < MODES.length; j++) {
        const A = hitVec(MODES[i].name, k);
        const B = hitVec(MODES[j].name, k);
        let aOnly = 0;
        let bOnly = 0;
        for (const [id, hitA] of A) {
          const hitB = B.get(id) ?? false;
          if (hitA && !hitB) aOnly++;
          else if (!hitA && hitB) bOnly++;
        }
        const pv = mcnemarExact(aOnly, bOnly);
        pairs.push({
          a: MODES[i].name, b: MODES[j].name, metric: `hit@${k}`, aOnly, bOnly,
          p: Math.round(pv * 10000) / 10000,
          verdict: pv < 0.05 ? 'distinguishable' : `not distinguishable at n=${A.size}`,
        });
      }
    }
  }
  console.log();
  for (const r of pairs) console.log(`${r.metric}  ${r.a} vs ${r.b}: ${r.aOnly}/${r.bOnly} discordant, p=${r.p.toFixed(4)} — ${r.verdict}`);

  const child = await import('node:child_process');
  let commit = 'unknown';
  let dirty = false;
  try {
    commit = child.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = child.execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* not a git checkout */ }

  const out = {
    date: new Date().toISOString(),
    commit,
    dirtyWorktree: dirty,
    node: process.version,
    embeddingModel: MODEL,
    dims: idx.vectors.dims,
    index: { docsCommit: idx.meta.docsCommit ?? 'unknown', chunkCount: idx.meta.chunkCount, builtAt: idx.meta.builtAt },
    sourcedCases: cases.length,
    note: 'Local embeddings (Transformers.js, offline). Modes drive the shipped search() via mode flags; latency includes local query-embedding time for vector/hybrid.',
    metricNotes: {
      hit1: 'gold page at rank 1 of the raw fused ranking (was published as recall1 — a mislabel)',
      hit5: 'ANY gold page in the top 5 pages',
      recall5: 'genuine recall: |gold pages in top 5| / |gold pages|, averaged over cases. Lower than hit@5 wherever a case has more than one gold page (13 of 48 do).',
      mcnemar: 'exact two-sided paired test on the discordant cases. p >= 0.05 means the two modes are NOT distinguishable on this eval set, whatever the aggregate delta looks like.',
    },
    modes: modeRows,
    mcnemar: pairs,
    cases: perCase,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // never clobber a committed benchmark: date + commit, then a run suffix
  const stem = `modes-${out.date.slice(0, 10)}-${commit === 'unknown' ? 'nogit' : commit.slice(0, 7)}${dirty ? '-dirty' : ''}`;
  let file = path.join(OUT_DIR, `${stem}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(OUT_DIR, `${stem}-run${i}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n✓ wrote ${path.relative(process.cwd(), file)}`);
}

// entry-point guard: tests import mcnemarExact without starting a benchmark run
if (/benchmark-retrieval-modes.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
