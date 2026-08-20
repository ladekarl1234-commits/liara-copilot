# Round 2 — Cost judge (Cost 25)

Commit 1c35583 · keyless server on :3000 · 3746-chunk v3 index · adversarial, from zero.

## Verification of the round-1 token-accounting fix (OBS-001/COST-001)
- **Sane, not double-counted — CONFIRMED.** orchestrator.ts:186 estimates answer
  input from `answerMessages` (system incl. evidence + `<user_data>`), separate
  from plan usage (plan.ts:295 real `res.usage`) and verify usage (verify.ts:57
  real `res.usage`). No stage is summed twice (`addUsage`, router.ts:34).
- `estimateCostUsd` emits only when both `COST_*_PER_MTOK` set — probe:
  `estimateCostUsd({1000,500})=0.00125` with 0.5/1.5 → correct; `undefined`
  when unset (default keyless). Emission path CONFIRMED.
- **But the fix still undercounts Persian ~3x — see COST-R2-03.**

## Findings

### COST-R2-01 (P2, cost-risking) Smart-model route fires on ~93% of answered queries
The documented lever "a high-confidence simple factual question always gets the
fast model" (COST.md) almost never applies. Probe: `pickAnswerRoute('question',
'medium') → smart`. Eval confidence distribution over 61 cases: **high/med/low =
3/43/15**. Low never reaches the answer call (refused at gate). So of answered
queries, ~43/46 = **93% route to AI_MODEL_SMART**. gateConfidence
(retrieval/index.ts:306-331) is *deliberately* conservative on `high` (>=70%
coverage) — the comment itself calls it "conservative". Net: the fast-answer cost
saving is inert by design. On a two-model deployment the smart bill is paid on
nearly every answer. Quality-preserving fix: allow `fast` on `medium` for
`intent==='question'` (short factual), or widen `high` calibration.

### COST-R2-02 (P2, cost-risking) FAQ cache eligible for ~5% of traffic
answerCache stores only when `intent==='question' && turns===0 &&
confidence==='high' && unsupportedCount===0` (orchestrator.ts:212). With `high`
at 3/61 (~5%), and further limited to stateless first turns, realized hit rate is
near-zero. The cache is documented as a 0-model-call class but can serve almost
nothing. Same root cause as R2-01 (everything hinges on the rare `high` state).
Direction: cache `medium` first-turn question answers too (they already passed
gate + verify), keyed identically; verify already gates correctness.

### COST-R2-03 (P2, accounting-wrong) chars/4 undercounts Persian input ~3x — hits the biggest call
The streaming answer call returns no provider usage, so input is *always*
estimated `content.length/4` (orchestrator.ts:186; same heuristic provider.ts:151).
Persian is 1 UTF-16 unit/char but BPE (cl100k/o200k) splits Persian into ~1.5-3
tokens/char. Probe: 65-char FA string → chars/4=17, utf8 bytes=111; real tokens
~40-70 → **~2.5-4x undercount**. The answer call carries the largest input (system
prompt + ≤7000-char *Persian* evidence), and it is precisely the call that is
always estimated (plan/verify get real `prompt_tokens` when the provider reports
them). So `inputTokens`/`estimatedCostUsd` systematically understate real spend
for the product's dominant language — a deploy budgeting on this metric
under-provisions. The fix upgraded 0→chars/4 (real improvement) but left the
language bias. Direction: language-aware divisor (FA ≈ chars/1.5) or count via a
real tokenizer for the estimate.

### COST-R2-04 (P3, quality-preserving) Verify re-sends the full evidence block (COST-003 still 3 calls)
verify.ts:42 sends `evidenceBlock(evidence)` for ALL ≤8 chunks (≤7000 chars),
duplicating the answer call's largest input, on the FAST model, on by default.
Typical troubleshooting/medium answer = **3 model calls** (plan+answer+verify).
Documented as D7 trade-off, but the re-send is avoidable: verify only needs the
cited chunks (`citationsFromAnswer` already knows them), not all 8. Passing only
cited evidence cuts verify input materially with no correctness loss.

### COST-R2-05 (P3, minor) Retrieval runs before the insufficient/unsupported short-circuit
orchestrator.ts:126 runs `search()` unconditionally (after chitchat/clarify),
then discards it when `plan.action==='insufficient' || intent==='unsupported'`
(line 136). Retrieval is local (~11ms measured), so cost is negligible, but the
work is pointless for plan-declared unsupported intents. Move the
insufficient/unsupported check above retrieval.

## Latency (degraded path, measured)
`POST /api/chat` Persian query, keyless: full SSE (session→context→search→
checking→citations→done) `time_total ≈ 0.009-0.012s` across 4 runs. Retrieval on
3746 chunks is sub-15ms. Model latency needs a key (theoretical). No latency
finding on the degraded/retrieval path.

## Cleared (attacked, not broken)
- Double-counting across stages: traced addUsage over plan/answer/verify — each
  distinct prompt, summed once. Not broken.
- estimatedCostUsd emission: correct arithmetic, correctly gated on env. Not broken.
- Parallelization: plan→retrieve→answer are data-dependent (retrieve needs
  plan.queries/filters; answer needs evidence). Nothing to parallelize; verify is
  post-answer by design (D7). Not a defect.
- Token caps: plan 700 / answer 1400 / verify 400, evidence ≤8 chunks ≤7000 chars,
  summary ≤900 — all hard-capped at call sites. Runaway growth bounded.
- 0-call classes (greeting/keyless/cache-hit): confirmed 0 model calls on degraded
  path via SSE trace.

Residual risk: R2-01/02 hinge on gate calibration (Answer-quality judge owns the
`high` rate); if that judge widens `high`, both cost levers activate and R2-03's
undercount becomes even more consequential on real spend.
