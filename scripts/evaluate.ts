// Evaluation runner.
//   npx tsx scripts/evaluate.ts --retrieval-only          # retrieval metrics (default mode)
//   npx tsx scripts/evaluate.ts --answers [--limit N] [--category X]
// Retrieval mode needs only the built index. Answers mode needs a running
// server (/api/chat) plus a configured AI provider for the LLM judge.
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadIndex, search } from '../src/lib/retrieval/index';
import { queryEmbedder } from '../src/lib/retrieval/embed';
import { detectInjection } from '../src/lib/security/injection';
import { config } from '../src/lib/config';
import { OpenAICompatibleProvider } from '../src/lib/ai/provider';
import type { RetrievalFilters, RetrievalResult } from '../src/types';

interface EvalCase {
  id: string;
  question: string;
  category: string;
  language: 'fa' | 'en' | 'mixed';
  /** true = a ranker/gate change was made in RESPONSE to this case during the
   * review rounds (named in docs/EVALUATION.md, docs/SECURITY.md, specs/spec.md
   * or docs/reviews/round-*). Those cases are fitted-on; the rest were only ever
   * seen in aggregate. Reported as two subsets so the headline number is not
   * silently a training-set number — see SPLIT_NOTE. */
  tunedOn: boolean;
  expectedSources: string[];
  expectedFacts: string[];
  forbiddenClaims: string[];
  shouldClarify: boolean;
  filters?: RetrievalFilters;
}

const CASES_DIR = path.join('evals', 'cases');
const RESULTS_DIR = path.join('evals', 'results');
export const BASELINE_FILE = path.join('evals', 'baseline.json');

/** Definitions published with every artifact so no reader has to guess what a
 * number means. hit@k in particular is measured on the RAW fused ranking, not
 * on the post-gate evidence set — the old harness measured after evidence
 * selection, where 27/48 cases exposed fewer than 5 pages, so "hit@5" was not
 * a k=5 metric at all and moved whenever the evidence cutoff moved. */
export const METRIC_NOTES = {
  hit1: 'gold page at rank 1 of the RAW fused ranking (rankOnly — before evidence selection, dedup and the confidence gate)',
  hit3: 'gold page in the top 3 pages of the raw fused ranking',
  hit5: 'gold page in the top 5 pages of the raw fused ranking — directly comparable to benchmarks/retrieval/modes-*.json',
  mrr: 'mean reciprocal rank over the raw ranking, truncated at rank 5 (a hit at rank >= 6 scores 0)',
  evidenceRecall:
    'gold page survived into the FINAL evidence set the model actually sees (post cutoff/dedup/char-budget). This is what the old harness reported as "hit@5".',
  refusalRecall: 'must-refuse cases (unsupported + adversarial) the system actually refused — injection detector fired OR confidence low',
  ambiguousAccuracy: 'ambiguous cases that did NOT reach high confidence (a laxer bar than refusal, reported separately rather than pooled)',
  falseRefusalRate: 'ANSWERABLE (sourced) cases the system refused anyway — the precision side of the gate, invisible in gateAccuracy',
  balancedAccuracy: '(refusalRecall + (1 - falseRefusalRate)) / 2',
  gateAccuracy: 'legacy pooled ratio: refusalRecall and ambiguousAccuracy in one number, kept for continuity with earlier artifacts',
  hit5Ci: 'Wilson 95% interval for hit@5 — at n=48 the band is roughly +/-11pp, so per-category rates are reported as raw fractions',
} as const;

const SPLIT_NOTE =
  'tunedOn=true: a ranker or gate change was made in response to THIS case during the review rounds (named in docs/EVALUATION.md, docs/SECURITY.md, specs/spec.md or docs/reviews/round-*). tunedOn=false: never individually chased. This is NOT a held-out split and the untuned rate is NOT an unbiased estimate of unseen performance: cases entered the tuned set BY FAILING, so the untuned subset is selected for being easy (it scores 30/30) while the tuned subset is selected for being hard (9/18). What the two numbers do show honestly is that every remaining miss is a case that was already known and chased — the boosts did not generalise to their own targets — and that the headline 39/48 is not carried by cases the ranker was fitted to. A genuine held-out number requires freezing new cases BEFORE the next tuning round; retroactively relabelling this set cannot produce one.';

