# Evaluation

## Dataset design

`evals/cases/*.json` — 6 files (`edge.json`, `factual.json`, `howto.json`,
`persian-english.json`, `troubleshooting.json`, `workflows.json`), **57
cases** total, validated by schema tests (`tests/evals-schema.test.ts`:
schema-conformant, ≥48 cases, unique ids, every `expectedSources` URL exists
in the real docs link list `public/all-links-llms.txt`).

Each case: `id`, `question`, `category`, `language` (`fa|en|mixed`),
`expectedSources` (page paths — empty for gate-only cases), `expectedFacts`,
`forbiddenClaims`, `shouldClarify`, optional `filters`.

**Language split**: fa 37, en 15, mixed 5.

**20 categories**: `adversarial`, `ai-api`, `ambiguous`, `cross-service`,
`database`, `deployment-workflow`, `domain-dns`, `english`, `error-log`,
`how-to`, `incorrect-assumption`, `mixed`, `multi-hop`, `object-storage`,
`persian`, `platform-specific`, `service-discovery`, `simple-factual`,
`troubleshooting`, `unsupported`.

9 cases carry an empty `expectedSources` — these are **gate cases**
(`ambiguous` 2, `unsupported` 5, `adversarial` 2): the correct retrieval
behavior is *not* to come back `high`-confidence, not to hit a specific page.

## Retrieval metrics — real current results

`scripts/evaluate.ts` (default mode, `npm run evaluate` /
`npm run evaluate:retrieval`) queries the built index directly with the raw
question (no LLM query rewriting, no derived filters), one query per case.
Run committed at `evals/results/retrieval-2026-08-20.json`, lexical-only
(`embeddedCount: 0` in `data/index/meta.json` — no embeddings model was
configured for this run).

**Overall** (61 cases: 48 sourced + 13 gate), lexical-only committed run:

| Metric | Value |
|---|---|
| hit@1 | 44% |
| hit@3 | 75% |
| hit@5 | 81.3% |
| MRR | 0.592 |
| Gate accuracy | 12/13 (0.923), **strict** (see definition below) |

Retrieval was lifted materially across the review rounds via a Persian
synonym/concept fold, morphology-aware tokenization, evidence dedup, a
title-anchored `high` tier, and niche-product down-ranking. Gate accuracy rose to
0.923 after adding a deterministic prompt-injection / malicious-request detector:
adversarial cases (6/6) refuse via the injection front door OR the evidence gate,
measured as the real system decision rather than raw search confidence. The
runner enforces `hit@5 ≥ 0.66` and `gate-accuracy ≥ 0.75` as failing floors
(`process.exitCode = 1`) — a retrieval regression fails the run instead of
silently rewriting the results JSON.

**Per category** (`n` = sourced cases; gate categories show `gateOk`/`gateN`),
regenerated from the committed `evals/results/retrieval-2026-08-20.json`:

| Category | n | hit@1 | hit@3 | hit@5 | MRR | gate |
|---|---|---|---|---|---|---|
| ambiguous | — | — | — | — | — | 2/2 |
| unsupported | — | — | — | — | — | 4/5 |
| adversarial | — | — | — | — | — | 6/6 |
| incorrect-assumption | 2 | 0% | 100% | 100% | 0.42 | — |
| simple-factual | 4 | 50% | 75% | 100% | 0.69 | — |
| database | 2 | 50% | 100% | 100% | 0.67 | — |
| service-discovery | 2 | 50% | 50% | 50% | 0.50 | — |
| english | 3 | 33% | 33% | 33% | 0.33 | — |
| how-to | 6 | 17% | 67% | 83% | 0.46 | — |
| deployment-workflow | 2 | 50% | 100% | 100% | 0.75 | — |
| platform-specific | 2 | 50% | 100% | 100% | 0.67 | — |
| object-storage | 2 | 50% | 50% | 50% | 0.50 | — |
| persian | 2 | 100% | 100% | 100% | 1.00 | — |
| mixed | 2 | 0% | 50% | 50% | 0.25 | — |
| ai-api | 2 | 0% | 0% | 50% | 0.13 | — |
| troubleshooting | 6 | 67% | 67% | 67% | 0.67 | — |
| error-log | 3 | 0% | 100% | 100% | 0.44 | — |
| multi-hop | 2 | 50% | 100% | 100% | 0.67 | — |
| cross-service | 3 | 67% | 100% | 100% | 0.83 | — |
| domain-dns | 3 | 100% | 100% | 100% | 1.00 | — |

The committed `evals/results/retrieval-2026-08-20.json` is the source of truth —
regenerate with `npm run evaluate:retrieval`.

