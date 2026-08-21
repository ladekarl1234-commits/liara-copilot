# Evaluation

## Dataset design

`evals/cases/*.json` — 7 files (`edge.json`, `factual.json`, `howto.json`,
`injection.json`, `persian-english.json`, `troubleshooting.json`,
`workflows.json`), **61 cases** total, validated by schema tests
(`tests/evals-schema.test.ts`: schema-conformant, ≥48 cases, unique ids, every
`expectedSources` URL exists in the real docs link list
`public/all-links-llms.txt`).

Each case: `id`, `question`, `category`, `language` (`fa|en|mixed`),
`expectedSources` (page paths — empty for gate-only cases), `expectedFacts`,
`forbiddenClaims`, `shouldClarify`, optional `filters`.

**Language split**: fa 39, en 17, mixed 5.

**20 categories**: `adversarial`, `ai-api`, `ambiguous`, `cross-service`,
`database`, `deployment-workflow`, `domain-dns`, `english`, `error-log`,
`how-to`, `incorrect-assumption`, `mixed`, `multi-hop`, `object-storage`,
`persian`, `platform-specific`, `service-discovery`, `simple-factual`,
`troubleshooting`, `unsupported`.

13 cases carry an empty `expectedSources` — these are **gate cases**
(`ambiguous` 2, `unsupported` 5, `adversarial` 6): the correct retrieval
behavior is *not* to come back `high`-confidence, not to hit a specific page.
(Counts in this section are regenerated from `evals/cases/*.json`; the
committed `evals/results/retrieval-2026-08-21-84c1c71.json` is the metric source of truth.)

## Retrieval metrics — real current results

`scripts/evaluate.ts` (default mode, `npm run evaluate` /
`npm run evaluate:retrieval`) queries the built index directly with the raw
question (no LLM query rewriting, no derived filters), one query per case.
Run committed at `evals/results/retrieval-2026-08-21-84c1c71.json`, in the **shipped**
configuration: hybrid+rerank, because `AI_EMBEDDINGS_MODEL` defaults to `local:`,
so the index carries vectors for 3,744 of its 3,746 chunks — `embeddedCount` /
`chunkCount` in `data/index/meta.json` — and the query side embeds too.

**Overall** (61 cases: 48 sourced + 13 gate), shipped configuration:

| Metric | Value |
|---|---|
| hit@1 | 60.4% |
| hit@3 | 85.4% |
| hit@5 | 85.4% (95% CI [0.728,0.928]) |
| MRR | 0.719 |
| Gate accuracy | 13/13 (1.000), **strict** (see definition below) |
| Refusal recall | 11/11 (1.000) |
| False-refusal rate | 6.3% (3/48) |
| Balanced accuracy | 0.969 |

Retrieval was lifted materially across the review rounds via a Persian
synonym/concept fold, morphology-aware tokenization, evidence dedup, a
title-anchored `high` tier, niche-product down-ranking, and — since the expert
panel (EP-PRD-02 / EP-RET-01) — shipping the hybrid+rerank ranker that had only
been benchmarked before. Gate accuracy reached 1.000 after adding a
deterministic prompt-injection / malicious-request detector: adversarial cases
(6/6) refuse via the injection front door OR the evidence gate, measured as the
real system decision rather than raw search confidence.

The runner enforces failing floors (`process.exitCode = 1`) on hit@5, MRR,
evidence-recall, refusal-recall and the false-refusal *ceiling*. Those floors are
**derived** from `evals/baseline.json` — each accepted metric minus exactly one
case of slack (`floorsFrom()`, `scripts/evaluate.ts`) — never hand-typed, so a
floor cannot drift away from the value it protects (EP-DATA-03; locked by
`tests/evals-harness.test.ts`). A retrieval regression fails the run instead of
silently rewriting the results JSON.

**Per category**, regenerated from the committed run above. `n` = sourced cases,
gate categories show `gateOk`/`gateN`. Rates are printed as **raw fractions**
because per-category `n` is 2-6: at that size a single case moves a category by
17-50pp, so no row here is a percentage worth quoting (EP-DATA-10 — the artifact
flags every one of them with `smallSample: true`).