function loadCases(): EvalCase[] {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const all: EvalCase[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(CASES_DIR, f), 'utf8').replace(/\r\n?/g, '\n');
    const parsed = JSON.parse(raw) as EvalCase[];
    // a missing flag would silently land the case in the "untuned" bucket and
    // flatter the held-out number — the one number that must not be flattered
    const bad = parsed.find((c) => typeof c.tunedOn !== 'boolean');
    if (bad) throw new Error(`${f}: case "${bad.id}" is missing the required boolean \`tunedOn\` flag`);
    all.push(...parsed);
  }
  return all;
}

/** canonical page path: no origin, no /llms prefix, no .md, no #anchor, no trailing slash */
export function pagePath(url: string): string {
  let p = url.replace(/^https?:\/\/[^/]+/, '').split('#')[0];
  p = p.replace(/^\/llms\//, '/').replace(/\.md$/, '');
  return p.replace(/\/+$/, '').replace(/^\/+/, '/');
}

function parseArgs(argv: string[]) {
  const args = { answers: false, retrievalOnly: false, limit: Infinity, category: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--answers') args.answers = true;
    else if (argv[i] === '--retrieval-only') args.retrievalOnly = true;
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]) || Infinity;
    else if (argv[i] === '--category') args.category = argv[++i] ?? '';
  }
  return args;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Provenance for the results artifact: without the commit a number cannot be
 * tied to the code that produced it, and `dirty` says whether the working tree
 * even matched that commit. */
function gitInfo(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: false }; // not a git checkout (e.g. a tarball)
  }
}

/** Distinct per (day, commit, clean/dirty) so two runs can never be confused. */
function runId(git: { commit: string; dirty: boolean }): string {
  return `${today()}-${git.commit === 'unknown' ? 'nogit' : git.commit.slice(0, 7)}${git.dirty ? '-dirty' : ''}`;
}

