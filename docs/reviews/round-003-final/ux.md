# Round 3 Final — UX Judge (UI/UX 55)

Commit 77eb3ff. Live server localhost:3000, keyless degraded mode (aiConfigured:false).
Model prose quality is theoretical (no key); everything below is verified against
the running server + component source, not prose.

## Verified GOOD (adversarial, cleared)
- 4 landing chips: all answer (citations, not refusals). Deploy/error/db/domain each
  return session+stages+delta+citations+done. No refusal regression.
- Persian question: answers with correctly-scoped Persian citations, RTL layout.
- Error paste (ECONNREFUSED 5432): Fix flow fires — ranked hypotheses (h1 testing,
  h2/h3 untested) + ONE diagnostic step + troubleshooting panel state. HypothesisList
  renders status marks + line-through on rejected.
- Unanswerable (recipe / offtopic-en): honest refusal, NO citations, language-matched
  (fa refusal for fa, en refusal for en). No misleading sources.
- Security: Markdown uses no rehype-raw → raw HTML escaped; links rel=noopener nofollow.
- RTL root correct (html lang=fa dir=rtl); code blocks force dir=ltr; ctx-chips isolate.

## FINDINGS

### UX-301 (P2 / major) — Stale context chips: UI keeps showing a context the server has cleared
- path: src/components/useChat.ts:141-165 (handle) + 97/156; server src/lib/agent/orchestrator.ts:98-99
- repro (live, verified):
  - T1 `{"sessionId":S,"message":"برنامه‌ی nextjs من روی لیارا"}` → emits
    `{"type":"context","chips":["Next.js","PaaS"]}`
  - T2 same session `"نه، دیگر از nextjs استفاده نمی‌کنم"` → emits NO context event
    (platform cleared server-side; contextChips(session) now []).
- observed: client `setContextChips` is called ONLY on a `context` event with non-empty
  chips (orchestrator emits context only `if (chips.length)`). There is no code path that
  resets chips to []. So after T2 the composer still displays "Next.js · PaaS".
- expected: the context indicator must reflect current session context; after a
  negation/platform-switch or a resolved-only troubleshooting turn it should clear.
- why it matters: the chip strip is the app's visible "what I know about you" signal.
  Round-2 explicitly fixed the server so negation clears the stale platform (no
  poisoning) — but the UI never shows that fix and actively lies, telling the user the
  assistant still thinks they're on Next.js. Same bug hits any turn where the only chip
  was `عیب‌یابی`/Troubleshooting and it then resolves.
- evidence: two-turn curl above (T1 chips, T2 none); grep shows setContextChips at exactly
  one call site (line 156) inside the `context` branch, never on run start.
- suggested direction: reset `setContextChips([])` at the top of `run` before streaming,
  and repopulate from the context event — OR have the server always emit one context
  event per turn (even empty). Client reset is the smaller diff.
- confidence: high. scoreImpact: ~-3 to -4 of 55.

### UX-302 (P3 / minor) — Feedback allows unbounded re-voting, no acknowledgment
- path: src/components/Feedback.tsx:56-63
- repro: click 👍 then 👎 then 👍 … each click fires a fresh POST /api/feedback; buttons
  never disable after a vote and there is no thank-you/confirmation state.
- observed: `post` sets verdict optimistically but leaves both buttons enabled and clickable.
- expected: after a vote, acknowledge (small "ممنون") and/or stop re-POSTing the same verdict.
- why it matters: minor UX polish + avoidable duplicate feedback rows; low cost.
- evidence: no `disabled` guard on fb-btn; onClick always calls post.
- suggested direction: guard `if (verdict === v) return;` and show a thank-you line once set.
- confidence: high. scoreImpact: ~-1.

### UX-303 (P3 / informational) — Source line forces Persian titles into an LTR container
- path: src/components/Sources.tsx:36-39 (`<bdi dir="ltr">Liara Docs · {product} · {title}`)
- observed: Persian titles (e.g. "فایل liara.json در لیارا") sit inside a dir=ltr bdi, so
  the run/separator ordering is LTR. Each Persian run still renders internally RTL, and the
  line starts with the Latin "Liara Docs", so it reads acceptably — but it is a deliberate
  bidi choice worth noting, not a clean RTL rendering of a Persian title.
- why it matters: cosmetic; no functional break. Informational.
- confidence: medium (visual; not screenshot-verified here). scoreImpact: 0.

## VERDICT
No P0/P1 in UI/UX. One genuine P2 (UX-301, stale context chip — verified live, misleads
the user and hides a round-2 server fix). Remainder is P3 polish. wouldDeduct = true.
Honest sub-score: ~48/55.
