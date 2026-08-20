// Evaluation runner.
//   npx tsx scripts/evaluate.ts --retrieval-only          # retrieval metrics (default mode)
//   npx tsx scripts/evaluate.ts --answers [--limit N] [--category X]
// Retrieval mode needs only the built index. Answers mode needs a running
// server (/api/chat) plus a configured AI provider for the LLM judge.
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { loadIndex, search } from '../src/lib/retrieval/index';
import { config } from '../src/lib/config';
import { OpenAICompatibleProvider } from '../src/lib/ai/provider';
import type { RetrievalFilters } from '../src/types';

interface EvalCase {
  id: string;
  question: string;
  category: string;
  language: 'fa' | 'en' | 'mixed';
  expectedSources: string[];
  expectedFacts: string[];
  forbiddenClaims: string[];
  shouldClarify: boolean;
  filters?: RetrievalFilters;
}

const CASES_DIR = path.join('evals', 'cases');
const RESULTS_DIR = path.join('evals', 'results');

function loadCases(): EvalCase[] {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const all: EvalCase[] = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(CASES_DIR, f), 'utf8').replace(/\r\n?/g, '\n');
    all.push(...(JSON.parse(raw) as EvalCase[]));
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

function writeResult(name: string, data: unknown) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${name}-${today()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\nresults written to ${file}`);
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : '-';
}

// ---------------- retrieval mode ----------------

interface CatAgg {
  n: number;
  hit1: number;
  hit3: number;
  hit5: number;
  mrrSum: number;
  gateN: number;
  gateOk: number;
  confidence: Record<string, number>;
}

async function runRetrieval(cases: EvalCase[]) {
  const idx = loadIndex();
  const perCat = new Map<string, CatAgg>();
  const agg = (cat: string): CatAgg => {
    let a = perCat.get(cat);
    if (!a) {
      a = { n: 0, hit1: 0, hit3: 0, hit5: 0, mrrSum: 0, gateN: 0, gateOk: 0, confidence: {} };
      perCat.set(cat, a);
    }
    return a;
  };
  const perCase: object[] = [];

  for (const c of cases) {
    const res = await search([c.question], c.filters ?? {}, {}, idx);
    const a = agg(c.category);
    a.confidence[res.confidence] = (a.confidence[res.confidence] ?? 0) + 1;

    if (!c.expectedSources.length) {
      // gate case: unsupported/ambiguous questions should not come back 'high'
      a.gateN++;
      const ok = res.confidence !== 'high';
      if (ok) a.gateOk++;
      perCase.push({ id: c.id, category: c.category, gate: true, confidence: res.confidence, gateOk: ok });
      continue;
    }

    const expected = new Set(c.expectedSources.map(pagePath));
    const pages: string[] = [];
    for (const s of res.chunks) {
      const p = pagePath(s.chunk.url);
      if (!pages.includes(p)) pages.push(p);
    }
    const rank = pages.findIndex((p) => expected.has(p)) + 1; // 0 = miss
    a.n++;
    if (rank >= 1 && rank <= 1) a.hit1++;
    if (rank >= 1 && rank <= 3) a.hit3++;
    if (rank >= 1 && rank <= 5) a.hit5++;
    a.mrrSum += rank >= 1 && rank <= 5 ? 1 / rank : 0;
    perCase.push({
      id: c.id,
      category: c.category,
      rank: rank || null,
      confidence: res.confidence,
      topPages: pages.slice(0, 5),
      expected: [...expected],
    });
  }

  // table
  const rows: string[][] = [['category', 'n', 'hit@1', 'hit@3', 'hit@5', 'MRR', 'gate', 'conf h/m/l']];
  const overall: CatAgg = { n: 0, hit1: 0, hit3: 0, hit5: 0, mrrSum: 0, gateN: 0, gateOk: 0, confidence: {} };
  for (const [cat, a] of [...perCat.entries()].sort()) {
    overall.n += a.n;
    overall.hit1 += a.hit1;
    overall.hit3 += a.hit3;
    overall.hit5 += a.hit5;
    overall.mrrSum += a.mrrSum;
    overall.gateN += a.gateN;
    overall.gateOk += a.gateOk;
    for (const [k, v] of Object.entries(a.confidence)) overall.confidence[k] = (overall.confidence[k] ?? 0) + v;
    rows.push(row(cat, a));
  }
  rows.push(row('OVERALL', overall));
  printTable(rows);

  const summary = {
    date: today(),
    total: cases.length,
    sourced: overall.n,
    hit1: overall.n ? overall.hit1 / overall.n : 0,
    hit3: overall.n ? overall.hit3 / overall.n : 0,
    hit5: overall.n ? overall.hit5 / overall.n : 0,
    mrr: overall.n ? overall.mrrSum / overall.n : 0,
    gateCases: overall.gateN,
    gateAccuracy: overall.gateN ? overall.gateOk / overall.gateN : null,
    confidence: overall.confidence,
    perCategory: Object.fromEntries(
      [...perCat.entries()].map(([k, a]) => [
        k,
        {
          n: a.n,
          hit1: a.n ? a.hit1 / a.n : null,
          hit3: a.n ? a.hit3 / a.n : null,
          hit5: a.n ? a.hit5 / a.n : null,
          mrr: a.n ? a.mrrSum / a.n : null,
          gateN: a.gateN,
          gateOk: a.gateOk,
          confidence: a.confidence,
        },
      ]),
    ),
    cases: perCase,
  };
  writeResult('retrieval', summary);
  console.log(
    `\noverall hit@5=${summary.hit5.toFixed(3)} MRR=${summary.mrr.toFixed(3)} gate-accuracy=${summary.gateAccuracy?.toFixed(3) ?? 'n/a'}`,
  );

  function row(name: string, a: CatAgg): string[] {
    return [
      name,
      String(a.n + a.gateN),
      pct(a.hit1, a.n),
      pct(a.hit3, a.n),
      pct(a.hit5, a.n),
      a.n ? (a.mrrSum / a.n).toFixed(2) : '-',
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

  const summary = {
    date: today(),
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
  writeResult('answers', summary);
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
  else await runRetrieval(cases);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
