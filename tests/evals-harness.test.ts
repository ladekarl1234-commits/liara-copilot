// Measurement-integrity locks for the eval harness (EP-DATA-01/03/04/05/07/09/11).
// Every assertion here fails against the pre-fix harness: floors that sat 15pp
// below measured, results artifacts with no provenance, "hit@5" scored after
// evidence selection, and a modes benchmark with no per-case data.
import '../scripts/env';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { BASELINE_FILE, floorsFrom, wilson, uniquePages, pagePath, type Baseline } from '../scripts/evaluate';
import { mcnemarExact } from '../scripts/benchmark-retrieval-modes';
import { loadIndex, search } from '@/lib/retrieval/index';

const ROOT = path.join(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'evals', 'results');
const BENCH_DIR = path.join(ROOT, 'benchmarks', 'retrieval');

function baseline(): Baseline {
  return JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_FILE), 'utf8')) as Baseline;
}

describe('regression floors are derived from the accepted baseline (EP-DATA-03)', () => {
  const b = baseline();
  const floors = floorsFrom(b);

  it('gives exactly one case of slack on each metric', () => {
    expect(floors.hit5).toBeCloseTo((b.hit5 * b.sourced - 1) / b.sourced, 12);
    expect(floors.refusalRecall).toBeCloseTo((b.refusalRecall * b.gateCases - 1) / b.gateCases, 12);
    // false refusals are a ceiling, not a floor — slack goes the other way
    expect(floors.falseRefusalMax).toBeCloseTo((b.falseRefusalRate * b.sourced + 1) / b.sourced, 12);
  });

  it('sits close under the baseline, not 15pp below it', () => {
    // the old hand-typed floors were HIT5_MIN 0.66 / GATE_MIN 0.75 against a
    // measured 0.8125 / 0.923 — a 7-case hit@5 collapse passed CI
    expect(floors.hit5).toBeGreaterThan(0.66);
    expect(b.hit5 - floors.hit5).toBeLessThanOrEqual(1 / b.sourced + 1e-9);
    expect(floors.refusalRecall).toBeGreaterThan(0.75);
  });

  it('fails a 7-case hit@5 drop, which the old floor passed', () => {
    const dropped = (b.hit5 * b.sourced - 7) / b.sourced; // 32/48 = 0.667
    expect(dropped).toBeGreaterThan(0.66); // would have PASSED the old floor
    expect(dropped).toBeLessThan(floors.hit5); // fails the derived floor
  });

  it('fails a 2-case refusal drop and a doubled false-refusal rate', () => {
    expect((b.refusalRecall * b.gateCases - 2) / b.gateCases).toBeLessThan(floors.refusalRecall);
    expect(b.falseRefusalRate * 2).toBeGreaterThan(floors.falseRefusalMax);
  });

  it('the baseline carries the corpus it was measured on, so drift is detectable', () => {
    expect(b.index.docsCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(b.index.chunkCount).toBeGreaterThan(0);
    expect(b.sourced).toBeGreaterThan(0);
    expect(b.gateCases).toBeGreaterThan(0);
  });
});

describe('results artifacts are reproducible (EP-DATA-04)', () => {
  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json'));

  it('has at least one committed retrieval artifact', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every artifact stamps commit, node, index provenance and metric definitions', () => {
    for (const f of files) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(r.runId, `${f}: no runId`).toBeTruthy();
      expect(r.commit, `${f}: no commit`).toBeTruthy();
      expect(r.node, `${f}: no node version`).toMatch(/^v\d/);
      expect(typeof r.dirtyWorktree, `${f}: no dirtyWorktree flag`).toBe('boolean');
      expect(r.index?.docsCommit, `${f}: no index.docsCommit`).toBeTruthy();
      expect(r.index?.chunkCount, `${f}: no index.chunkCount`).toBeGreaterThan(0);
      expect(r.retrievalMode, `${f}: no retrievalMode`).toBeTruthy();
      expect(r.metricNotes?.hit5, `${f}: metrics are not self-documenting`).toBeTruthy();
    }
  });

  it('the filename carries the run id, so a same-day re-run cannot clobber it', () => {
    for (const f of files) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(f, `${f}: filename must contain its runId`).toContain(r.runId);
      expect(r.runId).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{7}/);
    }
  });
});

