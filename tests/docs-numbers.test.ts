// Mechanical guard against doc drift (EP-DOCS-10).
//
// This repo's central pitch is "only numbers produced by scripts in this repo
// appear in docs". Enforcing that by author discipline failed at least six
// times in one day of commits: EVALUATION.md published five figures the results
// artifact contradicted (EP-DATA-02), benchmarks/README.md an MRR no artifact
// supported (EP-DOCS-07), README a gate accuracy and an hit@3 from a superseded
// run. Nothing in CI compared a documented number to its evidence.
//
// So: every headline figure a doc quotes is re-derived HERE from the committed
// artifact and asserted to appear verbatim in the prose. A stale doc now fails
// `npm test` instead of surviving to the next reader.
//
// Scope, deliberately: only numbers with a committed (or CI-built) source. Prose
// claims, per-case tables and anything measured by hand stay out — a guard that
// tries to check everything gets disabled the first time it is wrong.
// ponytail: substring matching on rendered markdown, not a parser. It catches
// drift, not a number that happens to appear in an unrelated sentence.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { textFragment } from '@/lib/retrieval/index';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const newest = (dir: string, prefix: string) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .at(-1)!;

interface RetrievalResult {
  sourced: number;
  hit1: number;
  hit3: number;
  hit5: number;
  mrr: number;
  gateCases: number;
  gateAccuracy: number;
  refusalCases: number;
  refusalRecall: number;
  falseRefusalRate: number;
  balancedAccuracy: number;
  hit5Ci: [number, number];
  index: { chunkCount: number; anchorCoverage: number };
  cases: Array<{ id: string; gate?: boolean; rank: number | null }>;
}
interface ModesResult {
  modes: Array<{ mode: string; hit1: number; hit3: number; hit5: number; recall5: number; mrr: number; p50ms: number; p95ms: number }>;
  mcnemar: Array<{ a: string; b: string; metric: string; p: number }>;
}
interface LoadResult {
  scenarios: Array<{ ok: number; errors: number; throughputPerSec: number; latencyMs: { p50: number; p95: number; p99: number } }>;
}

// Docs must quote the ACCEPTED baseline, not whichever run someone left in
// evals/results last — an exploratory or dirty-worktree run is not evidence.
// evals/baseline.json names the accepted runId; that is the anchor.
const BASELINE_RUN_ID = (JSON.parse(read('evals/baseline.json')) as { runId: string }).runId;
const RETRIEVAL_FILE = `retrieval-${BASELINE_RUN_ID}.json`;
const retrieval = JSON.parse(read(path.join('evals/results', RETRIEVAL_FILE))) as RetrievalResult;
const MODES_FILE = newest('benchmarks/retrieval', 'modes-');
const modes = JSON.parse(read(path.join('benchmarks/retrieval', MODES_FILE))) as ModesResult;
const LOAD_FILE = newest('benchmarks/load', 'load-');
const load = JSON.parse(read(path.join('benchmarks/load', LOAD_FILE))) as LoadResult;

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const dp3 = (x: number) => x.toFixed(3);

/** Files that quote the shipped grounding-eval headline. */
const HEADLINE_DOCS = ['README.md', 'docs/EVALUATION.md', 'benchmarks/README.md'];

