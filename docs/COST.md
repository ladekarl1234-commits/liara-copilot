# Cost

## Where tokens go

Three model calls exist in the pipeline, each with a hard `maxTokens` cap set
at the call site (not env-configurable — these are code constants, listed
here for the audit trail):

| Stage | File | maxTokens | temperature | Model route |
|---|---|---|---|---|
| Plan | `src/lib/agent/plan.ts` | 700 | 0 | always `AI_MODEL_FAST` |
| Answer | `src/lib/agent/orchestrator.ts` | 1400 | 0.2 | routed, see below |
| Verify | `src/lib/agent/verify.ts` | 400 | 0 | always `AI_MODEL_FAST` |

Input tokens are dominated by the evidence block (`evidenceBlock()` in
`src/lib/agent/prompts.ts`) injected into the answer and verify prompts —
bounded by the retrieval budget (`docs/RETRIEVAL.md`): ≤8 chunks, ≤7,000
chars total. The plan prompt's input is small: the state block (context
fields + ≤900-char rolling summary) plus the user message.

## Routing: fast vs. smart

`src/lib/ai/router.ts`:

```
planRoute()              -> AI_MODEL_FAST                          (always)
pickAnswerRoute(intent, confidence):
  needsReasoning = intent in {troubleshooting, workflow}
                   OR confidence != 'high'
  -> AI_MODEL_SMART if needsReasoning, else AI_MODEL_FAST
verify                   -> AI_MODEL_FAST                          (always)
```

`AI_MODEL_SMART` defaults to `AI_MODEL_FAST` when unset
(`config().smartModel`), so a single configured model works fine — the
routing distinction is purely a cost lever for deployments that configure
two different models. Only `medium`/`low`-confidence or
troubleshooting/workflow answers pay for the smart model; a `high`-
confidence simple factual question always gets the fast model.

## Caching layers

- **FAQ answer cache** (`answerCache` Map in `orchestrator.ts`, cap 200
  entries, in-memory) — keyed by `language|indexBuiltAt|normalizedKey(message)`.
  The `indexBuiltAt` component means a rebuilt index automatically
  invalidates every cached answer (stale evidence can't be served against a
  new index). Only eligible for **stateless first turns**
  (`session.turns === 0`), `intent === 'question'`, `confidence === 'high'`,
  and zero unsupported claims from verification. A cache hit skips the
  answer call and the verify call, but **not** the plan call — planning
  happens before the cache lookup, so a cache-hit turn still costs 1 model
  call, not 0 (see Request classes below).
- **Loaded index** (`globalThis.__liaraIndex` in `src/lib/retrieval/index.ts`)
  — the lexical/vector index is parsed from disk once per process and kept
  in memory (survives Next.js dev hot-reload via the `globalThis` handle);
  retrieval itself does no per-query result caching — every `search()` call
  re-scores against the in-memory index.
- **Embedding hash cache** (`data/index/embeddings.json`) — incremental by
  chunk `hash`; `scripts/build-index.ts` only embeds chunks whose hash isn't
  already cached from a prior build with the same model, so a docs update
  that changes 10 chunks re-embeds 10, not 3,630.

## Request classes

| Class | Trigger | Model calls |
|---|---|---|
| Greeting | deterministic `GREETING_RE` match | **0** — `fallbackPlan()` short-circuits before any model call |
| Keyless (no `AI_*` key) | `!config().aiConfigured` | **0** — `makePlan` returns the deterministic fallback whenever `provider` is `null`, for any message |
| Clarify | plan `action === 'clarify'` | 1 (plan only) |
| FAQ cache hit | stateless, cached, high-confidence | 1 (plan only — see caching note above) |
| Gate-failed (insufficient) | retrieval `confidence === 'low'` or empty | 1 (plan only) — retrieval runs but is free (local index) |
| Simple grounded question | `high` confidence, `question` intent | 2 (plan + fast answer), +1 if `VERIFY_CLAIMS=on` and answer ≥200 chars |
| Troubleshooting / workflow | intent match, or non-`high` confidence | 2 (plan + smart answer), +1 optional verify |

**Verification only runs** when `VERIFY_CLAIMS=on` (default), a provider is
configured, the answer is ≥200 chars, and there's at least one evidence
chunk (`src/lib/agent/verify.ts`) — a one-line canned-style answer skips
verification even with the flag on.

## Budgets

- Evidence: ≤8 chunks, ≤7,000 chars total (`MAX_EVIDENCE_CHUNKS`,
  `MAX_EVIDENCE_CHARS` in `src/lib/retrieval/index.ts`).
- Rolling session summary: ≤900 chars (`MAX_SUMMARY_CHARS` in
  `src/lib/state/sessions.ts`) — replaces full conversation history in every
  call.
- Retrieval queries per plan: ≤3, further expanded to ≤5 internally by EN→FA
  expansion (`docs/RETRIEVAL.md`), all against the free local index.
- `triedActions` ≤20, `hypotheses` ≤8, `workflow.steps` ≤12 — bounded state
  patch sizes so a runaway model output can't grow the prompt unboundedly
  turn over turn.

## Token usage recorded per request

Every request emits a `request_metrics` structured log line
(`src/lib/obs/log.ts` / `RequestMetrics` in `src/types.ts`): `inputTokens`,
`outputTokens`, `estimatedCostUsd` (only computed when
`COST_INPUT_PER_MTOK`/`COST_OUTPUT_PER_MTOK` are set —
`estimateCostUsd()` in `src/lib/ai/router.ts`), `cacheHit`, `modelRoute`,
`retrievalConfidence`, plus latency breakdown (`retrievalLatencyMs`,
`modelLatencyMs`, `totalLatencyMs`). The dev-only `/api/diag` endpoint
additionally exposes the last 20 of a 50-entry in-memory trace ring buffer
with per-request usage and retrieved-chunk scores, for local cost/quality
debugging without needing to grep logs.

## Quality trade-offs

`VERIFY_CLAIMS` defaults to `on` — an extra model call on most non-trivial
answers is accepted as a cost trade-off in favor of catching ungrounded
Liara-specific claims before the user acts on them (`docs/DECISIONS.md` D7:
"cost never above correctness" is the stated priority; the *gate* is free
and blocks the worst case — weak evidence — before any answer call happens
at all, so the paid verify call only ever runs on an answer that already had
adequate evidence).
