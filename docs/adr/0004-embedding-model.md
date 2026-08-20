# ADR 0004 — Embeddings: optional, provider-agnostic, lexical-default

**Status:** Accepted (Phase I)

## Context

Semantic retrieval needs a multilingual embedding model with real Persian
quality. Persian embedding quality varies widely across models, and any hosted
embedding call adds latency and cost. We must not "randomly choose" a model.

## Decision

Embeddings are **optional and provider-agnostic**. The default runtime is
**lexical-only** (hybrid vector path off) because the measured lexical numbers
already clear the evaluation floors. When `AI_EMBEDDINGS_MODEL` is set, the same
`OpenAICompatibleProvider.embed()` is used (OpenRouter-/OpenAI-/Liara-AI-
compatible), vectors are cached by chunk-hash + model, and RRF fuses them with
lexical. The model string is configuration, not code.

## Alternatives considered

- **Ship a fixed hosted embedding model on by default.** Adds per-index and
  per-query cost/latency without a demonstrated retrieval win over lexical on
  this corpus.
- **Local/open-source embeddings (e.g. multilingual-e5, bge-m3).** Viable and
  cost-free at inference; deferred because they add a model runtime to the
  container and were not yet needed to pass the floors. The seam is ready.

## Evidence

- Lexical-only eval (`retrieval-2026-08-20.json`) already meets floors (hit@5
  0.813 ≥ 0.66; gate 0.923 ≥ 0.75), so embeddings are an *upgrade*, not a
  prerequisite.
- **Measured upgrade** (`benchmarks/retrieval/`, local `multilingual-e5-small`):
  adding the vector signal lifts Recall@1 from 43.8% (lexical) to 56.3% (hybrid)
  and 58.3% (hybrid+rerank), MRR 0.582 → 0.676 on the sourced eval cases — the
  model choice is now benchmarked, not assumed. `multilingual-e5-small` handles
  Persian well and runs locally (384-d, no API key).
- `embeddedCount: 0` in the shipped index meta makes the DEFAULT mode explicit
  (lexical); hybrid is opt-in via `AI_EMBEDDINGS_MODEL`.

## Consequences

Zero embedding cost by default; enabling embeddings is a config change +
`npm run index`, no code change.

## Trade-offs

Lexical-only leaves semantic recall (paraphrase, vague queries) on the table —
the documented reason to evaluate and enable a Persian-strong embedding model
next, with a hybrid vs lexical A/B on the eval set.

## Revisit when

The answers-mode/hybrid A/B shows a specific multilingual model materially lifts
Persian Recall@k — then pin it via `AI_EMBEDDINGS_MODEL` and record the result.
