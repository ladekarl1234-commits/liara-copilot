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

**Overall** (48 sourced cases + 9 gate cases):

| Metric | Value |
|---|---|
| hit@1 | 31.25% |
| hit@3 | 62.5% |
| hit@5 | 68.75% |
| MRR | 0.4729 |
| Gate accuracy | 9/9 (100%) |
| Confidence distribution | medium 49, high 8, low 0 |

**Per category** (`n` = sourced cases in that category; gate categories show
`gateN`/`gateOk` instead):

| Category | n | hit@1 | hit@3 | hit@5 | MRR | gate |
|---|---|---|---|---|---|---|
| ambiguous | — | — | — | — | — | 2/2 |
| unsupported | — | — | — | — | — | 5/5 |
| adversarial | — | — | — | — | — | 2/2 |
| incorrect-assumption | 2 | 0% | 50% | 50% | 0.50 | — |
| simple-factual | 4 | 25% | 75% | 75% | 0.50 | — |
| database | 2 | 50% | 50% | 100% | 0.625 | — |
| service-discovery | 2 | 50% | 50% | 50% | 0.50 | — |
| english | 3 | 33% | 67% | 67% | 0.44 | — |
| how-to | 6 | 0% | 50% | 67% | 0.26 | — |
| deployment-workflow | 2 | 50% | 50% | 100% | 0.625 | — |
| platform-specific | 2 | 50% | 50% | 50% | 0.50 | — |
| object-storage | 2 | 0% | 50% | 50% | 0.25 | — |
| persian | 2 | 100% | 100% | 100% | 1.00 | — |
| mixed | 2 | 0% | 50% | 50% | 0.25 | — |
| ai-api | 2 | 0% | 0% | 0% | 0.00 | — |
| troubleshooting | 6 | 67% | 67% | 67% | 0.67 | — |
| error-log | 3 | 0% | 67% | 67% | 0.28 | — |
| multi-hop | 2 | 50% | 100% | 100% | 0.75 | — |
| cross-service | 3 | 0% | 67% | 67% | 0.33 | — |
| domain-dns | 3 | 67% | 67% | 67% | 0.67 | — |

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

## Gate accuracy definition

For the 9 cases with empty `expectedSources` (ambiguous, unsupported,
adversarial), "correct" means `search()` does **not** return `confidence:
'high'` — `medium` or `low` both count, since the gate's job for these
questions is to withhold full confidence, not to hit a specific page. All 9
pass. This is checked, not assumed: `perCase[].gateOk` in the results file.

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