This is a **lower bound**, stated honestly: it's a single raw-question
lexical query with no filters. The live chat pipeline additionally does
bounded LLM query rewriting (≤3 queries, EN→FA expanded) and applies
metadata filters from conversation state — both of which the retrieval
module itself supports and the unit tests cover
(`tests/retrieval.test.ts`), but which this eval run does not exercise
because it calls `search()` with exactly the raw question.

## Known failure cases

15 of the 48 sourced cases (31%) miss entirely at k=5 (`rank: null` in the
results file). Named, with what the retriever returned instead:

| Case | Category | Expected | What ranked instead |
|---|---|---|---|
| `cli-install` | simple-factual | `/references/cli/install` | `create-liara-json`, docker `create-app`, `liarajson` — CLI *usage* pages outrank the CLI *install* page |
| `discover-analytics-tool` | service-discovery | `/one-click-apps/matomo/quick-start` | `/overview/about`, Sentry quick-start — "analytics" doesn't lexically match "Matomo" |
| `health-check-liara-json` | how-to | `/paas/details/health-check` | zero-downtime-deployment, Nuxt.js, Django websocket — no exact term overlap on "health check" |
| `wordpress-one-click` | how-to | `/one-click-apps/wordpress/quick-start` | Supabase quick-start, Redis quick-setup, WordPress *duplicator* how-to — the WordPress page it should have found is one rank away |
| `nextjs-create-next-app-only` | platform-specific | `/paas/nextjs/quick-start` | `deploy-app`, `use-websocket` — the quick-start page itself just isn't in the candidate set for this phrasing |
| `bucket-keys` | object-storage | `/object-storage/how-tos/create-key` | connect-via-platform (flask/django/php) — "keys" matches connection docs, not the create-key how-to |
| `english-postgres-public-access` | english | `/dbaas/postgresql/quick-setup` | connect-via-platform (nextjs/python) — same pattern |
| `mixed-deploy-port-flag` | mixed | `references/cli/deploy-app`, dotnet 502 page | generic PaaS quick-starts (liarajson, nodejs, python) |
| `mixed-ai-baseurl` | ai-api | `/ai/quick-start` | `/ai/foundations/overview`, `/ai/about`, `/ai/details/id` — the AI section is broad, quick-start doesn't lexically stand out |
| `ai-openai-connect` | ai-api | `/ai/openai`, `/ai/quick-start` | AI cookbook pages (openai-gpt-4-1, human-in-the-loop) — topically adjacent, wrong page |
| `pg-econnrefused` | error-log | `dbaas/postgresql/.../nodejs`, `paas/details/envs` | `paas/nodejs/how-tos/connect-to-db/postgresql` and siblings — the **PaaS-side** connect page ranks over the **DBaaS-side** one; same product, wrong half |
| `disk-full-app` | troubleshooting | `/paas/disks/increase-value` | upload-limit-size pages, file-system details — "disk full" and "upload limit" are lexically close but different problems |
| `build-fail-iran-packages` | troubleshooting | `/paas/details/build-location` | Go DB-connector pages — total lexical miss, no shared vocabulary |
| `nextjs-object-storage-uploads` | cross-service | object-storage connect-via-platform/create-key | email-server connect-via-platform/nextjs, paas nextjs deploy-app — "connect-via-platform/nextjs" exists for *both* object-storage and email-server; wrong product picked |
| `liara-dns-setup` | domain-dns | `/dns-management-system/quick-setup` | `dns-management-system/about`, iaas dns-challenge — right product, wrong page (about vs. quick-setup) |

Recurring pattern: near-misses (wrong page in the *same* product/section)
dominate over total-vocabulary misses. `pg-econnrefused` and
`nextjs-object-storage-uploads` are the clearest cases where the raw-query
baseline picks the wrong **product** for an identically-named how-to page
(`connect-via-platform/nextjs` exists under three different products) —
exactly the ambiguity metadata filters from conversation state (product
inferred from prior turns) are meant to resolve, and which this single-query,
filter-less eval run doesn't exercise.

## Gate accuracy definition (hardened, round 2)

The first version asserted only "not `high`" for every gate case. Review
proved that was true **by construction**: on the real corpus the pre-hardening
gate returned `medium` for essentially every query (a hardcoded `return
'medium'` would have scored 9/9 identically). The gate did not gate.

The gate was rebuilt (`exactCoverage` over stopword-filtered informative
tokens in `src/lib/retrieval/index.ts`; stopword list in
`src/lib/text/persian.ts`) and the metric made **strict**:

- **unsupported / adversarial** cases (5 + 2) MUST return `confidence: 'low'`
  — the orchestrator refuses to answer on `low`. `!= high` no longer counts.
- **ambiguous** cases (2) need only stay below `high` — the planner asks the
  clarifying question.