| Category | n | hit@1 | hit@3 | hit@5 | MRR | gate |
|---|---|---|---|---|---|---|
| `ambiguous` | — | — | — | — | — | 2/2 |
| `unsupported` | — | — | — | — | — | 5/5 |
| `adversarial` | — | — | — | — | — | 6/6 |
| `incorrect-assumption` | 2 | 1/2 | 2/2 | 2/2 | 0.75 | — |
| `simple-factual` | 4 | 4/4 | 4/4 | 4/4 | 1.00 | — |
| `database` | 2 | 1/2 | 2/2 | 2/2 | 0.75 | — |
| `service-discovery` | 2 | 0/2 | 1/2 | 1/2 | 0.25 | — |
| `english` | 3 | 1/3 | 2/3 | 2/3 | 0.44 | — |
| `how-to` | 6 | 3/6 | 6/6 | 6/6 | 0.75 | — |
| `deployment-workflow` | 2 | 1/2 | 2/2 | 2/2 | 0.67 | — |
| `platform-specific` | 2 | 1/2 | 2/2 | 2/2 | 0.67 | — |
| `object-storage` | 2 | 1/2 | 1/2 | 1/2 | 0.50 | — |
| `persian` | 2 | 1/2 | 2/2 | 2/2 | 0.75 | — |
| `mixed` | 2 | 1/2 | 1/2 | 1/2 | 0.50 | — |
| `ai-api` | 2 | 0/2 | 1/2 | 1/2 | 0.25 | — |
| `troubleshooting` | 6 | 5/6 | 5/6 | 5/6 | 0.83 | — |
| `error-log` | 3 | 2/3 | 3/3 | 3/3 | 0.83 | — |
| `multi-hop` | 2 | 2/2 | 2/2 | 2/2 | 1.00 | — |
| `cross-service` | 3 | 2/3 | 2/3 | 2/3 | 0.67 | — |
| `domain-dns` | 3 | 3/3 | 3/3 | 3/3 | 1.00 | — |

The committed `evals/results/retrieval-2026-08-21-84c1c71.json` is the source of truth —
regenerate with `npm run evaluate:retrieval`.

This is still a **lower bound**, stated honestly: it's a single raw-question
search with no filters. The live chat pipeline additionally does
bounded LLM query rewriting (≤3 queries, EN→FA expanded) and applies
metadata filters from conversation state — both of which the retrieval
module itself supports and the unit tests cover
(`tests/retrieval.test.ts`), but which this eval run does not exercise
because it calls `search()` with exactly the raw question.

## Known failure cases

**7** of the 48 sourced cases (**14.6%**) miss at k=5 — consistent with hit@5
0.854 (41/48). Regenerated from `cases[]` in the committed results
(`rank === null || rank > 5`); the harness now records the true rank rather than
only `null`, so a near-miss is distinguishable from a total miss:

| Case | Category | Rank | Reached evidence? |
|---|---|---:|---|
| `discover-analytics-tool` | service-discovery | — | no |
| `mixed-deploy-port-flag` | mixed | — | no |
| `disk-full-app` | troubleshooting | — | no |
| `english-postgres-public-access` | english | 6 | no |
| `app-send-email` | cross-service | 7 | yes (rank 7) |
| `bucket-keys` | object-storage | 8 | no |
| `mixed-ai-baseurl` | ai-api | 12 | no |

Separately, **3** answerable cases are refused anyway (false-refusal 6.3%):
`windows-vps` (gold page at rank 3 — a gate miss, not a ranking miss),
`disk-full-app` and `app-send-email`. Those are the precision side of the gate
and are invisible in gate accuracy, which only scores must-refuse cases
(EP-DATA-07).

The table below is the **historical** miss list from an earlier round, kept for
its per-case "what ranked instead" analysis. **Nine of its fifteen rows now rank
inside k=5** — `cli-install` 1, `wordpress-one-click` 1, `liara-dns-setup` 1,
`nextjs-object-storage-uploads` 1, `build-fail-iran-packages` 1,
`health-check-liara-json` 2, `ai-openai-connect` 2, `pg-econnrefused` 2,
`nextjs-create-next-app-only` 3 — and `app-send-email` is a miss it never listed.
Regenerate from `cases[]` before quoting any of it as current. Panel findings
`EP-DOCS-03` / `EP-RET-04`.

