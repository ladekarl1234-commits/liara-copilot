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

- **Ask** — grounded answers that cite the *paragraph*, not the page (`docs.liara.ir/...#section`).
- **Fix** — support-engineer troubleshooting: diagnose → one next test → adapt (not 14 causes at once).
- **Guide** — a stateful multi-step checklist (e.g. deploy Django + PostgreSQL).

The interaction is deliberately simple. The engineering underneath is not.

> **High internal sophistication, near-zero external complexity.**

**What it deliberately cannot answer.** The corpus is the 11 product sections of `docs.liara.ir` (`paas`, `ai`, `one-click-apps`, `dbaas`, `iaas`, `email-server`, `references`, `object-storage`, `mirrors`, `dns-management-system`, `overview`) — there is **no pricing/plans page, no status or changelog feed, and no account API**. So "what does plan X cost", "is there an incident right now" and "why is *my* app down" are structurally out of reach and get an honest refusal rather than a guess. That is correct behaviour, and it is also the ceiling: the deflectable share of real support volume here is *doc-answerable questions only*, not all tickets (`EP-PRD-07`). Closing that gap means ingesting pricing/status as first-class sources and putting a `RealLiaraProvider` behind the existing seam — the roadmap below, in that order.

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

**Citation depth, measured — not claimed.** Only **36.6%** of chunks carry an authored `<Section id=…>` anchor (`anchorCoverage` in the committed eval artifact), so "deep-anchor citations" was never true of most of the corpus (`EP-PRD-06` / `EP-RET-09`). Chunks without one now cite a `#:~:text=` fragment that scrolls to and highlights the sentence the answer came from. Over the built index that is **36.6% anchored + 57.4% text-fragment = 93.9% deep-linked**; the remaining **6.1%** have no usable prose line and land at the top of the page. Both figures are re-measured from the built index on every CI run (`tests/docs-numbers.test.ts`), not transcribed once.

## 🎙 Voice

Press mic → speak → stop → see transcript → send. STT is **Soniox** (server-side key, native Persian); TTS is the browser's `SpeechSynthesis` behind an opt-in **🔊 Listen**. Both sit behind provider abstractions (`SpeechToTextProvider` / `TextToSpeechProvider`). Mic states — `idle · requesting · listening · processing · transcribed · error` — are explicit, and a mic failure never discards typed text. Details: [`docs/VOICE.md`](docs/VOICE.md) · rationale: [ADR 0006](docs/adr/0006-voice-architecture.md).

## 🧪 Evaluation & tests

Measured, reproducible — **no fabricated numbers**.

**Retrieval, as shipped** (`evals/`, 61 fixed cases, hybrid+rerank — the default configuration, no API key needed):

| Metric | hit@1 | hit@3 | hit@5 | MRR | Gate accuracy | False-refusal |
|---|---:|---:|---:|---:|---:|---:|
| Value | **60.4%** | 85.4% | **85.4%** | **0.719** | 13/13 (1.000) | **6.3%** |

hit@5 carries a 95% CI of [0.728, 0.928] — at n=48 that width is honest and reported. Refusal-recall is **11/11** (every question the docs cannot answer is refused) and balanced accuracy **0.969**. Gate accuracy alone is one-sided — a system that refused everything would also score 13/13 — so the false-refusal rate is published beside it. CI enforces floors *and* that false-refusal ceiling via exit code, so a regression fails the run. Reproduce: `npm run benchmark:retrieval`.

**Retrieval modes** — all five strategies on the 48 sourced cases, driven through the shipped `search()` with a **local** multilingual embedding model (`Xenova/multilingual-e5-small`, 384-d, no API key):

| Retrieval mode | hit@1 | hit@3 | hit@5 | recall@5 | MRR | p95 |
|---|---:|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 75.0% | 81.3% | 71.5% | 0.601 | 38 ms |
| Lexical + rerank | 45.8% | 79.2% | 83.3% | 73.3% | 0.619 | 25 ms |
| Vector (cosine) | 58.3% | 72.9% | 81.3% | 74.7% | 0.665 | 15 ms |
| Hybrid (RRF) | 58.3% | 77.1% | 83.3% | 75.3% | 0.689 | 46 ms |
| **Hybrid + rerank** ← shipped | **62.5%** | **83.3%** | **85.4%** | **77.4%** | **0.719** | 44 ms |

