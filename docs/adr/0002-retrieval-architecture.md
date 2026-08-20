# ADR 0002 — Retrieval architecture: in-process hybrid + evidence gate

**Status:** Accepted (Phase I)

## Context

The product lives or dies on retrieval correctness over Liara docs (1,142 files
→ 3,746 chunks). Queries are Persian, English, and mixed, and include exact
identifiers (`DATABASE_URL`, `502`, `CNAME`) where pure semantic search is weak.
The answer must refuse when evidence is insufficient rather than fabricate.

## Decision

**Structural chunking → hybrid retrieval → evidence gate**, all in-process:

1. Structural chunker keeps commands attached to their explanation, preserves
   product/platform/title/heading/anchor/hash metadata.
2. **Lexical** BM25 via MiniSearch (in-memory) with Persian normalization +
   synonym folding applied identically at index and query time.
3. **Optional vector** cosine (brute-force) when an embeddings model is
   configured; fused with lexical by **Reciprocal Rank Fusion**.
4. Metadata filter + boosts (platform/product, niche down-rank).
5. **Evidence gate** (`gateConfidence`) combining informative-token coverage,
   BM25 score-per-token, fusion margin, and a title-anchored `high` tier;
   below threshold the pipeline refuses honestly (no fabricated absence).

## Alternatives considered

- **Vector-only.** Loses exact-identifier recall — the reason hybrid is required.
- **PostgreSQL + pgvector / MeiliSearch / Qdrant.** All add a network hop and an
  operational dependency. Measured retrieval on the in-process lexical index
  already reaches hit@5 0.813 / gate 0.923 on 61 cases; none of these engines
  were shown to beat that here, and each adds deployment cost. See
  `docs/STACK-EVALUATION.md`.

## Evidence

- `evals/results/retrieval-2026-08-20.json`: hit@1 0.44 · hit@3 0.75 · hit@5
  0.813 · MRR 0.592 · gate accuracy 0.923 (lexical-only lower bound).
- Retrieval runs in-process (no network hop) — an architectural property; no
  isolated retrieval-latency benchmark is committed. The dev trace
  (`/internal`) shows per-request retrieval latency at runtime.

## Consequences

Zero infra to run retrieval; the whole index is a set of JSON files rebuilt by a
script (`npm run index`) → can move to a worker without redesign.

## Trade-offs

In-memory index size scales with the corpus (fine at 3,746 chunks); a very large
corpus would push toward an external store. hit@1 0.44 lexical-only is the known
ceiling the live LLM query-rewrite + optional embeddings mitigate.

## Revisit when

Corpus outgrows memory, or evaluation shows an external hybrid engine materially
beats the in-process numbers for Persian.