describe('published retrieval numbers match the committed artifact (EP-DATA-02, EP-DOCS-07)', () => {
  it('the accepted baseline names a results file that exists and agrees with it', () => {
    const b = JSON.parse(read('evals/baseline.json')) as { hit5: number; mrr: number; sourced: number };
    expect(retrieval.hit5).toBeCloseTo(b.hit5, 10);
    expect(retrieval.mrr).toBeCloseTo(b.mrr, 10);
    expect(retrieval.sourced).toBe(b.sourced);
  });

  it('the docs cite the accepted run by name, so a reader can find it', () => {
    for (const doc of ['docs/EVALUATION.md', 'benchmarks/README.md']) {
      expect(read(doc), doc).toContain(RETRIEVAL_FILE);
    }
  });

  for (const doc of HEADLINE_DOCS) {
    const text = read(doc);
    it(`${doc} quotes the artifact's hit@1 / hit@5 / MRR`, () => {
      expect(text).toContain(pct1(retrieval.hit1)); // 60.4%
      expect(text).toContain(pct1(retrieval.hit5)); // 85.4%
      expect(text).toContain(retrieval.mrr.toFixed(3)); // 0.719
    });

    it(`${doc} does not still carry the superseded lexical-only headline`, () => {
      // the pre-EP-PRD-02 published numbers, from a run that is no longer the
      // shipped configuration. They are legitimate as a LABELLED lexical row in
      // a modes table, which is why only the ones that never appear there are
      // checked here.
      expect(text).not.toContain('MRR 0.595');
      expect(text).not.toContain('0.5920');
      expect(text).not.toContain('hit@5 0.813');
    });
  }

  it("README's headline row carries every metric from the artifact, in one row", () => {
    // Row-scoped, not file-scoped: 60.4% also appears in the remediation table
    // further down, so a file-wide `toContain` would not notice the headline
    // going stale — which is exactly how EP-DATA-02's hit@3 survived.
    // Cell-by-cell, not substring-over-the-row: hit@3 and hit@5 are both 85.4%,
    // so a row-wide `toContain` is satisfied by the wrong column.
    const row = read('README.md')
      .split('\n')
      .find((l) => l.startsWith('| Value |'))!;
    expect(row).toBeDefined();
    const cells = row.split('|').map((c) => c.trim());
    const expected = [
      pct1(retrieval.hit1),
      pct1(retrieval.hit3),
      pct1(retrieval.hit5),
      retrieval.mrr.toFixed(3),
      `${Math.round(retrieval.gateAccuracy * retrieval.gateCases)}/${retrieval.gateCases}`,
      pct1(retrieval.falseRefusalRate),
    ];
    expected.forEach((v, i) => expect(cells[i + 2], `column ${i + 1} of the headline row`).toContain(v));
  });

  it('README and EVALUATION report gate accuracy as the artifact measured it', () => {
    const gate = `${Math.round(retrieval.gateAccuracy * retrieval.gateCases)}/${retrieval.gateCases}`;
    expect(read('README.md')).toContain(gate); // 13/13
    expect(read('docs/EVALUATION.md')).toContain(gate);
    // 0.923 was the PREVIOUS pooled gate accuracy; it must not survive as a
    // headline anywhere (EP-DATA-02 found it in three places at once).
    expect(read('README.md')).not.toContain('0.923');
    expect(read('benchmarks/README.md')).not.toContain('0.923');
  });

  it('the false-refusal rate and its CI band are quoted, not rounded away', () => {
    const readme = read('README.md');
    expect(readme).toContain(pct1(retrieval.falseRefusalRate)); // 6.3%
    expect(readme).toContain(`[${retrieval.hit5Ci[0]}, ${retrieval.hit5Ci[1]}]`);
    expect(readme).toContain(dp3(retrieval.balancedAccuracy)); // 0.969
  });

  it('EVALUATION.md names the right number of k=5 misses', () => {
    const missed = retrieval.cases.filter((c) => !c.gate && (c.rank === null || c.rank > 5));
    const evaluation = read('docs/EVALUATION.md');
    expect(evaluation).toContain(`**${missed.length}** of the ${retrieval.sourced} sourced cases`);
    // and every one of them by id, so the table cannot go stale case-by-case
    for (const c of missed) expect(evaluation).toContain(`\`${c.id}\``);
  });

  it('EVALUATION.md quotes the eval dataset counts the case files actually hold', () => {
    const dir = path.join(ROOT, 'evals', 'cases');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const cases = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Array<{ language: string; expectedSources: string[] }>);
    const gate = cases.filter((c) => c.expectedSources.length === 0).length;
    const lang = (l: string) => cases.filter((c) => c.language === l).length;
    const evaluation = read('docs/EVALUATION.md');
    expect(evaluation).toContain(`${files.length} files`);
    expect(evaluation).toContain(`**${cases.length} cases**`);
    expect(evaluation).toContain(`fa ${lang('fa')}, en ${lang('en')}, mixed ${lang('mixed')}`);
    expect(evaluation).toContain(`${gate} cases carry an empty`);
    expect(cases.length).toBe(retrieval.cases.length);
  });
});