function writeResult(name: string, id: string, data: unknown): string {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  // Never clobber. The old `${name}-${today()}.json` meant a second run on the
  // same day silently overwrote the committed baseline, so nobody could tell
  // which run produced the number in the docs.
  let file = path.join(RESULTS_DIR, `${name}-${id}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(RESULTS_DIR, `${name}-${id}-run${i}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\nresults written to ${file}`);
  return file;
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : '-';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Wilson score 95% interval — the honest error bar on a rate measured at n=48. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [round3(Math.max(0, (centre - half) / denom)), round3(Math.min(1, (centre + half) / denom))];
}

/** ordered unique page paths of a result's chunks */
export function uniquePages(res: RetrievalResult): string[] {
  const pages: string[] = [];
  for (const s of res.chunks) {
    const p = pagePath(s.chunk.url);
    if (!pages.includes(p)) pages.push(p);
  }
  return pages;
}

// ---------------- retrieval mode ----------------

interface CatAgg {
  n: number;
  hit1: number;
  hit3: number;
  hit5: number;
  mrrSum: number;
  /** gold page survived evidence selection (post-cutoff), scored separately from hit@k */
  evidenceHit: number;
  /** ANSWERABLE case the system refused anyway — the precision side of the gate */
  falseRefusal: number;
  gateN: number;
  gateOk: number;
  strictN: number;
  strictOk: number;
  ambiguousN: number;
  ambiguousOk: number;
  confidence: Record<string, number>;
}

function newAgg(): CatAgg {
  return {
    n: 0, hit1: 0, hit3: 0, hit5: 0, mrrSum: 0, evidenceHit: 0, falseRefusal: 0,
    gateN: 0, gateOk: 0, strictN: 0, strictOk: 0, ambiguousN: 0, ambiguousOk: 0, confidence: {},
  };
}

function addAgg(into: CatAgg, a: CatAgg) {
  into.n += a.n; into.hit1 += a.hit1; into.hit3 += a.hit3; into.hit5 += a.hit5;
  into.mrrSum += a.mrrSum; into.evidenceHit += a.evidenceHit; into.falseRefusal += a.falseRefusal;
  into.gateN += a.gateN; into.gateOk += a.gateOk;
  into.strictN += a.strictN; into.strictOk += a.strictOk;
  into.ambiguousN += a.ambiguousN; into.ambiguousOk += a.ambiguousOk;
  for (const [k, v] of Object.entries(a.confidence)) into.confidence[k] = (into.confidence[k] ?? 0) + v;
}

/** the sourced-case block of a summary, reused for OVERALL and for each split */
function rates(a: CatAgg) {
  return {
    n: a.n,
    hit1: a.n ? round3(a.hit1 / a.n) : null,
    hit3: a.n ? round3(a.hit3 / a.n) : null,
    hit5: a.n ? round3(a.hit5 / a.n) : null,
    mrr: a.n ? round3(a.mrrSum / a.n) : null,
    evidenceRecall: a.n ? round3(a.evidenceHit / a.n) : null,
    falseRefusalRate: a.n ? round3(a.falseRefusal / a.n) : null,
    counts: { hit1: a.hit1, hit3: a.hit3, hit5: a.hit5, evidenceHit: a.evidenceHit, falseRefusal: a.falseRefusal },
  };
}

export interface Baseline {
  sourced: number;
  gateCases: number;
  hit5: number;
  mrr: number;
  evidenceRecall: number;
  refusalRecall: number;
  falseRefusalRate: number;
  index: { docsCommit: string; chunkCount: number };
}

/** One case of slack on every metric, derived from the ACCEPTED baseline rather
 * than hand-typed — hand-typed floors drifted 15-17pp below measured, which let
 * a 7-case hit@5 drop pass CI. Derived floors cannot drift: re-baselining is the
 * only way to move them, and that is a visible diff of evals/baseline.json. */
export function floorsFrom(b: Baseline) {
  return {
    hit5: (b.hit5 * b.sourced - 1) / b.sourced,
    mrr: (b.mrr * b.sourced - 1) / b.sourced,
    evidenceRecall: (b.evidenceRecall * b.sourced - 1) / b.sourced,
    refusalRecall: (b.refusalRecall * b.gateCases - 1) / b.gateCases,
    falseRefusalMax: (b.falseRefusalRate * b.sourced + 1) / b.sourced,
  };
}

async function runRetrieval(cases: EvalCase[], enforceFloors = true) {
  const idx = loadIndex();
  // Measure what SHIPS. Previously this passed no embedder, so the eval was
  // lexical-only even when the index carried vectors — the published number
  // then described a configuration nobody runs (EP-PRD-02 / EP-RET-01).
  // Reproduce the LEXICAL baseline with AI_EMBEDDINGS_MODEL='' (empty string).
  // NOT by unsetting it: the default is now `local:`, so an unset variable gives
  // HYBRID. Publishing a hybrid run labelled lexical is the same trap as EP-PRD-02.
  const embedQuery = queryEmbedder();
  const git = gitInfo();
  const id = runId(git);
  const perCat = new Map<string, CatAgg>();
  const agg = (cat: string): CatAgg => {
    let a = perCat.get(cat);
    if (!a) { a = newAgg(); perCat.set(cat, a); }
    return a;
  };
  const bySplit = { tuned: newAgg(), untuned: newAgg() };
  const perCase: object[] = [];

  for (const c of cases) {
    // TWO searches per case, deliberately:
    //  - rankOnly: the raw fused ranking, which is what hit@k must be scored on
    //    (k=5 means 5 candidate pages; the evidence set often holds fewer).
    //  - normal: the evidence set + confidence the user actually gets, which is
    //    what the gate and evidenceRecall must be scored on.
    const res = await search([c.question], c.filters ?? {}, { embedQuery }, idx);
    const a = agg(c.category);
    a.confidence[res.confidence] = (a.confidence[res.confidence] ?? 0) + 1;
    // the real system decision: injection front door OR the evidence gate
    const refused = detectInjection(c.question) || res.confidence === 'low';

    if (!c.expectedSources.length) {
      // gate case — measure the REAL system decision, not just raw search
      // confidence. An adversarial prompt-injection query sharing vocabulary
      // with the docs may retrieve at 'medium' yet still be refused by the
      // injection front door. `unsupported`/`adversarial` must refuse outright;
      // `ambiguous` only has to avoid answering confidently. Those are two
      // different bars, so they are also reported as two different numbers —
      // pooling them into one ratio hid which half was failing.
      const strict = c.category === 'unsupported' || c.category === 'adversarial';
      const ok = strict ? refused : res.confidence !== 'high';
      a.gateN++;
      if (ok) a.gateOk++;
      if (strict) { a.strictN++; if (ok) a.strictOk++; } else { a.ambiguousN++; if (ok) a.ambiguousOk++; }
      perCase.push({ id: c.id, category: c.category, tunedOn: c.tunedOn, gate: true, strict, confidence: res.confidence, refused, gateOk: ok });
      continue;
    }

    const ranked = await search([c.question], c.filters ?? {}, { rankOnly: true, embedQuery }, idx);
    const expected = new Set(c.expectedSources.map(pagePath));
    const rankedPages = uniquePages(ranked);
    const evidencePages = uniquePages(res);
    const rank = rankedPages.findIndex((p) => expected.has(p)) + 1; // 0 = miss
    const evidenceRank = evidencePages.findIndex((p) => expected.has(p)) + 1;

    for (const t of [a, bySplit[c.tunedOn ? 'tuned' : 'untuned']]) {
      t.n++;
      if (rank === 1) t.hit1++;
      if (rank >= 1 && rank <= 3) t.hit3++;
      if (rank >= 1 && rank <= 5) t.hit5++;
      // truncated MRR@5 — a hit at rank >= 6 scores 0, consistent with hit@5
      t.mrrSum += rank >= 1 && rank <= 5 ? 1 / rank : 0;
      if (evidenceRank >= 1) t.evidenceHit++;
      if (refused) t.falseRefusal++;
    }
    perCase.push({
      id: c.id,
      category: c.category,
      tunedOn: c.tunedOn,
      rank: rank || null,
      evidenceRank: evidenceRank || null,
      confidence: res.confidence,
      falseRefusal: refused,
      topPages: rankedPages.slice(0, 5),
      evidencePages,
      expected: [...expected],
    });
  }

  // table — per-category cells are raw k/n fractions, never percentages: half
  // the categories have n=2, where one case flipping moves a percentage by 50
  // points and reads as a regression that is not there.
  const rows: string[][] = [['category', 'n', 'hit@1', 'hit@3', 'hit@5', 'MRR', 'evid', 'false-ref', 'gate', 'conf h/m/l']];
  const overall = newAgg();
  for (const [cat, a] of [...perCat.entries()].sort()) {
    addAgg(overall, a);
    rows.push(row(cat, a, false));
  }
  rows.push(row('OVERALL', overall, true));
  printTable(rows);

  const strictRecall = overall.strictN ? overall.strictOk / overall.strictN : null;
  const falseRefusalRate = overall.n ? overall.falseRefusal / overall.n : 0;
  const summary = {
    // ---- provenance: a number nobody can reproduce is not a measurement ----
    runId: id,
    date: today(),
    commit: git.commit,
    dirtyWorktree: git.dirty,
    node: process.version,
    index: {
      docsCommit: idx.meta.docsCommit ?? 'unknown',
      chunkCount: idx.meta.chunkCount,
      builtAt: idx.meta.builtAt,
      anchorCoverage: round3(idx.meta.anchorCoverage),
      lexicalVersion: idx.meta.lexicalVersion ?? null,
      // the corpus is gitignored, so the docs commit above is the ONLY handle on
      // what was measured; pin it with LIARA_DOCS_REF when reproducing.
      hasVectors: Boolean(idx.vectors),
    },
    // vectors present in the index is NOT enough — the query side must also be
    // embedding, or the run is lexical despite a hybrid index (EP-RET-01).
    retrievalMode: idx.vectors && embedQuery ? 'hybrid+rerank' : 'lexical+rerank',
    metricNotes: METRIC_NOTES,
    splitNote: SPLIT_NOTE,

    // ---- headline ----
    total: cases.length,
    sourced: overall.n,
    hit1: overall.n ? overall.hit1 / overall.n : 0,
    hit3: overall.n ? overall.hit3 / overall.n : 0,
    hit5: overall.n ? overall.hit5 / overall.n : 0,
    hit5Ci: wilson(overall.hit5, overall.n),
    mrr: overall.n ? overall.mrrSum / overall.n : 0,
    evidenceRecall: overall.n ? overall.evidenceHit / overall.n : 0,

    // ---- gate, both sides ----
    gateCases: overall.gateN,
    gateAccuracy: overall.gateN ? overall.gateOk / overall.gateN : null,
    refusalRecall: strictRecall,
    refusalCases: overall.strictN,
    ambiguousAccuracy: overall.ambiguousN ? overall.ambiguousOk / overall.ambiguousN : null,
    ambiguousCases: overall.ambiguousN,
    falseRefusalRate,
    balancedAccuracy: strictRecall === null ? null : (strictRecall + (1 - falseRefusalRate)) / 2,
    confidence: overall.confidence,

    // ---- fitted vs never-chased ----
    bySplit: { tuned: rates(bySplit.tuned), untuned: rates(bySplit.untuned) },

    perCategory: Object.fromEntries(
      [...perCat.entries()].map(([k, a]) => [
        k,
        {
          ...rates(a),
          // n < 8 cannot support a rate: the Wilson band on 2/2 is [0.34, 1.00]
          smallSample: a.n > 0 && a.n < 8,
          gateN: a.gateN,
          gateOk: a.gateOk,
          confidence: a.confidence,
        },
      ]),
    ),
    cases: perCase,
  };
  writeResult('retrieval', id, summary);

  // Regression floors: a retrieval regression must FAIL the run, not silently
  // rewrite a JSON nobody diffs. Only applied to a FULL run — a filtered subset
  // (--category / --limit) has too few cases for the ratios to mean anything.
  //
  // The floors are DERIVED from evals/baseline.json (accepted metrics minus one
  // case of slack), never hand-typed, so they track the baseline by
  // construction. The one deliberate exception is the refusal bar: two gate
  // cases — an adversarial "delete another account's resources" request and a
  // Docker CRLF error — carry genuine Liara vocabulary and are lexically
  // indistinguishable from ~11 legitimate troubleshooting cases (measured).
  // That is ACCEPTED DEBT, defended downstream (answer-prompt safety refusal +
  // claim verification), not by the lexical gate. See specs/spec.md AC9.
  if (enforceFloors) {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.error(`FAIL: no ${BASELINE_FILE} — the regression gate has nothing to compare against. Re-baseline deliberately from a run you trust.`);
      process.exitCode = 1;
    } else {
      const base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
      const floors = floorsFrom(base);
      // A corpus move is not a code regression. sync-docs pulls upstream HEAD, so
      // a page rename can trip a floor (or mask a real drop) with no other signal.
      if (base.index.docsCommit !== summary.index.docsCommit) {
        console.warn(
          `WARN: docs corpus moved since the baseline (${base.index.docsCommit.slice(0, 8)} -> ${summary.index.docsCommit.slice(0, 8)}, ` +
            `${base.index.chunkCount} -> ${summary.index.chunkCount} chunks). A floor failure below may be corpus drift, not a code regression.`,
        );
      }
      if (base.sourced !== summary.sourced || base.gateCases !== summary.gateCases) {
        console.warn(`WARN: case counts changed (sourced ${base.sourced}->${summary.sourced}, gate ${base.gateCases}->${summary.gateCases}); floors are ratios and were not re-derived.`);
      }
      const fail = (label: string, got: number, floor: number, higherIsBetter = true) => {
        if (higherIsBetter ? got < floor : got > floor) {
          console.error(`FAIL: ${label} ${got.toFixed(3)} ${higherIsBetter ? 'below floor' : 'above ceiling'} ${floor.toFixed(3)} (baseline ${higherIsBetter ? '-' : '+'} 1 case)`);
          process.exitCode = 1;
        }
      };
      fail('hit@5', summary.hit5, floors.hit5);
      fail('MRR', summary.mrr, floors.mrr);
      fail('evidence-recall', summary.evidenceRecall, floors.evidenceRecall);
      if (summary.refusalRecall !== null) fail('refusal-recall', summary.refusalRecall, floors.refusalRecall);
      fail('false-refusal-rate', summary.falseRefusalRate, floors.falseRefusalMax, false);
    }
  }

  console.log(
    `\nhit@5=${summary.hit5.toFixed(3)} [${summary.hit5Ci[0]}, ${summary.hit5Ci[1]}]  MRR=${summary.mrr.toFixed(3)}  evidence-recall=${summary.evidenceRecall.toFixed(3)}` +
      `\nrefusal-recall=${summary.refusalRecall?.toFixed(3) ?? 'n/a'} (${overall.strictOk}/${overall.strictN})  ambiguous=${overall.ambiguousOk}/${overall.ambiguousN}  false-refusal=${falseRefusalRate.toFixed(3)} (${overall.falseRefusal}/${overall.n})  balanced=${summary.balancedAccuracy?.toFixed(3) ?? 'n/a'}` +
      `\nhit@5 by split: tuned ${bySplit.tuned.hit5}/${bySplit.tuned.n}  untuned ${bySplit.untuned.hit5}/${bySplit.untuned.n}  (cases enter the tuned set by failing — neither half is an unbiased held-out estimate; see splitNote)`,
  );

  function row(name: string, a: CatAgg, overallRow: boolean): string[] {
    const cell = (k: number) => (a.n ? (overallRow ? `${k}/${a.n} ${pct(k, a.n)}` : `${k}/${a.n}`) : '-');
    return [
      name,
      String(a.n + a.gateN),
      cell(a.hit1),
      cell(a.hit3),
      cell(a.hit5),
      a.n ? (a.mrrSum / a.n).toFixed(2) : '-',
      cell(a.evidenceHit),
      cell(a.falseRefusal),
      a.gateN ? `${a.gateOk}/${a.gateN}` : '-',
      `${a.confidence.high ?? 0}/${a.confidence.medium ?? 0}/${a.confidence.low ?? 0}`,
    ];
  }
}

function printTable(rows: string[][]) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i] + 2)).join(''));
}

// ---------------- answers mode ----------------

interface SseAnswer {
  text: string;
  citations: { url: string; title?: string }[];
  error?: string;
}

async function askServer(baseUrl: string, question: string): Promise<SseAnswer> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: question }),
  });
  if (!res.ok || !res.body) return { text: '', citations: [], error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const out: SseAnswer = { text: '', citations: [] };
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      try {
        const ev = JSON.parse(m[1]);
        if (ev.type === 'delta') out.text += ev.text;
        else if (ev.type === 'citations') out.citations = ev.citations ?? [];
        else if (ev.type === 'error') out.error = `${ev.code}: ${ev.message}`;
      } catch {
        // partial/keepalive line — ignore
      }
    }
  }
  return out;
}

interface Judgement {
  correct: boolean;
  grounded: boolean;
  citedExpectedSource: boolean;
  containsForbiddenClaim: boolean;
  clarifiedWhenExpected: boolean;
  actionable: boolean;
  score: number;
  note: string;
}

async function judge(provider: OpenAICompatibleProvider, c: EvalCase, ans: SseAnswer): Promise<Judgement> {
  const prompt = [
    'You are a strict evaluator for a documentation assistant about Liara.ir cloud platform.',
    'Judge the ANSWER against the expectations. Return ONLY a JSON object with keys:',
    '{"correct":bool,"grounded":bool,"citedExpectedSource":bool,"containsForbiddenClaim":bool,"clarifiedWhenExpected":bool,"actionable":bool,"score":0-10,"note":"short"}',
    '- correct: the answer contains the expected facts (or, if expected facts are empty and the docs do not cover the topic, it appropriately declines/says the docs do not establish it).',
    '- grounded: no invented Liara-specific claims beyond the cited docs.',
    '- citedExpectedSource: at least one citation URL matches an expected source page (ignore #anchor and trailing slash). False if no expected sources.',
    '- containsForbiddenClaim: the answer asserts any forbidden claim.',
    '- clarifiedWhenExpected: if shouldClarify is true, the answer asks a targeted clarifying question instead of answering. If shouldClarify is false, set true only when it did NOT needlessly clarify.',
    '- actionable: a user could act on the answer (concrete steps/commands) when a real answer was expected.',
    '',
    `QUESTION: ${c.question}`,
    `SHOULD_CLARIFY: ${c.shouldClarify}`,
    `EXPECTED_FACTS: ${JSON.stringify(c.expectedFacts)}`,
    `FORBIDDEN_CLAIMS: ${JSON.stringify(c.forbiddenClaims)}`,
    `EXPECTED_SOURCES: ${JSON.stringify(c.expectedSources)}`,
    `ANSWER: ${ans.text.slice(0, 6000)}`,
    `ANSWER_CITATIONS: ${JSON.stringify(ans.citations.map((x) => x.url))}`,
  ].join('\n');
  const res = await provider.generate({
    model: config().smartModel,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 400,
    temperature: 0,
    jsonSchema: {},
  });
  const j = JSON.parse(res.text) as Judgement;
  if (typeof j.score !== 'number' || typeof j.correct !== 'boolean') throw new Error('judge returned malformed JSON');
  return j;
}

async function runAnswers(cases: EvalCase[]) {
  const baseUrl = (process.env.EVAL_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  if (!config().aiConfigured) {
    console.error('answers mode skipped: AI provider not configured (set AI_BASE_URL and AI_API_KEY for the judge).');
    process.exitCode = 1;
    return;
  }
  try {
    await fetch(baseUrl, { method: 'HEAD' });
  } catch {
    console.error(`answers mode skipped: server unreachable at ${baseUrl} (start it or set EVAL_BASE_URL).`);
    process.exitCode = 1;
    return;
  }
  const provider = new OpenAICompatibleProvider();

  const results: object[] = [];
  let judged = 0;
  const sums = { score: 0, correct: 0, grounded: 0, cited: 0, forbidden: 0, clarified: 0, actionable: 0 };
  for (const c of cases) {
    process.stdout.write(`[${c.id}] `);
    try {
      const ans = await askServer(baseUrl, c.question);
      if (ans.error && !ans.text) {
        console.log(`server error: ${ans.error}`);
        results.push({ id: c.id, category: c.category, error: ans.error });
        continue;
      }
      const j = await judge(provider, c, ans);
      judged++;
      sums.score += j.score;
      sums.correct += +j.correct;
      sums.grounded += +j.grounded;
      sums.cited += +j.citedExpectedSource;
      sums.forbidden += +j.containsForbiddenClaim;
      sums.clarified += +j.clarifiedWhenExpected;
      sums.actionable += +j.actionable;
      results.push({ id: c.id, category: c.category, judgement: j, citations: ans.citations, answerChars: ans.text.length });
      console.log(`score=${j.score} correct=${j.correct} grounded=${j.grounded}`);
    } catch (e) {
      console.log(`failed: ${(e as Error).message}`);
      results.push({ id: c.id, category: c.category, error: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, 500)); // rate-limit friendly
  }

  const git = gitInfo();
  const summary = {
    runId: runId(git),
    date: today(),
    commit: git.commit,
    dirtyWorktree: git.dirty,
    node: process.version,
    judgeModel: config().smartModel,
    baseUrl,
    judged,
    attempted: cases.length,
    avgScore: judged ? sums.score / judged : null,
    correctRate: judged ? sums.correct / judged : null,
    groundedRate: judged ? sums.grounded / judged : null,
    citedExpectedRate: judged ? sums.cited / judged : null,
    forbiddenClaimRate: judged ? sums.forbidden / judged : null,
    clarifiedWhenExpectedRate: judged ? sums.clarified / judged : null,
    actionableRate: judged ? sums.actionable / judged : null,
    cases: results,
  };
  writeResult('answers', summary.runId, summary);
  console.log(
    `\njudged ${judged}/${cases.length}  avgScore=${summary.avgScore?.toFixed(2) ?? '-'}  correct=${pct(sums.correct, judged)}  grounded=${pct(sums.grounded, judged)}`,
  );
}

// ---------------- main ----------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let cases = loadCases();
  if (args.category) cases = cases.filter((c) => c.category === args.category);
  if (Number.isFinite(args.limit)) cases = cases.slice(0, args.limit);
  console.log(`${cases.length} cases loaded${args.category ? ` (category=${args.category})` : ''}`);

  if (args.answers) await runAnswers(cases);
  else {
    // enforce regression floors only on a FULL run — a filtered subset
    // (--category / --limit) has too few cases and would trip spuriously
    const fullRun = !args.category && !Number.isFinite(args.limit);
    await runRetrieval(cases, fullRun);
  }
}

// run only when invoked as the entry point, so tests can import the scoring
// helpers above without kicking off a full eval as a side effect
if (/evaluate\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
