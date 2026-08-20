# Agentic Judge — Round 001 (commit 67caf52)

Owned criterion: **Agentic & personalization — 50 pts**. Score: **30/50**.

Environment: keyless/degraded (`aiConfigured:false`). All probes run against the
deterministic path (`preClassify`/`fallbackPlan`/`applyPatch`), which is the ONLY
agentic state that functions without a model key. Hypothesis ranking, workflow
step advancement and personalization are model-only and marked theoretical.

## Subcriteria
| Subcriterion | Assessment |
|---|---|
| Intent detection | Deterministic regex is reasonable; negation/misdetection issues (AG-001). |
| Clarification (missing/extra/loop) | Repeated clarify is logged, never broken (AG-004). |
| Workflow/troubleshooting state | Correct-shape types, but INERT without a key; overwrite semantics (AG-005). |
| State persistence & staleness | Two provable staleness bugs: AG-001, AG-002. |
| Correction recovery | FAILS on negation / undetected platform (AG-001) — flagship failure. |
| Personalization (exp/pm/platform) | `experienceLine` wired, but profile.* never set deterministically → inert keyless (AG-006). |

## Findings

### AG-001 (P2, high) — Negated/undetected platform poisons context + retrieval filter forever
`src/lib/agent/plan.ts:79-94,131,202-207`, `src/lib/state/sessions.ts:52-55`.
`preClassify` matches a platform token even when the user is NEGATING it, and
there is no way to clear `context.platform`. Proven multi-turn:
```
MSG: برنامه Next.js دارم ...            detected nextjs | filters {"platform":"nextjs"} | ctx.platform nextjs
MSG: نه اشتباه شد، nextjs نیست، nuxt است  detected nextjs | filters {"platform":"nextjs"} | ctx.platform nextjs
MSG: قدم بعدی چیست؟                       detected undefined | filters {"platform":"nextjs"} | ctx.platform nextjs
```
User explicitly said "it is NOT nextjs, it's nuxt"; the classifier re-affirms
nextjs, `applyPatch` keeps it, and every topic-less follow-up (turn 3) inherits
`platform:nextjs` as a retrieval filter — narrowing docs to the wrong platform
and showing a wrong context chip. `makePlan` lines 202-207 force `signals.platform`
into `plan.filters.platform` even in model mode, so the poison reaches keyed mode
too. This is exactly the "remembers WRONG info, worse than none" scenario.
Direction: on a negation cue near a platform token, don't set it; allow the model/
deterministic layer to CLEAR `context.platform` (clean() currently strips "").

### AG-002 (P2, high) — knownError / resolved troubleshooting never cleared across topics
`src/lib/state/sessions.ts:53-70`, `src/lib/agent/prompts.ts:118,122-129`.
`applyPatch` only ever overwrites `knownError` when a NEW error arrives; nothing
deletes it on topic change or resolution. Proven:
```
MSG: connect ECONNREFUSED 5432 postgres        => knownError: connect ECONNREFUSED 5432 postgres
MSG: حالا میخوام یک دامنه برای اپ اضافه کنم      => knownError: connect ECONNREFUSED 5432 postgres
```
An unrelated domain question still carries the stale DB error into `stateBlock`,
which is injected into every future plan/answer prompt. Same for `troubleshooting`:
once `resolved=true` the chip hides (sessions.ts:86) but the whole resolved block
is still fed to the model forever. State the model sees is provably wrong; prose
harm is theoretical (needs a key).

### AG-005 (P3, high) — Agentic richness is inert in keyless mode
`src/lib/agent/plan.ts:150-167`. `fallbackPlan` emits only a `context` patch —
never `troubleshooting` or `workflow`. So in this environment "Fix" is just an
intent LABEL + retrieval, and "Guide" produces no steps. Hypothesis ranking and
step-completion recognition cannot be exercised or credited without a key.
`applyPatch` also FULL-REPLACES troubleshooting/workflow (sessions.ts:61-69): a
model that emits a partial object clobbers prior hypotheses/steps (theoretical).

### AG-003 (P3, medium) — Dead no-op
`src/lib/state/sessions.ts:64`: `if (s.troubleshooting.resolved) s.workflow = s.workflow;`
self-assignment; delete it.

### AG-004 (P3, high) — Repeated clarification detected but never broken
`src/lib/agent/orchestrator.ts:93-103`. Two clarifies in a row records a
`repeated_clarification` gap but re-emits the same clarify — no loop guard, e.g.
after N repeats fall through to insufficient/best-effort answer.

### AG-006 (P3, theoretical) — Personalization inert without a key
`src/lib/agent/prompts.ts:140-150`. `experienceLine` is wired into the answer
prompt, but `profile.experience/packageManager` are never set deterministically
(`fallbackPlan` writes no profile). Keyless, it always returns the 'intermediate'
default; personalization is entirely model-dependent. Needs a key to verify.

### AG-007 (P3, high) — Changed correction behavior is under-tested
`tests/agent-units.test.ts:39-54` tests inheritance both ways but there is NO test
for negation poisoning (AG-001) or knownError persistence (AG-002); those wrong
behaviors would pass today.

## Reasoning
The pieces that run without a key (context accumulation) contain the two defects
that matter most for a multi-turn agent, and both are in the "remembers wrong
info" family. The impressive parts (ranked hypotheses, workflow transitions,
personalization) are structurally present but deterministically inert, so they
cannot earn full agentic credit in this environment. Correction handling works
ONLY when the replacement platform is itself detectable and un-negated.