describe('published modes-benchmark numbers match the committed artifact (EP-DATA-09/11)', () => {
  const MODE_LABEL: Record<string, string> = {
    lexical: 'Lexical (BM25)',
    'lexical+rerank': 'Lexical + rerank',
    vector: 'Vector (cosine)',
    hybrid: 'Hybrid (RRF)',
    'hybrid+rerank': 'Hybrid + rerank',
  };

  for (const doc of ['README.md', 'benchmarks/README.md', 'docs/EVALUATION.md', 'docs/adr/0008-hybrid-by-default-local-embeddings.md']) {
    it(`${doc} reproduces every mode row`, () => {
      const text = read(doc);
      for (const m of modes.modes) {
        const label = MODE_LABEL[m.mode];
        if (!text.includes(label)) continue; // a doc may quote a subset of rows
        const row = text.split('\n').find((l) => l.includes(label) && l.startsWith('|'))!;
        expect(row, `${doc}: no table row for ${label}`).toBeDefined();
        for (const v of [m.hit1, m.hit3, m.hit5, m.recall5]) expect(row).toContain(pct1(v));
        expect(row).toContain(m.mrr.toFixed(3));
      }
    });
  }

  it('the "not distinguishable at n=48" caveat quotes the real worst-case p', () => {
    const worst = Math.min(...modes.mcnemar.filter((t) => t.metric === 'hit@5').map((t) => t.p));
    const floor = (Math.floor(worst * 100) / 100).toFixed(2); // 0.62 — never round UP a p-value
    for (const doc of ['README.md', 'benchmarks/README.md', 'docs/EVALUATION.md']) {
      expect(read(doc), doc).toContain(`p ≥ ${floor}`);
    }
    // and the hit@1 result the claim actually rests on
    const decisive = modes.mcnemar.find((t) => t.metric === 'hit@1' && t.a === 'lexical' && t.b === 'hybrid+rerank')!;
    expect(read('README.md')).toContain(`p = ${decisive.p}`);
  });
});

describe('published load numbers match the committed artifact (EP-SCALE-03)', () => {
  for (const doc of ['README.md', 'benchmarks/README.md']) {
    it(`${doc} reproduces every scenario row`, () => {
      const text = read(doc);
      for (const s of load.scenarios) {
        expect(text).toContain(`${s.ok} / ${s.errors}`);
        expect(text).toContain(`${s.throughputPerSec} req/s`);
        for (const ms of [s.latencyMs.p50, s.latencyMs.p95, s.latencyMs.p99]) expect(text).toContain(`${ms} ms`);
      }
    });
  }
});