describe('hit@k is honest about k (EP-DATA-05)', () => {
  it('the evidence set exposes fewer than 5 pages on real cases, so scoring hit@5 there is not k=5', async () => {
    const idx = loadIndex();
    const cases = fs
      .readdirSync(path.join(ROOT, 'evals', 'cases'))
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'cases', f), 'utf8')) as { question: string; expectedSources: string[] }[])
      .filter((c) => c.expectedSources.length)
      .slice(0, 12);

    let narrowEvidence = 0;
    for (const c of cases) {
      const evidence = uniquePages(await search([c.question], {}, {}, idx));
      const ranked = uniquePages(await search([c.question], {}, { rankOnly: true }, idx));
      // the raw ranking always offers at least as many candidate pages as the
      // evidence set — that is the whole point of scoring hit@k on it
      expect(ranked.length).toBeGreaterThanOrEqual(evidence.length);
      if (evidence.length < 5) narrowEvidence++;
    }
    expect(narrowEvidence, 'no case had a narrow evidence set — re-check the sample').toBeGreaterThan(0);
  });

  it('reports evidence recall separately from hit@k', () => {
    const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.startsWith('retrieval-'));
    for (const f of files) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(typeof r.evidenceRecall, `${f}: evidenceRecall missing`).toBe('number');
      expect(r.metricNotes.evidenceRecall).toMatch(/evidence set/i);
      // every sourced case records both ranks, so the two metrics are auditable
      const sourced = r.cases.filter((c: { gate?: boolean }) => !c.gate);
      expect(sourced.length).toBe(r.sourced);
      for (const c of sourced) expect(c, `${f}#${c.id}`).toHaveProperty('evidenceRank');
    }
  });
});

describe('the gate is scored on both sides (EP-DATA-07)', () => {
  it('artifacts report false refusals on answerable cases, not only refusal recall', () => {
    for (const f of fs.readdirSync(RESULTS_DIR).filter((x) => x.startsWith('retrieval-'))) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(typeof r.falseRefusalRate, `${f}`).toBe('number');
      expect(typeof r.refusalRecall, `${f}`).toBe('number');
      expect(typeof r.ambiguousAccuracy, `${f}`).toBe('number');
      expect(typeof r.balancedAccuracy, `${f}`).toBe('number');
      // ambiguous cases use a laxer bar and must not be pooled into refusal recall
      expect(r.refusalCases + r.ambiguousCases).toBe(r.gateCases);
    }
  });
});

describe('the tuned/untuned split is recorded (EP-DATA-01)', () => {
  const cases = fs
    .readdirSync(path.join(ROOT, 'evals', 'cases'))
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'cases', f), 'utf8')) as { id: string; tunedOn: unknown }[]);

  it('every case carries a boolean tunedOn flag', () => {
    for (const c of cases) expect(typeof c.tunedOn, `${c.id}`).toBe('boolean');
  });

  it('both subsets are non-empty, so two numbers can actually be reported', () => {
    const tuned = cases.filter((c) => c.tunedOn === true).length;
    expect(tuned).toBeGreaterThan(0);
    expect(cases.length - tuned).toBeGreaterThan(0);
  });

  it('artifacts publish both subsets and the caveat that neither is unbiased', () => {
    for (const f of fs.readdirSync(RESULTS_DIR).filter((x) => x.startsWith('retrieval-'))) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(r.bySplit?.tuned?.n, `${f}`).toBeGreaterThan(0);
      expect(r.bySplit?.untuned?.n, `${f}`).toBeGreaterThan(0);
      expect(r.bySplit.tuned.n + r.bySplit.untuned.n).toBe(r.sourced);
      expect(r.splitNote, `${f}: the selection bias must be stated`).toMatch(/NOT a held-out split/);
    }
  });
});

