<div align="center">

# 🛰️ Liara Copilot

**An evidence-grounded AI support assistant that turns Liara's documentation into actionable help — in Persian, by text or voice.**

Ask a question, paste an error, or speak — get a grounded answer with citations to the exact docs section, or an honest *"I couldn't find this."*

`Next.js 15` · `TypeScript` · `Hybrid retrieval` · `OpenRouter` · `Soniox voice` · `Persian-first RTL`

**Status:** Phase I — fully runnable locally. No real Liara deploy / account API yet (prepared in code).

<img src="landing.png" alt="Liara Copilot — ask Liara anything" width="720">

</div>

---

## 🧠 What it does

A single, calm chat surface — *"ask Liara anything"* — that automatically infers what you need:

- **Ask** — grounded answers with deep-anchor citations (`docs.liara.ir/...#section`).
- **Fix** — support-engineer troubleshooting: diagnose → one next test → adapt (not 14 causes at once).
- **Guide** — a stateful multi-step checklist (e.g. deploy Django + PostgreSQL).

The interaction is deliberately simple. The engineering underneath is not.

> **High internal sophistication, near-zero external complexity.**

## 🏗 Architecture

```mermaid
flowchart TD
  U["User — text or 🎙 voice"] --> STT["Soniox STT (server-side)"]
  U --> C["Chat composer (Persian RTL)"]
  STT --> C
  C --> P["Plan: intent + context + query rewrite"]
  P --> RD["Redact secrets"]
  RD --> R["Hybrid retrieval"]
  R --> LEX["Lexical BM25 (MiniSearch)"]
  R --> VEC["Vector cosine (optional)"]
  LEX --> F["RRF fusion + metadata filter + boosts"]
  VEC --> F
  F --> G["Evidence gate — refuse if weak"]
  G -->|enough| LLM["OpenRouter (openrouter/free) — streamed"]
  G -->|weak| REF["Honest refusal / Fix / Guide"]
  LLM --> V["Claim verification"]
  V --> A["Grounded answer + citations + 🔊 Listen"]
```

Modular monolith, one deployable container. Full rationale in [`docs/adr/`](docs/adr/) and [`docs/STACK-EVALUATION.md`](docs/STACK-EVALUATION.md).

## 🔎 Retrieval

Official Liara docs (`liara-cloud/docs`, `public/llms/**`) → structural chunking (commands stay attached to their explanation, metadata preserved) → **hybrid** lexical BM25 + optional cosine vectors fused by **Reciprocal Rank Fusion** → metadata filter + boosts → **evidence gate**. Persian normalization (ی/ي, ک/ك, ZWNJ, digit folding) and synonym folding are applied *identically* at index and query time. Exact identifiers (`DATABASE_URL`, `502`, `CNAME`) are why retrieval is hybrid, not vector-only. Details: [`docs/RETRIEVAL.md`](docs/RETRIEVAL.md).

## 🎙 Voice

Press mic → speak → stop → see transcript → send. STT is **Soniox** (server-side key, native Persian); TTS is the browser's `SpeechSynthesis` behind an opt-in **🔊 Listen**. Both sit behind provider abstractions (`SpeechToTextProvider` / `TextToSpeechProvider`). Mic states — `idle · requesting · listening · processing · transcribed · error` — are explicit, and a mic failure never discards typed text. Details: [`docs/VOICE.md`](docs/VOICE.md) · rationale: [ADR 0006](docs/adr/0006-voice-architecture.md).

## 🧪 Evaluation & tests

Measured, reproducible — **no fabricated numbers**.

**Retrieval** (`evals/`, 61 fixed cases, lexical-only lower bound; the live pipeline adds LLM query rewriting):

| Metric | Recall@1 | Recall@3 | Recall@5 | MRR | Gate accuracy |
|---|---:|---:|---:|---:|---:|
| Value | 0.44 | 0.75 | **0.813** | 0.592 | **0.923** |

CI enforces floors (Recall@5 ≥ 0.66, gate ≥ 0.75) via exit code. Reproduce: `npm run benchmark:retrieval`.

**Hybrid retrieval modes** — the four retrieval strategies scored on the 48 sourced eval cases with a **local** multilingual embedding model (`Xenova/multilingual-e5-small`, 384-d, no API key), all driven through the shipped `search()`:

| Retrieval mode | Recall@1 | Recall@3 | Recall@5 | MRR | p95 |
|---|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 72.9% | 77.1% | 0.582 | 38 ms |
| Vector (cosine) | 52.1% | 72.9% | 79.2% | 0.629 | 22 ms |
| Hybrid (RRF) | 56.3% | 77.1% | 79.2% | 0.661 | 55 ms |
| **Hybrid + rerank** | **58.3%** | **77.1%** | **81.3%** | **0.676** | 54 ms |

Hybrid + rerank (the shipped ranker, with embeddings enabled) lifts Recall@1 from 43.8% → 58.3% and MRR 0.582 → 0.676 over pure lexical — vector and lexical signals are complementary, and reranking adds a further gain. Recall/MRR are deterministic; p95 is a single in-process run (includes local query-embedding time). Numbers are **model-specific** (local `multilingual-e5-small`); a different configured embeddings model may score differently. Evidence: [`benchmarks/retrieval/`](benchmarks/retrieval/). Reproduce: `npm run benchmark:retrieval-modes`.

