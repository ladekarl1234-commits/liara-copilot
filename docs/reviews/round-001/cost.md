# Cost Judge — Round 001 (commit 67caf52)

Owned criterion: **Cost 25**. Score: **19 / 25**.

## Subcriteria
| Subcriterion | Assessment |
|---|---|
| Model calls per request class | Good: greeting/cache-hit/clarify/degraded = 0 calls; plan on cheap model; deterministic pre-classify. BUT answered request = 3 calls by default (verify default-on). |
| Prompt/context sizing | Good: evidence bounded 8 chunks / 7000 chars; summary bounded 900 chars; plan 700 / answer 1400 / verify 400 maxTokens. No whole-chat replay. |
| Caching | FAQ cache (turn-0, verified high-confidence) → 0 calls on hit. Sound. |
| Model routing | Cheap model for plan+verify; smart only for troubleshooting/workflow/non-high confidence. Sound. |
| Cost accounting / monitoring | **Broken.** Answer-call input tokens hardcoded 0; single price pair across two models; Persian output estimate off. estimatedCostUsd is a systematic undercount. |

## Findings

### COST-001 (P1, high) — Answer call input tokens recorded as 0; cost metric is a large undercount
`src/lib/agent/orchestrator.ts:168`
```
usage = addUsage(usage, { inputTokens: 0, outputTokens: Math.ceil(answer.length / 4) });
```
The streaming answer call is the most expensive of the request: its prompt is persona+rules (~1.5k chars) + full evidence block (up to `MAX_EVIDENCE_CHARS=7000`) + state. `provider.generateStream` (`provider.ts:100-136`) never sets `stream_options:{include_usage:true}` and discards everything except `delta.content`, so no real usage is available — and the orchestrator does not even estimate input from the prompt (unlike `usageOf` at `provider.ts:150`). Result: every answered request under-reports ~2000-2500 input tokens; `estimatedCostUsd` (`router.ts:25`, `orchestrator.ts:238`) omits the majority of true input cost. The "cost monitoring" pillar is undermined by its own instrumentation.
Fix: request `include_usage` and read the final usage chunk in `generateStream`; failing that, estimate input in the orchestrator from `answerSystemPrompt(...).length + message.length` via the same chars/4 heuristic.

### COST-002 (P2, high) — One price pair applied to tokens summed across two different models
`src/lib/ai/router.ts:25-32`, `orchestrator.ts:236-238`
`usage` accumulates plan (fast) + answer (smart) + verify (fast) into a single `{input,output}`, then `estimateCostUsd` multiplies by one `COST_INPUT_PER_MTOK`/`COST_OUTPUT_PER_MTOK`. If smart≠fast pricing (the usual case, and the whole point of routing), the dollar estimate is wrong regardless of token accuracy. Per-route usage is never separated in metrics.
Fix: accumulate and price usage per model, or record per-route usage in `RequestMetrics`.

### COST-003 (P2, high) — Verification default-on makes a 3rd model call on every answered request
`src/lib/config.ts:12` (`VERIFY_CLAIMS` default `'on'`), `verify.ts:24-49`
D6/D7 frame verification as "optional (+optional verification)", but the shipped default runs it on every answer ≥200 chars, re-sending the full evidence block (`evidenceBlock`, up to 7000 chars) plus the answer (up to 6000 chars) as fresh input, maxTokens 400. That is a recurring per-answer cost that roughly doubles request input tokens. It is quality-preserving (grounding) so removing it is quality-risking — but the default should be a conscious cost decision, and today the shipped value is the value everyone pays.
Fix: keep the cheap model (already done), but consider sampling (e.g. verify N% or only medium-confidence answers), or make the doc/default reflect that verify is on by default.

### COST-004 (P3, medium) — Output token estimate assumes 4 chars/token; Persian tokenizes at fewer
`orchestrator.ts:168`, `provider.ts:151`
`answer.length/4` is an English heuristic. Persian text yields far fewer chars per token, so output tokens (and thus cost) are under-estimated for the primary language. Minor next to COST-001, but same direction (undercount).

## Cleared (attacked, not broken)
- **Whole-chat replay:** `pushTurn` keeps a rolling summary capped at `MAX_SUMMARY_CHARS=900` (`sessions.ts:10,77`); no full history is resent. Not broken.
- **Oversized context:** evidence capped at 8 chunks / 7000 chars enforced from chunk #1 (`retrieval/index.ts:97-98,184-190`). Not broken.
- **Repeated embedding per request:** query embedding called once with the `qs` array (`orchestrator.ts:107-115`, `index.ts:155`). Not broken.
- **Expensive model for classification:** plan uses `planRoute()`→`AI_MODEL_FAST` (`router.ts:21`), and greetings skip the model entirely via deterministic `preClassify` (`plan.ts:180`). Not broken.
- **Zero-call paths:** cache hit, chitchat, clarify, insufficient, degraded keyless all return before any answer/verify call (`orchestrator.ts:65-145`). Verified in code.
- **Retrieval latency:** health + retrieval respond in low ms locally (curl `time_total≈0.002s`); lexical-first over 3746 chunks is cheap. Not a hot-path concern.

## Reasoning
The cost *architecture* is genuinely lazy-in-the-good-sense: deterministic gate, cheap plan model, bounded contexts, FAQ cache, lexical-first retrieval. The deduction is concentrated in the *monitoring* half of "Cost": the RequestMetrics/estimatedCostUsd pipeline cannot be trusted because the single largest input (the answer prompt) is booked at 0 tokens, and cost is priced with one rate across two models. A submission that scores on cost *observability* should not ship a cost number that is wrong by construction. COST-003 is a defensible tradeoff, not a bug, but it is a default-on recurring cost that the docs undersell.

Confidence: high on COST-001/002/003 (read directly in source). COST-004 medium (tokenizer-dependent). No live model available (aiConfigured:false) so exact token deltas are theoretical, but the input=0 booking is unconditional in code.