describe('citation depth is measured, not claimed (EP-PRD-06, EP-RET-09)', () => {
  // The index is gitignored; CI builds it before `npm test` (ci.yml), which is
  // the only place this assertion has to hold. Locally a fresh clone may not
  // have run `npm run index` yet — same convention as integration-realindex.
  const CHUNKS = path.join(ROOT, process.env.INDEX_DIR || path.join('data', 'index'), 'chunks.json');
  const HAS_INDEX = fs.existsSync(CHUNKS);
  if (!HAS_INDEX && process.env.CI) {
    it('requires a built index in CI (run `npm run index` before `npm test`)', () => {
      throw new Error(`${CHUNKS} not found; CI must build the index before tests`);
    });
  }
  const t = HAS_INDEX ? it : it.skip;

  t('the anchored / text-fragment / bare split is what README, RETRIEVAL.md and spec.md publish', () => {
    const chunks = JSON.parse(fs.readFileSync(CHUNKS, 'utf8')) as Array<{ anchor?: string; text: string }>;
    let anchored = 0;
    let fragment = 0;
    for (const c of chunks) {
      if (c.anchor) anchored++;
      else if (textFragment(c.text)) fragment++;
    }
    const n = chunks.length;
    const bare = n - anchored - fragment;

    // The published claim: most citations land on the paragraph, not the page.
    // A floor rather than an equality — an upstream docs move must not fail the
    // build, but a regression in the fallback must.
    expect((anchored + fragment) / n).toBeGreaterThanOrEqual(0.9);
    expect(anchored / n).toBeCloseTo(retrieval.index.anchorCoverage, 2);

    for (const doc of ['README.md', 'docs/RETRIEVAL.md', 'spec.md']) {
      const text = read(doc);
      expect(text, `${doc}: anchored share`).toContain(pct1(anchored / n));
      expect(text, `${doc}: text-fragment share`).toContain(pct1(fragment / n));
      expect(text, `${doc}: deep-linked share`).toContain(pct1((anchored + fragment) / n));
      expect(text, `${doc}: bare share`).toContain(pct1(bare / n));
    }
  });
});

describe('acceptance criteria are traceable (EP-DOCS-05)', () => {
  const spec = read('spec.md');
  const acIds = [...new Set(spec.match(/AC-[A-Z]+-\d{3}/g) ?? [])];

  it('every AC declared in §20 has a row in the §20.1 traceability table', () => {
    expect(acIds.length).toBeGreaterThan(0);
    const table = spec.slice(spec.indexOf('### 20.1'));
    for (const id of acIds) expect(table, `no traceability row for ${id}`).toContain(`| \`${id}\` |`);
  });

  it('every test file the table cites actually exists', () => {
    const cited = [...new Set(spec.match(/tests\/[\w.-]+\.test\.ts/g) ?? [])];
    expect(cited.length).toBeGreaterThan(5);
    for (const f of cited) expect(fs.existsSync(path.join(ROOT, f)), `${f} cited by spec.md does not exist`).toBe(true);
  });

  it('the table states a gap wherever a criterion is not fully proven', () => {
    // The whole point of the table: an unproven AC must be visibly different
    // from a proven one. AC-SEC-001 has no automated evidence at all and must
    // keep saying so rather than quietly acquiring a plausible-looking row.
    const row = spec.split('\n').find((l) => l.startsWith('| `AC-SEC-001` |'))!;
    expect(row).toContain('No automated evidence');
  });
});

describe('superseded ADRs are marked, not silently edited (EP-DOCS-08)', () => {
  it('ADR 0004 declares its successor and the index agrees', () => {
    const adr = read('docs/adr/0004-embedding-model.md');
    expect(adr).toMatch(/\*\*Status:\*\*.*Superseded by \[ADR 0008\]/);
    expect(read('docs/adr/README.md')).toContain('superseded by 0008');
  });

  it('ADR 0008 exists, is Accepted, and names what it supersedes', () => {
    const adr = read('docs/adr/0008-hybrid-by-default-local-embeddings.md');
    expect(adr).toMatch(/\*\*Status:\*\* Accepted.*supersedes \[ADR 0004\]/);
    expect(adr).toContain('## Revisit when');
  });
});

describe('the historical spec cannot be mistaken for the source of truth (EP-DOCS-09)', () => {
  it('specs/spec.md is banner-marked HISTORICAL and points at /spec.md', () => {
    const historical = read('specs/spec.md').slice(0, 900);
    expect(historical).toContain('HISTORICAL');
    expect(historical).toContain('spec.md');
  });

  it('DECISIONS.md D9 states the amendment against an id the source of truth defines', () => {
    const decisions = read('docs/DECISIONS.md');
    const para = decisions.slice(decisions.indexOf('Retrieval acceptance threshold amended'));
    expect(para).toContain('AC-RAG-003');
    expect(read('spec.md')).toContain('AC-RAG-003');
  });
});