describe('per-category rates carry their uncertainty (EP-DATA-10)', () => {
  it('wilson matches known intervals', () => {
    expect(wilson(39, 48)).toEqual([0.681, 0.898]); // the headline is +/-11pp, not a point
    const [lo, hi] = wilson(2, 2);
    expect(lo).toBeCloseTo(0.342, 2);
    expect(hi).toBe(1);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it('small categories are flagged in the artifact', () => {
    for (const f of fs.readdirSync(RESULTS_DIR).filter((x) => x.startsWith('retrieval-'))) {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      expect(r.hit5Ci, `${f}`).toHaveLength(2);
      const cats = Object.values(r.perCategory) as { n: number; smallSample: boolean; counts: unknown }[];
      for (const c of cats) {
        if (c.n > 0 && c.n < 8) expect(c.smallSample).toBe(true);
        if (c.n > 0) expect(c.counts).toBeTruthy(); // raw k/n, not just a percentage
      }
    }
  });
});

describe('mode comparisons are testable (EP-DATA-09, EP-DATA-11)', () => {
  it('mcnemar exact p matches hand-computed values', () => {
    expect(mcnemarExact(0, 0)).toBe(1); // no discordant pairs → no evidence either way
    expect(mcnemarExact(0, 5)).toBeCloseTo(2 * 0.5 ** 5, 10); // 0.0625
    expect(mcnemarExact(5, 0)).toBeCloseTo(mcnemarExact(0, 5), 12); // symmetric
    expect(mcnemarExact(2, 10)).toBeCloseTo((2 * (1 + 12 + 66)) / 2 ** 12, 10); // 0.0386
    // the headline "+7 cases on Recall@1" (4 vs 11 discordant) is NOT significant
    expect(mcnemarExact(4, 11)).toBeGreaterThan(0.05);
    expect(mcnemarExact(1, 3)).toBeLessThanOrEqual(1);
  });

  it('a modes benchmark artifact carries per-case ranks, hit@k naming and true recall@5', () => {
    const files = fs.existsSync(BENCH_DIR) ? fs.readdirSync(BENCH_DIR).filter((f) => f.startsWith('modes-')) : [];
    const withCases = files
      .map((f) => JSON.parse(fs.readFileSync(path.join(BENCH_DIR, f), 'utf8')))
      .filter((r) => Array.isArray(r.cases));
    expect(withCases.length, 'no modes benchmark with per-case ranks — re-run npm run benchmark:retrieval-modes').toBeGreaterThan(0);
    for (const r of withCases) {
      expect(r.mcnemar.length).toBeGreaterThan(0);
      for (const m of r.modes) {
        expect(typeof m.hit5).toBe('number'); // was mislabeled recall5
        // true recall@5 can never exceed hit@5: multi-gold cases drag it down
        expect(m.recall5).toBeLessThanOrEqual(m.hit5 + 1e-12);
      }
      // the shipped configuration (no embeddings in data/index) must be a row
      expect(r.modes.map((m: { mode: string }) => m.mode)).toContain('lexical+rerank');
      const ids = new Set(r.cases.map((c: { id: string }) => c.id));
      expect(r.cases.length).toBe(ids.size * r.modes.length);
    }
  });
});

describe('pagePath canonicalisation is shared by both harnesses', () => {
  it('strips origin, /llms, .md, anchors and trailing slashes', () => {
    expect(pagePath('https://docs.liara.ir/llms/paas/nodejs/deploy.md#env')).toBe('/paas/nodejs/deploy');
    expect(pagePath('https://docs.liara.ir/paas/nodejs/deploy/')).toBe('/paas/nodejs/deploy');
  });
});