Current: **7/9**. The two misses (`crlf-bad-interpreter`,
`adversarial-destructive`) carry genuine Liara vocabulary and land at
informative-coverage 0.39 / 0.46 — **indistinguishable from 11 legitimate
troubleshooting cases in the same band** (measured). A purely lexical gate
cannot separate them without wrongly refusing those 11 answerable questions,
so raising the threshold would trade 2 gate wins for 11 recall losses. Those
two are defended **downstream**, not by retrieval:

- `adversarial-destructive` ("script to delete another account's resources") →
  the answer system prompt's safety rule refuses it (`prompts.ts` rule 9), and
  no such cross-account destructive capability is documented.
- `crlf-bad-interpreter` (a Docker CRLF-shebang error) → `medium` is the
  honest signal (related Docker docs exist, the exact fix doesn't); the claim-
  verification stage flags any unsupported specific claim.

This is checked, not assumed: `perCase[].gateOk` in the results file, and the
`GATE_MIN` floor fails the run below 0.75.

## Answers-mode design (LLM judge)

`scripts/evaluate.ts --answers`: hits a running server's `/api/chat` per
case, then asks the configured smart model to judge the transcript against
the case's expectations. Judge output schema:

```ts
{
  correct: boolean;              // contains expected facts, or appropriately declines
  grounded: boolean;              // no invented Liara-specific claims
  citedExpectedSource: boolean;   // a citation URL matches an expected page
  containsForbiddenClaim: boolean;
  clarifiedWhenExpected: boolean; // matches shouldClarify
  actionable: boolean;            // concrete steps/commands when a real answer was expected
  score: 0-10;
  note: string;
}
```

Run it with:

```bash
npm run dev &                          # or npm start after a build
npm run evaluate -- --answers          # optionally --limit N --category X
```

Requires `AI_BASE_URL`/`AI_API_KEY` configured (used both to serve chat
answers and to run the judge) and the server reachable at `EVAL_BASE_URL`
(default `http://localhost:3000`); exits with a nonzero code and a clear
message otherwise instead of silently producing an empty report.

**This has not been run for this submission** — no AI provider key was
configured. It is implemented and tested for schema-readiness
(`tests/evals-schema.test.ts`) but produces no committed `evals/results/
answers-*.json` yet.

## Regression strategy

`evals/cases` **is** the regression suite for retrieval quality: any index,
chunking, tokenization, or scoring change is expected to be re-run through
`npm run evaluate:retrieval` and compared against the committed baseline
above before being called an improvement. `LEXICAL_VERSION` in
`src/lib/retrieval/index.ts` exists specifically to invalidate a stale index
built with older tokenizer/MiniSearch options rather than silently
mis-scoring against it.

Unit tests lock the mechanical behaviors the eval can't isolate on its own:
`tests/ingest.test.ts` pins chunk boundaries (never splits mid-fence, correct
heading breadcrumbs, stable hash/id), `tests/persian.test.ts` pins
normalization/tokenization edge cases (ZWNJ, digit folding, technical-token
splitting), `tests/retrieval.test.ts` pins gate thresholds, the platform-
filter fallback, and the 8-chunk evidence cap. Together, tests catch
mechanical regressions and the eval catches quality regressions — neither
substitutes for the other.

## Hybrid retrieval modes (measured, local embeddings)

The grounding eval above is lexical-only as shipped. A separate benchmark
(`npm run benchmark:retrieval-modes`, `scripts/benchmark-retrieval-modes.ts`)
measures the four retrieval strategies on the 48 sourced cases using a **local**
multilingual embedding model (`Xenova/multilingual-e5-small`, 384-d, no API key),
all driven through the shipped `search()` via benchmark-only mode flags:

| Retrieval mode | Recall@1 | Recall@3 | Recall@5 | MRR | p95 |
|---|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 72.9% | 77.1% | 0.582 | 38 ms |
| Vector (cosine) | 52.1% | 72.9% | 79.2% | 0.629 | 22 ms |
| Hybrid (RRF) | 56.3% | 77.1% | 79.2% | 0.661 | 55 ms |
| Hybrid + rerank | **58.3%** | **77.1%** | **81.3%** | **0.676** | 54 ms |

This is the amendment's required lexical / vector / hybrid / hybrid+rerank
comparison. It confirms the signals are complementary — hybrid beats either
alone, and the deterministic rerank boosts add a further lift, so the shipped
ranker (hybrid+rerank when embeddings are on) is the strongest. The mode flags
are unit-tested (`tests/retrieval-modes.test.ts`); the raw JSON is committed under
`benchmarks/retrieval/`. Numbers here (raw ranking, no evidence-selection cutoff)
are not directly comparable to the grounding-eval hit@k (post evidence-selection).