**Tests:** `192 passed / 20 files` (`npm test`) · typecheck clean · `npm run build` clean · `npm audit --omit=dev` **0 production vulnerabilities** (the local-embedding benchmark tooling pulls dev-only advisories that never ship).

## ⚡ Performance (mock-LLM load test)

The LLM is **mocked** (`LLM_MOCK=on`) so this measures HTTP transport, retrieval, streaming and concurrency — **not** model quality or inference latency, and it spends **zero** OpenRouter quota. Environment: win32 x64, 8 CPUs, Node v24 · 400 requests · concurrency 25.

| Scenario | ok/err | Throughput | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| `/api/health` | 400 / 0 | 640 req/s | 36 ms | 52 ms | 56 ms |
| `/api/chat` (full pipeline, streamed) | 400 / 0 | 104.5 req/s | 232 ms | 282 ms | 315 ms |
| `/api/diag` | 400 / 0 | 255.3 req/s | 95 ms | 113 ms | 124 ms |

Evidence: [`benchmarks/`](benchmarks/). Reproduce: `npm run benchmark:load`.

## 🔐 Security

Server-side keys only (`OPENROUTER_API_KEY`, `SONIOX_API_KEY` never reach the browser/logs) · **secret redaction** of pasted content before external inference (`API_KEY=[REDACTED]`, `postgres://user:[REDACTED]@host`) · deterministic **prompt-injection** detector + `<user_data>` fencing · per-IP rate limit + global spend backstop · streamed body caps · safe Markdown (no raw HTML sink) · hashed PII in logs. Details: [`docs/SECURITY.md`](docs/SECURITY.md).

## 💰 Cost

Generation defaults to the **OpenRouter Free Router** (`openrouter/free`, $0 on the free tier); the actual model per call is recorded because the router is dynamic. **Zero** LLM calls on greeting / cache hit / keyless / injection. Embeddings are off by default (lexical-only), so indexing is $0 unless enabled. Details: [`docs/COST.md`](docs/COST.md).

## 📈 Scalability

Stateless app processes; externalizable session/rate/cache stores (in-memory now, Keyv/Redis behind the same functions later); the index is a read-only artifact rebuilt out of band (can become a worker); provider abstractions for LLM/STT/cache/Liara-API. Expected first bottleneck: external LLM latency/quota, then the single-instance in-memory stores. Honest scaling model — not "infinitely scalable." Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 🚀 Running locally

```bash
npm install
npm run index            # sync Liara docs + build the search index (data/index/)
cp .env.example .env     # add OPENROUTER_API_KEY (and SONIOX_API_KEY for voice)
npm run dev              # http://localhost:3000
```

Runs **keyless** too (grounded source listings, Fix/Guide visible, zero model calls). For a no-key end-to-end answer path, set `LLM_MOCK=on`. Internal diagnostics: `/internal` (dev, or `DIAG_ENABLED=on`).

### Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | develop / production build / serve |
| `npm test` · `npm run typecheck` | 192 tests · strict TS |
| `npm run index` (`docs:sync` + `build-index`) | sync docs + build index (incremental, hash-based) |
| `npm run benchmark:retrieval` | retrieval eval (lexical) → `evals/results/` |
| `npm run benchmark:retrieval-modes` | lexical vs vector vs hybrid vs hybrid+rerank (local embeddings) → `benchmarks/retrieval/` |
| `npm run benchmark:load` | mock-LLM HTTP load test → `benchmarks/load/` |

## 🗂 Repository structure

```
spec.md                     product + engineering source of truth (AC-* criteria)
src/
  app/            routes: / (chat), /internal (diagnostics), api/{chat,voice,health,diag,feedback}
  components/     Chat, useChat, useVoice, useTts, Sources, Markdown, ...
  lib/
    retrieval/    chunking, hybrid search, RRF, evidence gate
    ai/           ModelProvider (OpenRouter) + MockLLMProvider + routing
    speech/       SpeechToTextProvider → Soniox (server-side)
    agent/        plan → orchestrate → prompts → verify
    security/     injection detection, redaction, rate limit, validation
    state/ obs/   sessions, logs, traces, gaps
    liara/        LiaraProvider seam + MockLiaraProvider (future API)
docs/             ARCHITECTURE, RETRIEVAL, EVALUATION, SECURITY, COST, DESIGN, VOICE, DEPLOYMENT, STACK-EVALUATION, adr/
evals/            fixed datasets + measured results
benchmarks/       load-test evidence (JSON)
```

## 🗺 Roadmap (next phases)

- Real Liara deployment (Docker + env/secrets + index init) — **prepared, out of Phase I**.
- Real Liara-account API (`RealLiaraProvider` behind the existing seam, per-action confirmation).
- With-key answers-mode eval + hybrid-retrieval A/B (Persian embedding model selection).

---

<div align="center">
Built for the Liara AI Copilot Challenge. Every claim here is backed by code, tests, or an ADR — never marketing language alone.
</div>
