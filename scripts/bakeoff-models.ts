// Model bake-off against the app's REAL answer prompt and REAL retrieved
// evidence, over the committed eval cases.
//
// Why this script exists: the model was originally chosen by asking candidates
// to "Say OK". That is not the job. The job is a ~2k-token Persian evidence
// block, a strict "cite every factual sentence with [n]" instruction, and a
// language-matching requirement — and models rank COMPLETELY differently on it.
// Measured: nemotron-3-super-120b answered a realistic prompt with 0 citations
// in 13.8s while nemotron-3-nano-30b produced 5 citations in 2.2s.
//
//   npx tsx scripts/bakeoff-models.ts
//   npx tsx scripts/bakeoff-models.ts --cases 8 --repeat 2 --out benchmarks/models/<id>.json
//
// Scores per model: time-to-first-token, total, citation compliance, whether
// every [n] resolves to real evidence, language match, and refusal rate.

import fs from 'node:fs';
import path from 'node:path';
import './env';
import { search } from '@/lib/retrieval/index';
import { queryEmbedder } from '@/lib/retrieval/embed';
import { answerSystemPrompt } from '@/lib/agent/prompts';
import type { SessionState } from '@/types';

const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const N_CASES = Number(arg('cases', '8'));
const REPEAT = Number(arg('repeat', '1'));
const OUT = arg('out', '');
const KEY = process.env.OPENROUTER_API_KEY ?? '';
if (!KEY) throw new Error('OPENROUTER_API_KEY required');

const CANDIDATES = arg(
  'models',
  [
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'thinkingmachines/inkling-small:free',
    'dots-studio/dots-3-note-preview:free',
  ].join(','),
).split(',');

const ANSWER_EVIDENCE_MAX = 5;
const FA = /[؀-ۿ]/;

interface EvalCase {
  id: string;
  question: string;
  category: string;
  expectedSources?: string[];
}

function loadCases(): EvalCase[] {
  const dir = path.join('evals', 'cases');
  const all: EvalCase[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    all.push(...(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n')) as EvalCase[]));
  }
  // sourced cases only: a refusal case cannot score citation compliance
  return all.filter((c) => (c.expectedSources?.length ?? 0) > 0);
}

function blankState(lang: 'fa' | 'en'): SessionState {
  return { id: 'bakeoff', language: lang, profile: {}, context: { triedActions: [] }, summary: '', turns: 0, updatedAt: Date.now() };
}

async function callModel(model: string, system: string, user: string) {
  const t0 = Date.now();
  let ttft: number | null = null;
  let text = '';
  let err: string | null = null;
  let served = '';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 1400,
        temperature: 0.2,
        reasoning: { enabled: false },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `<user_data>\n${user}\n</user_data>` },
        ],
      }),
    });
    if (!res.ok) return { ttft: null, total: Date.now() - t0, text: '', err: `HTTP ${res.status} ${(await res.text()).slice(0, 90)}`, served };
    const rd = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (p === '[DONE]') continue;
        let j: { model?: string; choices?: { delta?: { content?: string } }[] };
        try {
          j = JSON.parse(p);
        } catch {
          continue;
        }
        if (j.model) served = j.model;
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          if (ttft === null) ttft = Date.now() - t0;
          text += d;
        }
      }
    }
  } catch (e) {
    err = String(e).slice(0, 120);
  }
  return { ttft, total: Date.now() - t0, text, err, served };
}

async function main() {
  const cases = loadCases().slice(0, N_CASES);
  const embedQuery = queryEmbedder();
  console.log(`bake-off: ${CANDIDATES.length} models x ${cases.length} cases x ${REPEAT}`);

  // Retrieve ONCE per case so every model sees byte-identical evidence —
  // otherwise a model is being scored partly on retrieval noise.
  const prepared = [];
  for (const c of cases) {
    const r = await search([c.question], {}, { embedQuery });
    const evidence = r.chunks.slice(0, ANSWER_EVIDENCE_MAX);
    const lang: 'fa' | 'en' = FA.test(c.question) ? 'fa' : 'en';
    prepared.push({ c, lang, evidence, system: answerSystemPrompt(blankState(lang), evidence) });
    process.stdout.write('.');
  }
  console.log(` evidence ready (avg system prompt ${Math.round(prepared.reduce((n, p) => n + p.system.length, 0) / prepared.length)} chars)`);

  const rows = [];
  for (const model of CANDIDATES) {
    const ttfts: number[] = [];
    const totals: number[] = [];
    let cited = 0;
    let phantom = 0;
    let langOk = 0;
    let refused = 0;
    let errors = 0;
    let n = 0;
    const samples: unknown[] = [];
    for (let rep = 0; rep < REPEAT; rep++) {
      for (const p of prepared) {
        const r = await callModel(model, p.system, p.c.question);
        n++;
        if (r.err || !r.text) {
          errors++;
          if (samples.length < 2) samples.push({ id: p.c.id, err: r.err });
          continue;
        }
        if (r.ttft != null) ttfts.push(r.ttft);
        totals.push(r.total);
        const markers = [...new Set([...r.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
        if (markers.length) cited++;
        if (markers.some((x) => x < 1 || x > p.evidence.length)) phantom++;
        if ((p.lang === 'fa') === FA.test(r.text)) langOk++;
        if (/نتوانستم|پیدا نکردم|could not find|couldn't find/i.test(r.text)) refused++;
        if (samples.length < 2) samples.push({ id: p.c.id, ttft: r.ttft, total: r.total, markers, text: r.text.slice(0, 200) });
      }
    }
    const q = (a: number[], x: number) => (a.length ? [...a].sort((i, j) => i - j)[Math.min(a.length - 1, Math.floor(x * a.length))] : null);
    const row = {
      model,
      n,
      errors,
      errorRate: +(errors / n).toFixed(3),
      ttftMs: { p50: q(ttfts, 0.5), p95: q(ttfts, 0.95) },
      totalMs: { p50: q(totals, 0.5), p95: q(totals, 0.95) },
      citationRate: +(cited / Math.max(1, n - errors)).toFixed(3),
      phantomRate: +(phantom / Math.max(1, n - errors)).toFixed(3),
      languageMatch: +(langOk / Math.max(1, n - errors)).toFixed(3),
      refusalRate: +(refused / Math.max(1, n - errors)).toFixed(3),
      samples,
    };
    rows.push(row);
    console.log(
      `${model.padEnd(42)} ttft p50=${String(row.ttftMs.p50).padStart(6)} p95=${String(row.ttftMs.p95).padStart(6)} | total p50=${String(row.totalMs.p50).padStart(6)} | cite=${row.citationRate} phantom=${row.phantomRate} lang=${row.languageMatch} err=${row.errorRate}`,
    );
  }

  // Rank: correctness first (a fast wrong answer is worthless), latency second.
  const scored = rows
    .filter((r) => r.errorRate < 0.5)
    .map((r) => ({
      ...r,
      score: +(
        r.citationRate * 0.4 +
        (1 - r.phantomRate) * 0.2 +
        r.languageMatch * 0.25 +
        (1 - Math.min(1, (r.ttftMs.p50 ?? 30_000) / 8000)) * 0.15
      ).toFixed(4),
    }))
    .sort((a, b) => b.score - a.score);
  console.log('\nranked:');
  scored.forEach((r, i) => console.log(`  ${i + 1}. ${r.model}  score=${r.score}`));

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), cases: cases.length, repeat: REPEAT, rows: scored.length ? scored : rows }, null, 2));
    console.log(`\n-> ${OUT}`);
  }
}

main();