The signals are complementary and rerank adds a further gain, so the strongest measured mode is the one that ships. **Honesty note:** the benchmark runs McNemar tests between modes and at n=48 the *hit@5* differences are **not** statistically distinguishable (p ≥ 0.62) — the hit@1/MRR separation is the meaningful result (lexical → hybrid+rerank on hit@1: p = 0.0039), and a larger eval set is the documented next step. Numbers are model-specific. Evidence: [`benchmarks/retrieval/`](benchmarks/retrieval/) · reproduce: `npm run benchmark:retrieval-modes`.

**Tests:** `451 passed / 38 files` (`npm test`) · `npm run lint` clean (0 errors, 0 warnings) · typecheck clean · `npm run build` clean · `npm audit --omit=dev` **0 production vulnerabilities** (the local-embedding + lint tooling pulls dev-only advisories that never ship).

## 🧑‍⚖️ Independent expert review

This codebase has been put through a **15-agent independent expert panel**. Each agent owned one dimension, worked without cross-talk, and was required to verify claims against the source and back every finding with `file:line` evidence and a concrete fix — individual findings cite re-runs of the test suite, the eval and the build, plus throwaway probes against the live index. Deployment, CI/hosting and video generation were **excluded** from that round by design — it scores the software itself.

**Result: mean 75/100 across 15 dimensions · 170 findings (4 critical · 47 high · 83 medium · 36 low).**

| Dimension | Score | | Dimension | Score |
|---|---:|---|---|---:|
| Code quality & maintainability | 84 | | Reliability & error handling | 78 |
| Technical architecture | 82 | | Scalability & performance | 77 |
| UX & interaction design | 78 | | Answer quality & grounding | 73 |
| Security posture | 78 | | Product value & business viability | 73 |
| Cost efficiency | 78 | | Agentic capability | 72 |
| Documentation & claim integrity | 78 | | Retrieval / RAG pipeline | 70 |
| | | | Accessibility · Observability · Data quality | 68 |

The panel's consensus: **engineering discipline outruns proven outcomes.** The structural dimensions scored highest; the lowest clustered on *evidence of outcomes*.

### Remediation — what has been fixed since

**100 of 170 findings are closed** (plus 12 partial), including **3 of the 4 criticals** and **40 of the 47 highs** — each with a regression test. Live status for every finding: [`EXPERT-PANEL-STATUS.md`](docs/reviews/EXPERT-PANEL-STATUS.md).

| Finding | Was | Now |
|---|---|---|
| `EP-ANS-01` 🔴 gate refused answerable questions | 17% false-refusal | **6.3%**, gate accuracy held |
| `EP-RET-01` 🔴 measured hybrid gain unreachable | shipped lexical | **hybrid+rerank ships by default**, hit@1 43.8% → 60.4% |
| `EP-A11Y-01` 🔴 streaming flooded screen readers | whole answer re-announced per token | live region restructured, message id stable |
| `EP-SEC-01` 🟠 pasted secrets stored + served | verbatim in `feedback.jsonl` + `/api/diag` | redacted at every sink **and on read** |
| `EP-MAINT-01` 🟠 no quality gate | no linter at all | `npm run lint` clean, 0 warnings |
| `EP-SCALE-03` 🟠 benchmark measured a cheaper pipeline | 232 ms fiction | honest **cold 385 ms / cached 40 ms** |

Test suite grew **192 → 451**. The one critical left open is `EP-PRD-01` — end-to-end answer quality has still never been measured, because that requires a real OpenRouter key this repo does not have. It is documented, not hidden.

Nothing is hidden: the **full record**, including every score with its reasoning, all 170 issues with evidence and recommended fixes, and the overall assessment, is published in-repo.