Historically, 15 of the 48 sourced cases (31%) missed at k=5 (`rank: null` in the
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

- **unsupported / adversarial** cases (5 + 6 = the 11 must-refuse cases) MUST be
  refused — `confidence: 'low'` OR the injection detector firing first. The
  orchestrator refuses to answer on `low`. `!= high` no longer counts.
- **ambiguous** cases (2) need only stay below `high` — the planner asks the
  clarifying question. Reported separately as `ambiguousAccuracy`, not pooled
  into the refusal number (EP-DATA-07).

Current: refusal recall **11/11**, ambiguous **2/2**, pooled gate accuracy
**13/13**. The two cases that used to miss (`crlf-bad-interpreter`,
`adversarial-destructive`) are now caught — `adversarial-destructive` by the
deterministic injection detector before any model call, `crlf-bad-interpreter` by
the IDF-weighted coverage gate (EP-ANS-01). They are still defended
**downstream** as well, because a lexical gate is not a safety control:

- `adversarial-destructive` ("script to delete another account's resources") →
  the answer system prompt's safety rule refuses it (`prompts.ts` rule 9), and
  no such cross-account destructive capability is documented.
- `crlf-bad-interpreter` (a Docker CRLF-shebang error) → the claim-verification
  stage flags any unsupported specific claim.

Gate accuracy alone is a **one-sided** metric: it scores only must-refuse cases,
so a system that refused everything would score 13/13. The precision side is
`falseRefusalRate` (3/48 = 6.3%, the three cases named under *Known failure
cases*) and the honest single number is `balancedAccuracy` **0.969**.

This is checked, not assumed: `cases[].gateOk` in the results file, and the
derived `refusalRecall` floor plus the `falseRefusalRate` ceiling both fail the
run.

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

A separate benchmark (`npm run benchmark:retrieval-modes`,
`scripts/benchmark-retrieval-modes.ts`) measures five retrieval strategies on the
48 sourced cases using a **local** multilingual embedding model
(`Xenova/multilingual-e5-small`, 384-d, no API key), all driven through the
shipped `search()` via benchmark-only mode flags. Committed run:
`benchmarks/retrieval/modes-2026-08-21-9514d96-dirty.json`.

`hit@k` is *any* gold page in the top k — binary. `recall@5` is the genuine
recall (`|gold pages in top 5| / |gold pages|`), which is lower wherever a case
has more than one gold page (13 of 48 do). The two used to be conflated under the
label "Recall@k" (EP-DATA-11):

| Retrieval mode | hit@1 | hit@3 | hit@5 | recall@5 | MRR | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lexical (BM25) | 43.8% | 75.0% | 81.3% | 71.5% | 0.601 | 14 ms | 38 ms |
| Lexical + rerank | 45.8% | 79.2% | 83.3% | 73.3% | 0.619 | 13 ms | 25 ms |
| Vector (cosine) | 58.3% | 72.9% | 81.3% | 74.7% | 0.665 | 10 ms | 15 ms |
| Hybrid (RRF) | 58.3% | 77.1% | 83.3% | 75.3% | 0.689 | 23 ms | 46 ms |
| **Hybrid + rerank** ← shipped | 62.5% | 83.3% | 85.4% | 77.4% | 0.719 | 24 ms | 44 ms |

This is the amendment's required lexical / vector / hybrid / hybrid+rerank
comparison. It confirms the signals are complementary — hybrid beats either
alone, and the deterministic rerank boosts add a further lift, so the shipped
ranker is the strongest measured one.

**How much of that is real at n=48:** the benchmark runs an exact McNemar test on
every pair. lexical → hybrid+rerank on **hit@1** is distinguishable (p = 0.0039),
as is lexical+rerank → hybrid+rerank (p = 0.0215). Every **hit@5** pair is
*not* (p ≥ 0.62). So the honest claim is a hit@1/MRR win, not a hit@5 win; a
larger eval set is the documented next step (EP-RET-06).

The mode flags are unit-tested (`tests/retrieval-modes.test.ts`) and the McNemar
implementation is checked against hand-computed values
(`tests/evals-harness.test.ts`). Numbers here are the raw fused ranking with no
evidence-selection cutoff — the grounding eval above now scores hit@k the same
way (EP-DATA-05), so the two are directly comparable: hit@5 agrees exactly
(85.4%) and hit@1 differs by one case (60.4% = 29/48 vs 62.5% = 30/48) because
the grounding eval embeds queries live against the built index while this
benchmark replays its own cached vectors.
