# Stack Evaluation

The chosen stack is a **TypeScript + Next.js modular monolith** with **in-process
hybrid retrieval** (MiniSearch lexical + optional cosine vectors, RRF), an
**OpenRouter** LLM abstraction, and **Soniox** STT. This document shows the
alternatives considered and why the choice holds, and is explicit about what is
**measured** versus **engineering inference** versus **subjective preference** —
per the amendment, "We chose X because it is fast and scalable" is not evidence.

## Evidence classes

- **[M] Measured** — produced by a script/test in this repo (cited).
- **[I] Inference** — reasoned from documented properties; not benchmarked here.
- **[P] Preference** — team judgment, no claim of superiority.

Only in-repo, reproducible numbers are cited. Alternatives (Postgres/pgvector,
MeiliSearch, Qdrant) were **not stood up and benchmarked** here; their cells are
inference, and this is stated rather than dressed up as measurement.

## Retrieval / storage decision matrix

| Concern | In-process hybrid (chosen) | PostgreSQL + pgvector | MeiliSearch + vectors | Qdrant + lexical |
|---|---|---|---|---|
| Retrieval accuracy (this corpus) | **[M]** hybrid+rerank hit@1 62.5% vs lexical 43.8% (local e5 embeddings, `benchmarks/retrieval/`); grounding eval in the shipped hybrid+rerank config hit@1 60.4% · hit@5 85.4% · MRR 0.719 · gate 13/13 | [I] comparable lexical (tsvector/trgm); vectors need a good Persian model | [I] strong lexical; Persian tokenization needs tuning | [I] strong vector; lexical is a bolt-on |
| Persian support | **[M]** custom normalization + synonym fold at index+query | [I] needs Persian FTS config/dictionaries | [I] good, config-dependent | [I] via embeddings only |
| Retrieval latency | **[I]** in-process, no network hop (architectural; no isolated retrieval-latency benchmark committed — end-to-end mock chat p95 282 ms) | [I] + network + query planning | [I] + network round-trip | [I] + network round-trip |
| Operational complexity | **[P/I]** none — JSON files loaded in-process | [I] a managed DB + migrations | [I] a second service to run/tune | [I] a second service to run/tune |
| Horizontal scalability | **[I]** read-only index per node; rebuilt out of band | [I] shared DB scales reads well | [I] scales as its own tier | [I] scales as its own tier |
| Liara deployment fit | **[M]** one container, `output: standalone`, health 503-on-missing | [I] app + managed DB | [I] app + search service | [I] app + vector service |
| Cost | **[M]** $0 infra; $0 embeddings by default | [I] DB instance cost | [I] service cost | [I] service cost |
| Developer experience | **[P]** one language, one build, typed contracts | [I] SQL + driver + migrations | [I] index config + client | [I] client + schema |
| Maintainability | **[P]** index is a pure function of the docs commit | [I] schema/migration upkeep | [I] engine version upkeep | [I] engine version upkeep |

**Reading:** the in-process option already clears the evaluation floors **[M]**
at **zero infra cost [M]**. No alternative was shown to beat it *here*, and each
adds an operational dependency. Existing upstream MeiliSearch tooling is evidence
of feasibility, not a mandate (amendment §Do not blindly reuse MeiliSearch).
The `search()` contract makes any of these a swap if evidence later favors it.

## Application stack

| Concern | Next.js monolith (chosen) | SPA + separate API | Microservices |
|---|---|---|---|
| Build/deploy units | **[M]** 1 (standalone) | [I] 2 + CORS | [I] many + orchestration |
| Streaming SSE UX | **[M]** native (chat route) | [I] doable | [I] doable |
| Right-sized for Phase I | **[P]** yes | [P] over-split types | **[I]** stack theater (rejected) |

## LLM provider

| Concern | OpenRouter free (chosen) | Vendor SDK | Pinned single model |
|---|---|---|---|
| Vendor lock-in | **[M]** none — OpenAI-compatible wire spans OpenRouter/Liara AI/Ollama | [I] high | [I] medium |
| Cost | **[M]** free router; 0 calls on greeting/cache/keyless/injection | [I] paid | [I] free-if-free |
| Reproducibility | **[M]** actual model recorded per call (router is dynamic) | [I] stable | [I] stable |
| Testable without a key | **[M]** MockLLMProvider (load: chat 400/400 ok) | [I] usually | [I] usually |

## Voice

| Concern | Soniox STT + browser TTS (chosen) | Browser SpeechRecognition | Self-hosted Whisper (GPU) |
|---|---|---|---|
| Persian STT quality | **[I]** native Persian (vendor-documented) | **[I]** unreliable/absent, Chrome-only | [I] strong |
| Key stays server-side | **[M]** yes (route holds the key) | [I] n/a (client) | [I] yes |
| Phase-I cost/complexity | **[P]** one key, no GPU | **[P]** zero, but fails Persian | **[I]** GPU service (rejected for Phase I) |
| Graceful states/fallbacks | **[M]** 6 states + typed failures (tests) | [I] limited | [I] custom |

## Reproduce

```bash
npm run benchmark:retrieval   # writes evals/results/*.json (hit@k, MRR, gate)
LLM_MOCK=on PORT=3100 npm start &         # mock LLM, no external calls
BASE_URL=http://127.0.0.1:3100 npm run benchmark:load   # writes benchmarks/load/*.json
npm test                                  # 186 unit/integration tests
```

## Bottom line

Minimum necessary complexity for the measured quality: in-process retrieval that
already passes the floors at zero infra cost, provider abstractions that keep the
LLM and STT swappable, and a single deployable container. Every "better at scale"
alternative is behind a stable contract and is one measured win away from
adoption — none is adopted on vibes.
