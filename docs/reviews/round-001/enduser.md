# End-User Judge — Round 001

Owner: UX 55 · Agentic/personalization 50 (105 combined)
Commit: 67caf52 · Mode under test: keyless/degraded (aiConfigured:false — the live demo state)
Method: adversarial multi-turn curl against http://localhost:3000/api/chat (UTF-8 bodies), plus source read.

## Score

| Criterion | Max | Score | Rationale |
|---|---|---|---|
| UX | 55 | 42 | Solid foundations (RTL/dir=auto, focus-visible + reduced-motion CSS, 4 landing chips, per-message error+retry, aria-live log, streaming stage messages). Deducted for: live vague-troubleshooting returns an irrelevant SOURCE DUMP instead of a clarification (AC3); no "new chat"/reset affordance so session context accumulates with no way to clear; no error/troubleshooting context chip so a user in a Fix flow gets zero signal the system understood the problem. |
| Agentic/personalization | 50 | 33 | Architecture is real and unit-tested WITH a mock provider (clarify / workflow / troubleshooting-ledger plans). But every one of those behaviors is model-only: the deterministic `fallbackPlan` used in keyless mode always emits `action:'answer'` (except greetings), so in the actual deployed keyless demo NONE of the agentic layer (Fix ledger, Guide checklist, targeted clarification, follow-up rewriting) ever fires. Multi-turn retrieval also ignores session `knownError`/summary, so pronoun follow-ups gate-fail instead of reusing the remembered problem. |

Combined: 75 / 105.

## Findings

### ENDUSER-001 (P1) — Keyless mode strips the entire agentic layer; the live demo shows none of Agentic-50
Location: src/lib/agent/plan.ts:146-168 (fallbackPlan), src/lib/agent/orchestrator.ts:76-145
In keyless mode `provider` is null, so `makePlan` returns `fallbackPlan`, whose `action` is always `'answer'` and whose `statePatch` never contains `troubleshooting` or `workflow`. Therefore `emitState()` never emits a `workflow` or `troubleshooting` event, `action:'clarify'` never happens, and `intent:'followup'` is unreachable. The HypothesisList / WorkflowChecklist components and the clarify path are dead in the demo. The features are only reachable behind an AI key (confirmed by tests/orchestrator.test.ts:155,224 which inject model plans via a mock). A judge running the shipped keyless instance cannot see any Fix/Guide/clarify behavior.

### ENDUSER-002 (P1) — AC3 violated live: vague troubleshooting yields an irrelevant assumption dump, not a clarification
Location: src/lib/agent/orchestrator.ts:120-145; plan.ts:151 (intent=troubleshooting but action=answer)
`database وصل نمیشه` -> 5 dbaas sources, mostly MongoDB console management (delete/create/select DB) — irrelevant to a connection failure; NO clarification.
`کار نمیکنه` -> 5 AI-SDK / DeepSeek / OpenAI "getting started" sources.
`deploy کردم ارور میده` -> PHP/Node deploy + an AI-SDK onError-callback page.
Spec AC3 requires "asks one targeted clarification, no assumption dump." The degraded path does the opposite: it passes the gate on lexical coincidence (کار≈"کار با AI SDK", database≈dbaas index) and dumps unrelated sources. Worse than an honest refusal.

### ENDUSER-003 (P2) — Multi-turn retrieval ignores session context; pronoun follow-ups gate-fail
Location: src/lib/agent/orchestrator.ts:111-115; plan.ts:162 (retrievalQueries=[message])
Session: turn1 `deploy کردم ارور میده` (sets knownError), turn2 `خب حالا چیکار کنم؟` -> "در مستندات رسمی ... پاسخ قابل‌اتکایی پیدا نکردم". The follow-up retrieves on the pronoun text alone; the remembered `knownError`/summary is never folded into the query in degraded mode, so a coherent multi-turn thread collapses to a refusal. Context chips persist visually but do not drive retrieval. (Model mode would rewrite the query — theoretical, needs a key.)

### ENDUSER-004 (P2) — No error/troubleshooting context chip in the Fix flow; no session reset; stale context accumulates
Location: src/lib/state/sessions.ts:81-88 (contextChips); src/components/Chat.tsx:270-283; useChat.ts:155
`deploy کردم ارور میده` emitted NO context event at all (knownError is set but contributes no chip; troubleshooting state is never created in keyless mode, so the "عیب‌یابی" chip never shows). A user reporting an error sees zero indication the system registered it. Separately, contextChips is global state that only ever grows across a session (a Next.js chip persisted into a later PostgreSQL-pricing turn: chips=["Next.js","DBaaS","PostgreSQL"]), and the UI has no "new chat"/clear affordance while the server keeps the session 24h — so a topic-switching user carries stale platform context with no escape.

## Cleared (attacked, not broken)

- Session continuity across turns: confirmed — reusing the `session` SSE id retains platform/db/product across turns (chips extend, dbaas retrieval correct on turn 2).
- Stale-platform mind-change trap: django -> "nextjs رو میخوام" correctly replaced platform (chips ["Next.js","PaaS"], django gone). applyPatch overwrites the single platform field. Not broken.
- Accessibility basics: globals.css has :focus-visible outline and @media (prefers-reduced-motion: reduce); textarea has aria-label + dir=auto; log has role=log aria-live=polite. Present.
- Error recovery UX: per-message ErrorBlock with retry; retry() re-sends last user msg without duplicating the user bubble; stream-ended-without-terminal falls back to 'network'. Sound.
- Landing: 4 example chips + grounding note present (NFR6).

## Reasoning / residual risk

The agentic design is genuine and tested — but it is certified only against a MOCKED model plan, not the code path a keyless evaluator actually exercises. The submission's own README frames keyless mode as "honest refusals + grounded source listings"; the reality for vague troubleshooting is neither honest-refusal nor targeted-clarification but an off-topic source dump (ENDUSER-002). The safest read: with a key the agentic UX is plausibly strong (unverifiable here); without one — the demoable state — the Fix/Guide/clarify value proposition is invisible and the degraded fallback actively mis-serves the exact acceptance scenarios (AC3/AC4) it is judged on. Everything model-authored is confidence:theoretical and needs a key to verify.
