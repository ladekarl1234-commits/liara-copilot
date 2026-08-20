# Architecture & Maintainability Review — round 001

Commit: 67caf52 · Judge: ARCHITECTURE · Owned criterion: Maintainability (cross-cutting)
Typecheck: `tsc --noEmit` -> EXIT 0. Largest source file 378 lines. Deps: 8 runtime, all justified.

## Score (Maintainability, cross-cutting) — 82/100

| Sub-area | Assessment |
|---|---|
| File size / factoring | Strong. Largest file 378 LOC; clean module boundaries. |
| Dependency hygiene | Strong. minisearch/next/react/react-markdown/rehype-highlight/remark-gfm/zod — no sprawl. |
| Provider swappability | Good. `ModelProvider` interface + `OpenAICompatibleProvider`; router isolates model choice. |
| Global/module state | Acceptable. 3 module-level LRU maps + `globalThis.__liaraIndex`, each with reset hooks + documented single-instance ceiling. Eviction loop duplicated 3x. |
| Type safety at boundaries | Mixed. zod at every trust boundary, but `parsed.data as AgentPlan` bridges a hand-maintained schema/interface pair the compiler cannot keep in sync. |
| Dead / speculative code | Weakest area. Entire Liara-provider subsystem shipped + tested but unwired; duplicated inheritance logic; no-op self-assignment. |

## Findings

### ARCH-001 (P2) Duplicated, already-divergent platform-inheritance logic
`src/lib/agent/plan.ts:148-149` (fallbackPlan) and `:203-205` (makePlan) both encode the
"inherit session platform only when this message has no topic of its own" rule — and they are
already NOT identical (fallback keys off `state.context.platform` directly; makePlan additionally
gates on `plan.filters.product`). Two copies of one non-trivial rule that must stay in sync is a
classic rot site: a future fix to one path silently leaves the other wrong.

### ARCH-002 (P3) Speculative Liara-provider subsystem: dead, one-impl interface, test-the-mock
`src/types.ts:167-175` (9-method `LiaraProvider`), `src/lib/liara/mock.ts` (109 LOC), and
`getLiaraProvider()` are consumed by NOTHING in the runtime pipeline — grep for `getLiaraProvider`
outside mock.ts returns only docs and `tests/mock-liara.test.ts`. DECISIONS.md D10 confirms it is
"deliberately NOT wired into answers." So the codebase ships an interface with a single
implementation plus a 57-line test suite that asserts a mock returns fake data (`tests/mock-liara.test.ts:7-30`)
and that method names start with `get` (`:34-38`) — testing the mock, not any product behavior.
Fake timestamps are already dated 2026-08 with no consumer to keep them honest. Premature
abstraction (ponytail ladder rung 1: speculative need) that will rot.

### ARCH-003 (P3) No-op self-assignment masquerading as logic
`src/lib/state/sessions.ts:64`: `if (s.troubleshooting.resolved) s.workflow = s.workflow; // no-op`.
A guarded self-assignment does nothing. It reads as intent ("do something to workflow on resolve")
and the next maintainer will either delete it or waste time deciding it was meant to clear the
workflow. Delete it.

### ARCH-004 (P3) Weak type seam: schema/interface bridged by a cast
`src/lib/agent/plan.ts:197` `const plan = parsed.data as AgentPlan;` (and `:160` `as SessionState['context']`).
`PlanSchema` (runtime, plan.ts:11-75) and `AgentPlan` (compile-time, types.ts:107-118) are maintained
by hand in parallel; the `as` cast means a drift between them (e.g. adding an AgentPlan field, or a
zod `.optional()` mismatch) is not caught by the compiler. Prefer `z.infer` as the source of truth or
a `satisfies` check so the two cannot silently diverge.

### ARCH-005 (P3) Dead return field + duplicated eviction loops
`makePlan` returns `{ plan, usage, route }` (plan.ts:177/209) but the sole caller
(orchestrator.ts:76) reads only `.plan`/`.usage`; `route` is dead. Separately, the
`while (map.size > MAX) map.delete(map.keys().next().value)` eviction idiom is re-implemented in
three places (orchestrator answerCache/lastAction, sessions store) — one small `lruSet` helper
would remove the triplication.

## Reasoning

This is a genuinely small, well-factored modular monolith, not architectural theater in the core
pipeline: retrieval, orchestrator, provider, config, validation each own one concern and code
against `src/types.ts`. The provider IS swappable and the OpenAI-compatible seam is real. Deps are
lean and typecheck is clean. The maintainability cost is concentrated in (a) one duplicated business
rule that is already drifting (ARCH-001, the only one with real behavioral cost) and (b) a shipped-
but-unwired Liara-provider subsystem that inflates surface area and test count without exercising any
product path. None of these are blocking; the highest-cost item is ARCH-001.

## Attacked-and-cleared
- Giant files: `wc -l` — max 378 LOC. Not broken.
- Dependency sprawl: 8 runtime deps, each mapped to a use. Not broken.
- Provider hardcoding: `ModelProvider` interface + router; swappable. Not broken.
- Global-state corruption: index is an immutable read cache; maps are bounded with reset hooks. Residual risk: multi-instance deploy (documented ceiling).
- Type safety on external JSON: zod at every HTTP boundary; index/gaps JSON is build-controlled. Residual risk: the internal schema/interface cast (ARCH-004).

Confidence: high on ARCH-001..005 (all read directly from source / grep). No model key needed for any of these — all structural.
