# Round 3 Final — COST judge (owns Cost 25)

Commit 77eb3ff. Verified live (server :3000, aiConfigured:false, v3 index 3746 chunks).
No AI key → model-prose costs are theoretical; call-count / token-accounting / routing / degraded-latency tested from source + live.

## Verdict
No P0/P1. Round-1/2 cost P1/P2 items VERIFIED fixed. Residuals are P3/minor polish.
Cost area ~81/100 (~20/25). wouldDeduct = true (small residuals below).

## Verified fixed (re-checked, not taken on faith)
- inputTokens no longer 0: orchestrator.ts:200-201 sums answer system+user via estimateTokens. Confirmed.
- Persian-aware estimate: router.ts:44-49, Persian ch/2.2 vs latin/4. Probed: "چطور…nextjs…" (len46) → 19 tok; en "hello world" → 3. Correct direction (denser). Confirmed IN THE STREAMING ANSWER PATH ONLY.
- greeting = 0 calls: plan.ts:284 short-circuits `signals.isGreeting` → deterministic, no provider.generate. Confirmed.
- cache = 0 calls: orchestrator.ts:80-88 returns before makePlan. Confirmed.
- degraded path = 0 model calls, 0 tokens; live curl total=0.030s ttfb=0.029s.
- Prompt sizes bounded: evidence MAX_EVIDENCE_CHARS=7000 (retrieval.ts:122); plan maxTokens 700, answer 1400, verify 400. Present.

## Per-request-class model calls (source-traced)
- greeting/chitchat: 0. cache hit: 0. injection: 0. keyless degraded: 0.
- simple question (keyed): 1 plan + 1 answer (+1 verify if answer≥200 & evidence). = 2–3.
- troubleshooting/workflow: same 2–3.

## Findings

### COST-301 (P3/minor) provider.usageOf fallback still flat chars/4 — round-2 Persian fix not applied here
src/lib/ai/provider.ts:149-151. The streaming answer path got the Persian-aware estimate, but the non-streaming `provider.generate` fallback (used by the PLAN and VERIFY calls when a provider omits a usage object) still does `inChars/4`. That is the exact bug round 2 claimed to fix (Persian under-count ~40%), fixed in only one of two token-estimate sites.
Impact low: OpenAI-compatible providers return usage for non-streaming, and plan/verify prompts are English-system-prompt-heavy. But it is an incompletely applied fix and a latent inconsistency.
Fix: call the shared `estimateTokens` from usageOf instead of chars/4.

### COST-302 (P3/minor) estimatedCostUsd undefined by default — dollar cost blind out-of-box
config.ts:17-18 COST_INPUT/OUTPUT_PER_MTOK are optional with no default; router.ts:22 returns undefined when unset. So the cost dashboard logs tokens but NO USD unless the operator sets prices. Defensible (prices are provider-specific) but "cost monitoring" is partial until configured; nothing warns that prices are missing.
Fix: log once at startup that pricing is unset, or ship a documented default for the configured provider.

### COST-303 (minor, tests) no test pins the cost logic
No unit test asserts estimateTokens (Persian>latin ratio), pickAnswerRoute buckets, verify-gating, or greeting=0-calls. A silent regression of router.ts back to chars/4 would fail nothing. The round-2 Persian fix has no guarding assertion.
Fix: one tiny test: `estimateTokens(fa) > estimateTokens(sameLenLatin)` and route(high/question)==='fast', route(low)==='smart'.

### COST-304 (informational/theoretical) routing skews to smart
router.ts:12-17 `needsReasoning = troubleshooting||workflow||confidence!=='high'`. `high` is deliberately rare (round-1 title-token gate), so most substantive answer calls route to smart. With AI_MODEL_SMART unset, smartModel===fast (config.ts:57) so routing is a cosmetic no-op; with it set, cost skews to smart. Quality-preserving by design; unmeasurable keyless.

### COST-305 (informational) verify 3rd call is the main remaining cost lever
verify.ts:37-49 re-sends the full ~7000-char evidence block + up to 6000 chars of the answer on every answer≥200 chars, ~+40-50% input tokens per substantive request. Mitigated: runs on the FAST model, maxTokens 400, gated by length+evidence+abort-signal, VERIFY_CLAIMS off-switch. Deliberate grounding/quality trade — necessary enough to keep, but it is where the tokens go.

## Attacked, not broken
- inputTokens=0 regression: gone (line 200). Residual: verify/plan fallback estimate (COST-301).
- Double-billing/negative tokens: addUsage is plain sum; estimateTokens('')=0. Clean.
- Hot-path O(n): estimateTokens iterates text once/request over bounded (≤7KB evidence, ≤1400-tok answer) strings. Fine.
- Cache poisoning cost: cache stores only verified high-confidence turn-0 answers (orchestrator.ts:226), bounded 200 entries. Fine.
