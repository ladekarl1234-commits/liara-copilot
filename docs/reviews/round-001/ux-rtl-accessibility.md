# Round 1 — UI/UX, Persian/RTL, Mobile & Accessibility (main-engineer visual judge)

Reviewed the **running product** at commit `67caf52`, keyless mode, across
1440/768/390/320px. Evidence: `screenshots/`. Owned criterion: UI/UX 55 (with
RTL + mobile + a11y subcriteria).

## Score (this area): 47/55

Strong, genuinely minimal, RTL-correct product design. The deduction is driven
almost entirely by ME-001 (featured chips refuse) which is the first thing a
judge experiences.

## Findings

### UX-001 — P1 — 3 of 4 landing example chips return a refusal
Cross-referenced with `_main-engineer-observations.md` ME-001 (retrieval/gate
root cause). UI impact: the single most prominent affordance on the landing
screen — the example chips — leads a judge straight into "couldn't find an
answer" 3 times out of 4. Worst possible first impression for the UX and
Answer-quality criteria. Evidence: `screenshots/desktop-sources.png`.
Fix owned under the retrieval root-cause fix.

### UX-002 — P2 — refusal message is contradicted by "منابع (3)" beneath it
`src/lib/agent/orchestrator.ts` insufficient path emits the "I couldn't find a
reliable answer" message AND `citations` of the top-3 weak chunks. The UI then
renders a confident-looking "منابع (3)" disclosure directly under a refusal.
Mixed message: either it found sources or it didn't. Repro: any low-gate query;
see `screenshots/desktop-sources.png`. Expected: on a refusal, either omit the
sources or relabel them "شاید مرتبط" (maybe related) so the user isn't told
"not found" then handed 3 sources. Confidence: high.

### UX-003 — P3 — no visible streaming/loading affordance is testable without a key
In keyless mode the stage events (`understanding/searching/checking`) flash by
in <200ms, so the "thinking" states can't be visually evaluated here. The code
(`Chat.tsx` stage line) looks correct but this is **theoretical** until a model
key is configured. Flag for the with-key round.

## Persian / RTL — no live defects found
- Root `dir="rtl" lang="fa"`; message bodies `dir="auto"` (English/mixed pick
  direction correctly); code intended LTR (`CodeBlock` `dir="ltr"`, verified in
  source — not testable live without a model-authored code block: theoretical);
  source URLs wrapped in `<bdi dir="ltr">`. Context chip "DBaaS" renders LTR
  inside the RTL flow correctly. No punctuation/bidi breakage observed at any
  width. Evidence: all screenshots.
- **Gap (theoretical):** long LTR command output and code blocks inside Persian
  conversation could not be exercised keyless — the highest-risk RTL case is
  untested live. Must be verified in the with-key round.

## Mobile & Accessibility — no live defects found
- 320 / 390 / 768px: no horizontal page overflow, composer sticky with safe-area
  padding, chips wrap, sources/feedback reachable. Evidence:
  `screenshots/{small-mobile,mobile,tablet}-conversation.png`.
- Semantics: `main` > `h1`, labeled `textbox "پیام شما"`, labeled send button
  "ارسال پیام", example buttons labeled, message list `role=log`, feedback
  buttons labeled fa ("پاسخ مفید بود/نبود"), an `alert` region present.
- `:focus-visible`, `prefers-reduced-motion`, `prefers-color-scheme` all in
  `globals.css`. Dark mode verified clean in prior rounds.
- **P3:** the sources `<summary>` announces as a generic disclosure; adding
  `aria-expanded` mirroring is nice-to-have but native `<details>` is already
  keyboard-operable — low value, likely not worth the complexity.

## What I could NOT test (needs an AI model key — mark PENDING/theoretical)
Model-authored answer prose; long code-block RTL rendering; many-citation
layout; real streaming cadence; copy-button on a real code block. These gate the
UX score's ceiling and must be exercised in a with-key round before full marks.
