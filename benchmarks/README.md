# Benchmarks

Reproducible measurements. **Only numbers produced by scripts in this repo appear
in docs** — nothing here is hand-written marketing.

```
benchmarks/
  load/      HTTP load tests (mock LLM) — load-<date>.json
retrieval evidence lives in evals/results/ (hit@k, MRR, gate)
```

## Retrieval quality

```bash
npm run benchmark:retrieval    # == evaluate:retrieval
```

Writes `evals/results/retrieval-<date>.json`. Latest (61 cases, lexical-only
lower bound): **hit@1 0.44 · hit@3 0.75 · hit@5 0.813 · MRR 0.595 · gate accuracy
0.923**. The runner enforces floors (hit@5 ≥ 0.66, gate ≥ 0.75) via exit code.

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

### Latest run (see `load/load-2026-08-20.json` for full JSON)

Environment: win32 x64, 8 CPUs, Node v24 · 400 requests · concurrency 25 · mock LLM.

| Scenario | ok/err | throughput | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| `/api/health` | 400 / 0 | 640 req/s | 36 ms | 52 ms | 56 ms |
| `/api/chat` (full pipeline, streamed) | 400 / 0 | 104.5 req/s | 232 ms | 282 ms | 315 ms |
| `/api/diag` | 400 / 0 | 255.3 req/s | 95 ms | 113 ms | 124 ms |

Percentiles are nearest-rank (`ceil(p/100·n)-1`). The `/api/chat` path runs the
plan→retrieve→gate→stream→verify pipeline; under the mock the plan JSON parse
falls back to the deterministic `fallbackPlan`, so retrieval + streaming are
exercised but model-JSON parsing and real model latency are not.

`/api/chat` runs the real plan→retrieve→gate→stream→verify pipeline with the mock
model, so its latency reflects retrieval + orchestration + SSE, not a network LLM.

## Live model (separate, bounded)

Quality evaluation with a real key is intentionally **separate** from load
testing and kept small to respect free-provider quota. Because `openrouter/free`
is a dynamic router, the actual model per call is recorded (request metrics +
internal trace), never assumed.
