# Benchmarks

Reproducible measurements. **Only numbers produced by scripts in this repo appear
in docs** — nothing here is hand-written marketing.

```
benchmarks/
  load/       HTTP load tests (mock LLM)  — load-<date>.json
  retrieval/  lexical vs vector vs hybrid — modes-<date>-<sha>[-dirty].json
evals/
  results/    grounding eval as shipped   — retrieval-<date>-<sha>.json
  baseline.json  the ACCEPTED numbers the CI floors are derived from
```

Every filename carries the commit it was produced at, so a same-day re-run cannot
clobber the artifact a doc cites (EP-DATA-04). A `-dirty` suffix means the
worktree had uncommitted changes at run time.

## Retrieval quality

```bash
npm run benchmark:retrieval    # == evaluate:retrieval
```

Writes `evals/results/retrieval-<date>-<sha>.json`. Latest
(`retrieval-2026-08-21-7896164-dirty.json`, 61 cases, shipped hybrid+rerank config):
**hit@1 60.4% · hit@3 85.4% · hit@5 85.4% · MRR 0.719 · gate 13/13 · false-refusal 6.3%**.

The runner fails the run via exit code on hit@5, MRR, evidence-recall,
refusal-recall and a false-refusal ceiling. Those floors are **derived** from
`evals/baseline.json` — accepted value minus one case of slack — rather than
hand-typed, so they cannot drift below what they protect (EP-DATA-03).

## Hybrid retrieval modes (local embeddings)

```bash
npm run benchmark:retrieval-modes   # resumable; re-run until it prints the table + writes JSON
```

Embeds every chunk once with a **local** multilingual model
(`Xenova/multilingual-e5-small`, 384-d, Transformers.js — no API key), caches the
vectors to `.cache/retrieval-modes-embeddings.json` (gitignored; never the live `data/index/`), then drives the shipped
`search()` five ways via benchmark-only mode flags and scores the 48 sourced eval
cases. Writes `benchmarks/retrieval/modes-<date>-<sha>.json` with per-case ranks
and pairwise McNemar tests, not just aggregates (EP-DATA-09).

### Latest run (`modes-2026-08-21-9514d96-dirty.json`)

| Retrieval mode | hit@1 | hit@3 | hit@5 | recall@5 | MRR | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 75.0% | 81.3% | 71.5% | 0.601 | 14 ms | 38 ms |
| Lexical + rerank | 45.8% | 79.2% | 83.3% | 73.3% | 0.619 | 13 ms | 25 ms |
| Vector (cosine) | 58.3% | 72.9% | 81.3% | 74.7% | 0.665 | 10 ms | 15 ms |
| Hybrid (RRF) | 58.3% | 77.1% | 83.3% | 75.3% | 0.689 | 23 ms | 46 ms |
| **Hybrid + rerank** ← shipped | 62.5% | 83.3% | 85.4% | 77.4% | 0.719 | 24 ms | 44 ms |

Reading: vector and lexical are complementary (hybrid > either alone on hit@1
and MRR), and the deterministic rerank boosts add a further lift — hybrid+rerank
is the strongest on every metric. **What is statistically real at n=48:** the
exact McNemar tests in the same JSON say lexical → hybrid+rerank on **hit@1** is
distinguishable (p = 0.0039) and so is lexical+rerank → hybrid+rerank
(p = 0.0215), while **every hit@5 pair is not** (p ≥ 0.62). Quote the hit@1/MRR
lift, not the hit@5 one.

`hit@k` is binary (any gold page in the top k); `recall@5` is the genuine
`|gold in top 5| / |gold|`, lower wherever a case has several gold pages — 13 of
48 do. hit/recall/MRR are deterministic (fixed vectors + ranking); latency is a
single in-process run (includes local query-embedding for the vector/hybrid rows)
and varies run-to-run. The numbers describe the **local
`multilingual-e5-small`** model — a different configured embeddings model would
score differently. This is a retrieval-ranking benchmark, not an answer-quality one.

## Application load (mock LLM)

```bash
npm run build
LLM_MOCK=on PORT=3100 RATE_LIMIT_RPM=1000000 npm start   # deterministic mock; raise RPM so the limiter doesn't cap the run
BASE_URL=http://127.0.0.1:3100 LOAD_TOTAL=400 LOAD_CONCURRENCY=25 npm run benchmark:load
```

Writes `benchmarks/load/load-<date>.json` with date, commit, environment, config
and per-scenario `{ok, errors, successRate, throughputPerSec, latencyMs{min,p50,
p95,p99,max,mean}}`. The LLM is **mocked** — this measures HTTP transport,
retrieval, streaming, and concurrency, **not** model quality or model latency.
Do **not** report these as OpenRouter inference throughput.

### Latest run (see `load/load-2026-08-21.json` for full JSON)

Environment: win32 x64, 8 CPUs, Node v24 · 400 requests · concurrency 25 · mock LLM.

| Scenario | ok/err | throughput | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| `/api/health` | 400 / 0 | 720.7 req/s | 32 ms | 51 ms | 65 ms |
| `/api/chat` — cold (full pipeline) | 400 / 0 | 64.2 req/s | 385 ms | 418 ms | 429 ms |
| `/api/chat` — cached (0 model calls) | 400 / 0 | 596.1 req/s | 40 ms | 50 ms | 65 ms |

Percentiles are nearest-rank (`ceil(p/100·n)-1`). The **cold** row sends a unique
question per request so every turn runs the full plan→retrieve→gate→stream→verify
pipeline; the **cached** row repeats one question to measure the zero-model-call
path. The mock now returns a schema-valid plan and an answer long enough to
trigger verification, so plan parsing and the verify call are both exercised
(EP-SCALE-03) — an earlier version returned `{}`, silently collapsing to the
regex fallback and skipping verification, which made this table flattering.
Model latency is still mock, not real inference.

## Live model (separate, bounded)

Quality evaluation with a real key is intentionally **separate** from load
testing and kept small to respect free-provider quota. Because `openrouter/free`
is a dynamic router, the actual model per call is recorded (request metrics +
internal trace), never assumed.
