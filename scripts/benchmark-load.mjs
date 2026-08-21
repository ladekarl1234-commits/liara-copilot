// Application load test — HTTP throughput/latency of the app plumbing with a
// DETERMINISTIC MOCK LLM (LLM_MOCK=on). It intentionally spends ZERO OpenRouter
// quota: it measures HTTP transport, retrieval, streaming and concurrency, NOT
// model quality or model latency. Run:
//
//   LLM_MOCK=on PORT=3100 npm start            # in one terminal (after npm run build)
//   BASE_URL=http://127.0.0.1:3100 npm run benchmark:load
//
// Writes machine-readable JSON to benchmarks/load/ and prints a summary.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const TOTAL = Number(process.env.LOAD_TOTAL || 300);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 20);

const QUESTIONS = [
  'چطور پروژه Next.js را روی لیارا دیپلوی کنم؟',
  'بعد از دیپلوی خطای 502 می‌گیرم، چه کنم؟',
  'How can I connect PostgreSQL to my application?',
  'تنظیم دامنه اختصاصی و CNAME چطور است؟',
  'DATABASE_URL را کجا تعریف کنم؟',
];

function pct(sorted, p) {
  if (!sorted.length) return 0;
  // nearest-rank percentile: ceil(p/100 * n) - 1, clamped to [0, n-1]
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function summarize(latencies, errors, wallMs) {
  const s = [...latencies].sort((a, b) => a - b);
  const n = s.length;
  return {
    requests: n + errors,
    ok: n,
    errors,
    successRate: +((n / (n + errors || 1)) * 100).toFixed(2),
    throughputPerSec: +(((n + errors) / (wallMs / 1000)) || 0).toFixed(1),
    latencyMs: {
      min: n ? s[0] : 0,
      p50: pct(s, 50),
      p95: pct(s, 95),
      p99: pct(s, 99),
      max: n ? s[n - 1] : 0,
      mean: n ? +(s.reduce((a, b) => a + b, 0) / n).toFixed(1) : 0,
    },
  };
}

// bounded-concurrency runner
async function run(label, makeRequest) {
  const latencies = [];
  let errors = 0;
  let issued = 0;
  const wall0 = Date.now();
  async function worker() {
    for (;;) {
      const i = issued++;
      if (i >= TOTAL) return;
      const t0 = Date.now();
      try {
        await makeRequest(i);
        latencies.push(Date.now() - t0);
      } catch {
        errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const res = summarize(latencies, errors, Date.now() - wall0);
  console.log(
    `${label.padEnd(10)} ok=${res.ok} err=${res.errors} ` +
      `rps=${res.throughputPerSec} p50=${res.latencyMs.p50}ms p95=${res.latencyMs.p95}ms p99=${res.latencyMs.p99}ms`,
  );
  return { label, ...res };
}

async function drain(res) {
  if (!res.ok) throw new Error(`status ${res.status}`);
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}

async function main() {
  // preflight: server must be up (and ideally in mock mode)
  try {
    const h = await fetch(`${BASE_URL}/api/health`);
    const body = await h.json();
    if (body.aiConfigured === false) {
      console.warn('⚠ health reports aiConfigured=false — start the server with LLM_MOCK=on so /api/chat exercises the answer path.');
    }
  } catch {
    console.error(`✗ cannot reach ${BASE_URL}/api/health. Start the server first:\n  LLM_MOCK=on PORT=3100 npm start`);
    process.exit(1);
  }

  console.log(`load test → ${BASE_URL}  (total=${TOTAL} concurrency=${CONCURRENCY})\n`);

  const scenarios = [];
  const postChat = (message) =>
    fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    }).then(drain);

  scenarios.push(await run('health', () => fetch(`${BASE_URL}/api/health`).then(drain)));

  // chat-cold: a UNIQUE question per request, so every turn runs the whole
  // pipeline (plan -> retrieve -> gate -> stream -> verify). Reusing 5 questions
  // made ~99% of requests FAQ-cache hits once EP-COST-02 widened eligibility,
  // which measured the cache rather than the product (the same measurement bug
  // EP-SCALE-03 described).
  scenarios.push(
    await run('chat-cold', (i) => postChat(`${QUESTIONS[i % QUESTIONS.length]} (نسخه ${i})`)),
  );
  // chat-cached: the same question every time — the zero-model-call path.
  scenarios.push(await run('chat-cached', () => postChat(QUESTIONS[0])));

  // /api/diag requires a bearer token in production (EP-SEC-07); without one it
  // correctly refuses, so the scenario is skipped rather than recorded as error.
  const diagToken = process.env.DIAG_TOKEN;
  if (diagToken) {
    scenarios.push(
      await run('diag', () =>
        fetch(`${BASE_URL}/api/diag`, { headers: { authorization: `Bearer ${diagToken}` } }).then(drain),
      ),
    );
  } else {
    console.log('diag       skipped (set DIAG_TOKEN to include it)');
  }

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim();
  } catch {
    /* not a git checkout */
  }

  const out = {
    date: new Date().toISOString(),
    commit,
    note: 'MOCK LLM (LLM_MOCK=on) — measures HTTP/retrieval/streaming plumbing, NOT model quality or model latency.',
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpus: os.cpus().length,
      baseUrl: BASE_URL,
    },
    config: { total: TOTAL, concurrency: CONCURRENCY },
    scenarios,
  };

  const dir = path.join(process.cwd(), 'benchmarks', 'load');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `load-${out.date.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n✓ wrote ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
