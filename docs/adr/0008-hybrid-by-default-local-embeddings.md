# ADR 0008 — Hybrid retrieval by default, with local `multilingual-e5-small`

**Status:** Accepted (Phase I) — **supersedes [ADR 0004](0004-embedding-model.md)**

## Context

ADR 0004 made embeddings optional and defaulted the runtime to **lexical-only**,
on the reasoning that lexical already cleared the evaluation floors and that a
hosted embedding model would add cost, latency and a container dependency. Its
own *Revisit when* condition was: *"the hybrid A/B shows a specific multilingual
model materially lifts Persian Recall@k — then pin it."*

That condition **fired**. The modes benchmark
(`benchmarks/retrieval/modes-2026-08-21-9514d96-dirty.json`) measured all five
strategies on the 48 sourced eval cases with a local model and hybrid+rerank won
every metric. Rather than record the trigger, ADR 0004 was edited in place to add
the winning numbers while keeping the losing default — so the file ended up
containing the evidence that invalidated its own decision, with no status change
(panel finding `EP-DOCS-08`). Worse, the product then shipped the weakest mode it
had benchmarked while the README advertised the strongest (`EP-PRD-02`,
`EP-RET-01`).

## Decision

**Hybrid retrieval (lexical BM25 + vector cosine, fused by RRF, then the
deterministic rerank boosts) is the default.** `AI_EMBEDDINGS_MODEL` defaults to
`local:Xenova/multilingual-e5-small`, which runs **in-process via
Transformers.js** — 384-d, no API key, no provider account, no per-query spend.

Both the index side and the query side use that default, so a fresh clone that
runs `npm run index && npm run dev` gets hybrid+rerank with zero configuration.

Escape hatches, both tested (`tests/config-embeddings-default.test.ts`):

- `AI_EMBEDDINGS_MODEL=''` (explicit empty string) → lexical-only.
- `AI_EMBEDDINGS_MODEL=<provider model>` → the provider-hosted path from
  ADR 0004, which still requires a configured provider.

## Alternatives considered

- **Keep lexical as the default, hybrid opt-in** (the ADR 0004 position). Rejected:
  it means the shipped configuration is measurably the worst one we benchmarked,
  and the published headline describes a mode nobody runs. The container cost
  that justified the deferral turned out to be a dev dependency and a cached
  model download, not a service.
- **A hosted embedding model on by default.** Rejected: adds spend and a hard
  provider dependency at both index and query time for no measured gain over the
  local model on this corpus, and breaks the keyless-by-default property.
- **Vector-only.** Rejected on the evidence: it loses to lexical at hit@3
  (72.9% vs 75.0%) because exact identifiers (`DATABASE_URL`, `502`, `CNAME`) are
  exactly what dense retrieval is worst at — the original reason ADR 0002 chose
  hybrid.

## Evidence

Modes benchmark, 48 sourced cases, raw fused ranking, local
`multilingual-e5-small`:

| Mode | hit@1 | hit@3 | hit@5 | recall@5 | MRR | p95 |
|---|---:|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 75.0% | 81.3% | 71.5% | 0.601 | 38 ms |
| Lexical + rerank | 45.8% | 79.2% | 83.3% | 73.3% | 0.619 | 25 ms |
| Vector (cosine) | 58.3% | 72.9% | 81.3% | 74.7% | 0.665 | 15 ms |
| Hybrid (RRF) | 58.3% | 77.1% | 83.3% | 75.3% | 0.689 | 46 ms |
| **Hybrid + rerank** | **62.5%** | **83.3%** | **85.4%** | **77.4%** | **0.719** | 44 ms |

Significance, from the exact McNemar tests in the same artifact: lexical →
hybrid+rerank on **hit@1** is distinguishable at n=48 (p = 0.0039), as is
lexical+rerank → hybrid+rerank (p = 0.0215). **hit@5** differences are not
(p ≥ 0.62). The decision therefore rests on the hit@1/MRR lift, which is where
the user actually feels it — the top-ranked page is the one the answer is written
from.

The shipped grounding eval re-measured in this configuration
(`evals/results/retrieval-2026-08-21-84c1c71.json`): hit@1 **60.4%** (was 43.8%
lexical), hit@5 **85.4%**, MRR **0.719**, false-refusal 6.3%. Those are now the
accepted CI baseline (`evals/baseline.json`), so a silent regression back to
lexical **fails the build** — it did not before.

## Consequences

- Still **$0** at runtime: the embedder is local, so hybrid costs no API spend at
  index or query time. This is the property that made defaulting it on defensible.
- The index build embeds every chunk once (3,744 of 3,746 in the committed run)
  and caches by chunk-hash + model, so incremental rebuilds re-embed only what
  changed.
- `@xenova/transformers` becomes a real runtime dependency of the index build and
  the query path — a model download on first use and a larger container.
- Query latency rises from ~13 ms to ~24 ms p50 for the local embedding step.
  Immaterial next to model inference; it would not be if retrieval were the
  product.
- Vector spaces cannot be mixed: an index built with another model fails loudly
  rather than scoring nonsense (`tests/retrieval-panel-fixes.test.ts`).

## Trade-offs

We are pinning one open-weights model on the strength of a **48-case** eval whose
hit@5 differences are not statistically separable. The hit@1 result is, so the
choice is evidence-backed rather than assumed — but "hybrid+rerank is better" is
a claim about this corpus at this n, not a general one. A larger eval set is the
documented next step (`EP-RET-06`).

## Revisit when

- The eval set grows past ~150 cases — re-run the mode comparison and re-check
  whether the hit@5 ordering becomes distinguishable, or reverses.
- Liara's own AI API offers an embeddings endpoint with measured Persian quality:
  the provider path already exists, and keeping COGS internal would be worth a
  re-measurement (`EP-PRD-08`).
- The container size or cold-start cost of the local model becomes a deployment
  problem — at which point the trade is spend vs. size, and both numbers are
  measurable before deciding.