📋 **[Expert Panel Review — scores, reasoning, assessment](docs/reviews/EXPERT-PANEL-2026-08.md)** · 🐛 **[Complete findings register (170 issues)](docs/reviews/EXPERT-PANEL-FINDINGS.md)** · 🗄 **[Raw machine-readable output](docs/reviews/expert-panel-2026-08.json)**

Earlier adversarial rounds are recorded in [`docs/reviews/`](docs/reviews/) ([convergence log](docs/reviews/CONVERGENCE.md), [final audit](docs/reviews/FINAL-AUDIT.md)).

## ⚡ Performance (mock-LLM load test)

The LLM is **mocked** (`LLM_MOCK=on`) so this measures HTTP transport, retrieval, streaming and concurrency — **not** model quality or inference latency, and it spends **zero** OpenRouter quota. Environment: win32 x64, 8 CPUs, Node v24 · 400 requests · concurrency 25.

| Scenario | ok/err | Throughput | p50 | p95 | p99 |
|---|---|---:|---:|---:|---:|
| `/api/health` | 400 / 0 | 720.7 req/s | 32 ms | 51 ms | 65 ms |
| `/api/chat` — **cold**, full pipeline | 400 / 0 | 64.2 req/s | 385 ms | 418 ms | 429 ms |
| `/api/chat` — cached (zero model calls) | 400 / 0 | 596.1 req/s | 40 ms | 50 ms | 65 ms |

The cold row uses a **unique question per request**, so every turn runs plan → retrieve → gate → stream → verify; the cached row repeats one question to exercise the zero-model-call path, which is **9.6× faster**. Both matter: the first is the honest worst case, the second is what the FAQ cache buys. (An earlier version of this table read 232 ms because the mock returned `{}` — collapsing the planner to a regex fallback and skipping verification entirely — and because repeated questions were silently served from cache. Both were panel findings, `EP-SCALE-03` and `EP-COST-02`.) Evidence: [`benchmarks/`](benchmarks/). Reproduce: `npm run benchmark:load`.

## 🔐 Security

Server-side keys only (`OPENROUTER_API_KEY`, `SONIOX_API_KEY` never reach the browser/logs) · **secret redaction** of pasted content before external inference (`API_KEY=[REDACTED]`, `postgres://user:[REDACTED]@host`) · deterministic **prompt-injection** detector + `<user_data>` fencing · per-IP rate limit + global spend backstop · streamed body caps · safe Markdown (no raw HTML sink) · hashed PII in logs. Details: [`docs/SECURITY.md`](docs/SECURITY.md).

## 💰 Cost

Generation defaults to the **OpenRouter Free Router** (`openrouter/free`, $0 on the free tier); the actual model per call is recorded because the router is dynamic. **Zero** LLM calls on greeting / cache hit / keyless / injection — and the cache now actually fires (9.6× faster path, measured above). Embeddings are **$0 too**: the default model runs locally in-process, so hybrid retrieval costs no API spend at index or query time. Details: [`docs/COST.md`](docs/COST.md).

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
| `npm test` · `npm run typecheck` · `npm run lint` | full suite (count above) · strict TS · 0 warnings |
| `npm run index` (`docs:sync` + `build-index`) | sync docs + build index (incremental, hash-based) |
| `npm run benchmark:retrieval` | retrieval eval, shipped config → `evals/results/` |
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
evals/            fixed datasets, measured results, accepted CI baseline
benchmarks/       retrieval-mode + mock-LLM load evidence (JSON)
```

## 🗺 Roadmap (next phases)

- Real Liara deployment (Docker + env/secrets + index init) — **prepared, out of Phase I**.
- Real Liara-account API (`RealLiaraProvider` behind the existing seam, per-action confirmation).
- With-key answers-mode eval + hybrid-retrieval A/B (Persian embedding model selection).

---

<div align="center">
Built for the Liara AI Copilot Challenge. Every claim here is backed by code, tests, or an ADR — never marketing language alone.
</div>
