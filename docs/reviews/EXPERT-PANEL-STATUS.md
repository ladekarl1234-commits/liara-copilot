# Expert Panel — Remediation Status

Live status of all 170 findings from [the expert panel review](EXPERT-PANEL-2026-08.md).
Generated from the panel evidence file plus the remediation ledger — not hand-counted.

**100 fixed · 12 partial · 3 blocked · 55 open**

| Severity | Total | ✅ Fixed | 🟡 Partial | ⛔ Blocked | ⬜ Open |
|---|---:|---:|---:|---:|---:|
| 🔴 critical | 4 | 3 | 0 | 1 | 0 |
| 🟠 high | 47 | 40 | 3 | 2 | 2 |
| 🟡 medium | 83 | 41 | 5 | 0 | 37 |
| ⚪ low | 36 | 16 | 4 | 0 | 16 |

## Blocked (cannot be closed in this environment)

- **`EP-PRD-01`** 🔴 — The core value claim — answer quality — has never been measured or even run against a real model
  - Requires a real OpenRouter API key to run answers-mode evaluation. Not available in this repo — the single remaining CRITICAL, documented rather than hidden.
- **`EP-ANS-02`** 🟠 — Answer correctness — the 80-point criterion — has never been measured end-to-end, not even once
  - Same blocker: end-to-end answer correctness cannot be measured without a live model key.
- **`EP-DATA-06`** 🟠 — Zero measured data on answer quality; the LLM judge is uncalibrated self-evaluation
  - Same blocker: the LLM judge needs a key, and would be uncalibrated self-evaluation without one.

## Every finding

| ID | Sev | Status | Finding |
|---|---|---|---|
| `EP-A11Y-01` | 🔴 | ✅ fixed | Streaming answer re-announces from scratch on every token inside role=log/aria-live |
| `EP-ANS-01` | 🔴 | ✅ fixed | Evidence gate refuses answerable questions whose retrieval was perfect — it measures query verbosity, not groundedness |
| `EP-PRD-01` | 🔴 | ⛔ blocked | The core value claim — answer quality — has never been measured or even run against a real model |
| `EP-RET-01` | 🔴 | ✅ fixed | The benchmarked hybrid gain (+14.6pt hit@1) is unreachable in the shipped artifact |
| `EP-A11Y-02` | 🟠 | ✅ fixed | Link/accent colour fails 1.4.3 (2.93:1) and the same token is the focus indicator (fails 1.4.11) |
| `EP-A11Y-03` | 🟠 | ✅ fixed | Chat log is a scrollable region with no keyboard access (SC 2.1.1) |
| `EP-A11Y-04` | 🟠 | ✅ fixed | Focus is destroyed on landing→chat transition and later stolen back mid-read |
| `EP-A11Y-05` | 🟠 | ✅ fixed | No speaker attribution, no per-message heading, and no <h1> in the chat view (1.3.1 / 2.4.6) |
| `EP-AGT-01` | 🟠 | ✅ fixed | One invalid sub-object silently discards the ENTIRE statePatch — context, profile and workflow all lost, unlogged |
| `EP-AGT-02` | 🟠 | ✅ fixed | session.workflow is never cleared — a Guide checklist renders above every later answer for the session's life |
| `EP-AGT-03` | 🟠 | 🟡 partial | Without an LLM the Fix ledger cannot advance and overwrites the original problem with the follow-up text — The ledger no longer overwrites the original problem; deterministic hypothesis advancement without an LLM is still limited. |
| `EP-AGT-04` | 🟠 | ✅ fixed | The product's own one-click follow-up "هنوز حل نشده" drops out of the Fix flow into a generic refusal |
| `EP-ANS-02` | 🟠 | ⛔ blocked | Answer correctness — the 80-point criterion — has never been measured end-to-end, not even once |
| `EP-ANS-03` | 🟠 | ✅ fixed | Fix/Guide low-evidence path emits model-authored domain claims with zero citations and zero verification |
| `EP-ANS-04` | 🟠 | 🟡 partial | hit@1 of 44% plus a gate that answers at 'medium' routinely hands the model evidence lacking the answer — Weak-evidence hedge exists (`evidenceIsWeak`); the prompt-side hedge wording is wired but the confidence union was not split into medium/weak. |
| `EP-ARCH-01` | 🟠 | ✅ fixed | `handleChatMessage` is a 235-line god-function with ~10 exit paths and no step seam |
| `EP-COST-01` | 🟠 | ✅ fixed | Verify call re-sends the whole evidence block — 42% of per-turn input tokens for a 1-bit signal |
| `EP-COST-02` | 🟠 | ✅ fixed | FAQ answer cache is eligible for ~5% of turns — the zero-call path almost never fires |
| `EP-COST-03` | 🟠 | ✅ fixed | fast/smart routing is a no-op by default and inverted in practice: ~95% of answers route 'smart' |
| `EP-DATA-01` | 🟠 | ✅ fixed | No held-out split: the ranker's boosts were fitted on the same 48 cases the score is reported on |
| `EP-DATA-02` | 🟠 | ✅ fixed | docs/EVALUATION.md publishes five numbers that contradict the committed results artifact |
| `EP-DATA-03` | 🟠 | ✅ fixed | Regression floors sit 15-17pp below measured — a 7-case hit@5 drop passes CI |
| `EP-DATA-04` | 🟠 | ✅ fixed | Eval results are not reproducible: no commit/corpus provenance, unpinned docs, same-day overwrite |
| `EP-DATA-05` | 🟠 | ✅ fixed | "hit@5" is measured after evidence selection, so k is not 5 for 27 of 48 cases |
| `EP-DATA-06` | 🟠 | ⛔ blocked | Zero measured data on answer quality; the LLM judge is uncalibrated self-evaluation |
| `EP-DOCS-01` | 🟠 | ✅ fixed | SECURITY.md documents two controls as the pre-fix, vulnerable versions that DECISIONS.md D9 says were replaced |
| `EP-DOCS-02` | 🟠 | ✅ fixed | docs/EVALUATION.md dataset section is stale on five separate facts and contradicts its own metrics table |
| `EP-MAINT-01` | 🟠 | ✅ fixed | No linter, no formatter, no quality gate — four eslint-disable directives target a linter that is not installed |
| `EP-MAINT-02` | 🟠 | ✅ fixed | Bilingual strings scattered across five files in three patterns; the fa/en error table is duplicated and the client already discards the server's localized message |
| `EP-OBS-01` | 🟠 | ✅ fixed | User feedback is unjoinable to any request signal — thumbs-down cannot be traced to a pipeline run |
| `EP-OBS-02` | 🟠 | ✅ fixed | Planner fallback is computed as a diagnostic then thrown away — silent quality collapse |
| `EP-OBS-03` | 🟠 | ✅ fixed | Claim verification has no operational signal, and its failure mode inverts the metric |
| `EP-OBS-04` | 🟠 | ✅ fixed | No outcome dimension in metrics — refusal, clarify, chitchat and injection-block are indistinguishable |
| `EP-PRD-02` | 🟠 | ✅ fixed | The product ships the weakest retrieval mode it benchmarked, while marketing the strongest |
| `EP-PRD-03` | 🟠 | ⬜ open | No escalation path — the support-deflection loop has no exit, so the product cannot be safely fronted to customers |
| `EP-PRD-04` | 🟠 | ✅ fixed | Negative-feedback analytics are structurally unusable — the thumbs-down signal cannot be traced back to a question |
| `EP-REL-01` | 🟠 | ✅ fixed | Answer-model failure returns a bare error even though the sources-only fallback already exists |
| `EP-REL-02` | 🟠 | ✅ fixed | Retry budget is unbounded against any request deadline: ~91s per provider call, ~182s to a user-visible error |
| `EP-REL-03` | 🟠 | ✅ fixed | MODEL_TIMEOUT_MS also aborts the response body, so a long answer is truncated mid-stream and reported as 'internal' |
| `EP-RET-02` | 🟠 | ✅ fixed | Chunker cuts inside open code fences: 211 chunks (5.6%) carry truncated code |
| `EP-RET-03` | 🟠 | 🟡 partial | Shipped hit@1 is 0.44, with 19% of questions never retrieving the right page in top-5 — hit@1 improved 43.8% → 60.4%, but 3 hard cases still never retrieve the right page in top-5. |
| `EP-SCALE-01` | 🟠 | ⬜ open | N instances silently reset conversations: in-process session Map + never-adopt policy |
| `EP-SCALE-02` | 🟠 | ✅ fixed | vectorTopK is an O(n·d) scan + full sort + n object allocations, run once per query (up to 3/request) |
| `EP-SCALE-03` | 🟠 | ✅ fixed | Headline load number (104 req/s, p50 232 ms) measures a cheaper pipeline than production runs |
| `EP-SEC-01` | 🟠 | ✅ fixed | Feedback comments bypass redaction: user-pasted secrets persist to disk and are served verbatim by /api/diag |
| `EP-SEC-02` | 🟠 | ✅ fixed | Raw sessionId written to feedback.jsonl, violating the codebase's own 'session id is a credential' invariant |
| `EP-SEC-03` | 🟠 | ✅ fixed | Rate-limit key trusts the leftmost X-Forwarded-For hop, which is client-controlled behind an appending proxy |
| `EP-UX-01` | 🟠 | ✅ fixed | Mobile keyboard covers the composer: fixed 100dvh shell with no `interactive-widget` viewport hint |
| `EP-UX-02` | 🟠 | ✅ fixed | `dir="auto"` flips whole Persian paragraphs to LTR whenever a sentence opens with a command or identifier |
| `EP-UX-03` | 🟠 | ✅ fixed | No stop-generation control, and the composer is fully disabled while streaming |
| `EP-UX-04` | 🟠 | ✅ fixed | Session id survives reload but the transcript does not — stale server context is silently applied to an apparently blank chat |
| `EP-A11Y-06` | 🟡 | ✅ fixed | Workflow and hypothesis status is conveyed only by an aria-hidden glyph plus colour |
| `EP-A11Y-07` | 🟡 | ✅ fixed | Live regions are injected together with their content, so the first announcement is dropped |
| `EP-A11Y-08` | 🟡 | ✅ fixed | Input field boundary is invisible (1.17:1) and the textarea's focus outline is explicitly removed |
| `EP-A11Y-09` | 🟡 | ✅ fixed | Source links, sources summary, and the 'still broken' button are under the 24px minimum target (SC 2.5.8, WCAG 2.2 AA) |
| `EP-A11Y-10` | 🟡 | 🟡 partial | No automated accessibility gate, and DESIGN.md's a11y section overclaims — Partially addressed. |
| `EP-AGT-05` | 🟡 | ✅ fixed | Personalization is largely nominal: two profile fields are write-only dead state, and nothing is inferred without an LLM |
| `EP-AGT-06` | 🟡 | ✅ fixed | Hypothesis ledger is replaced wholesale — a shortened model response silently erases tested/rejected history |
| `EP-AGT-07` | 🟡 | ✅ fixed | No deterministic resolution — a Fix flow has no termination condition without the model |
| `EP-AGT-08` | 🟡 | ⬜ open | The agentic claims are never measured end-to-end: the eval harness is strictly single-turn |
| `EP-AGT-09` | 🟡 | ✅ fixed | triedActions is declared, bounded, prompt-fed — and never populated by any deterministic path |
| `EP-AGT-10` | 🟡 | ✅ fixed | Inferred context is not correctable through the UI, and a stale platform survives a product topic switch |
| `EP-ANS-05` | 🟡 | ✅ fixed | The gate is blind to the vector signal, so it refuses exactly the semantic matches vector retrieval exists to catch |
| `EP-ANS-06` | 🟡 | ⬜ open | Citations silently fall back to the top 3 evidence chunks when the answer contains no [n] markers |
| `EP-ANS-07` | 🟡 | ⬜ open | Claim verification has no tests, no success metric, and degrades to a silent no-op |
| `EP-ARCH-02` | 🟡 | ⬜ open | ADR 0004 claims the local-embeddings seam "is ready"; it is unreachable from the runtime |
| `EP-ARCH-03` | 🟡 | ⬜ open | `loadIndex(indexDir)` silently ignores its argument whenever the global cache is warm |
| `EP-ARCH-04` | 🟡 | ⬜ open | No linter is installed, yet the code carries four `eslint-disable` directives |
| `EP-ARCH-05` | 🟡 | ⬜ open | `LiaraProvider` + `MockLiaraProvider` are 166 lines of speculative abstraction with zero runtime consumers |
| `EP-ARCH-06` | 🟡 | ✅ fixed | `TextToSpeechProvider` has zero implementations, and two source comments claim otherwise |
| `EP-ARCH-07` | 🟡 | ✅ fixed | Feedback persistence is inline in the route and, unlike its sibling gap log, has no size bound |
| `EP-COST-04` | 🟡 | ✅ fixed | estimateTokens' 2.2 chars/token constant is unvalidated and wrong by 1.2-1.6x depending on the served model — Routing split landed; the full saving depends on operator model config. |
| `EP-COST-05` | 🟡 | ✅ fixed | Evidence budget (8 chunks / 7,000 chars) is oversized relative to measured retrieval recall |
| `EP-COST-06` | 🟡 | ⬜ open | Cost observability produces no actual number: estimatedCostUsd is undefined by default and nothing aggregates |
| `EP-COST-07` | 🟡 | ⬜ open | Stream cancellation only logs — an abandoned turn keeps generating and still pays for verify |
| `EP-COST-08` | 🟡 | ✅ fixed | 30s model timeout runs from request start across the whole stream — long answers are paid for and thrown away |
| `EP-COST-09` | 🟡 | ⬜ open | The free local embedder is not reachable from the runtime — enabling hybrid retrieval requires paying a provider |
| `EP-DATA-07` | 🟡 | ✅ fixed | Gate accuracy is one-sided and pools two different pass criteria into one ratio |
| `EP-DATA-08` | 🟡 | 🟡 partial | README presents hybrid+rerank as the shipped ranker while the shipped index has zero embeddings — Partially addressed by the new provenance + CI ceilings. |
| `EP-DATA-09` | 🟡 | ✅ fixed | Modes benchmark records aggregates only — no per-case data, and the headline R@5 lift is 2 cases |
| `EP-DATA-10` | 🟡 | 🟡 partial | Per-category tables are published off n=2 for 11 of 20 categories — the percentages are noise — Partially addressed. |
| `EP-DATA-11` | 🟡 | ✅ fixed | "Recall@k" is a mislabel for binary hit@k, and it over-credits the 13 multi-source cases |
| `EP-DATA-12` | 🟡 | ⬜ open | Feedback→gaps loop records a fabricated language and no question text, making it unusable as analytics |
| `EP-DOCS-03` | 🟡 | ✅ fixed | The "Known failure cases" table overstates failures by 67% and misses one real failure |
| `EP-DOCS-04` | 🟡 | ✅ fixed | docs/DESIGN.md contradicts itself and the shipped UI after the D12 redesign was appended rather than merged |
| `EP-DOCS-05` | 🟡 | ✅ fixed | spec.md's 21 AC-* acceptance criteria have almost no traceability to evidence |
| `EP-DOCS-06` | 🟡 | ✅ fixed | RETRIEVAL.md and COST.md quote a superseded chunk count and anchor coverage while citing the live meta.json |
| `EP-MAINT-03` | 🟡 | ⬜ open | ~200 LOC of speculative scaffolding with zero production callers, contradicting the codebase's own stated discipline |
| `EP-MAINT-04` | 🟡 | ⬜ open | search() is a ~150-line, ~35-decision-point function doing six separable jobs |
| `EP-MAINT-05` | 🟡 | ⬜ open | handleChatMessage() is a 236-line function with eight early-return paths and a 40-line trailing closure |
| `EP-MAINT-06` | 🟡 | ⬜ open | Dev-only critical advisory chain from an unmaintained embeddings library |
| `EP-OBS-05` | 🟡 | ✅ fixed | Rate-limit rejections are completely unlogged, including the global spend backstop |
| `EP-OBS-06` | 🟡 | ⬜ open | Zero aggregation anywhere; the gap summary is fetched but never rendered |
| `EP-OBS-07` | 🟡 | ⬜ open | The only drill-down surface is a 50-entry in-process ring buffer that is off in production and unauthenticated when on |
| `EP-OBS-08` | 🟡 | ⬜ open | Cost metric is absent by default and cannot attribute spend to the model that actually served |
| `EP-OBS-09` | 🟡 | ⬜ open | Provider retries, timeouts and upstream status codes are entirely unlogged |
| `EP-OBS-10` | 🟡 | ✅ fixed | /api/diag blocks the event loop with a synchronous read+parse of up to 5MB of gaps.jsonl |
| `EP-OBS-11` | 🟡 | ⬜ open | Feedback/gap write path lacks the redaction and hashing the log and trace paths enforce |
| `EP-PRD-05` | 🟡 | ✅ fixed | Developer-only strings leak into end-user copy, breaking the product illusion |
| `EP-PRD-06` | 🟡 | ✅ fixed | Deep-anchor citations — the headline trust differentiator — cover only 37% of the corpus |
| `EP-PRD-07` | 🟡 | ✅ fixed | Corpus scope caps the deflectable ticket volume: no pricing, quota, status or account state |
| `EP-PRD-08` | 🟡 | ⬜ open | No unit economics, and the default model supply chain is not one a cloud vendor can ship on |
| `EP-PRD-09` | 🟡 | ✅ fixed | Conversations do not persist, and a reload leaves invisible server-side context attached |
| `EP-REL-04` | 🟡 | ⬜ open | No user-facing cancel for an in-flight stream; the only escape destroys the conversation |
| `EP-REL-05` | 🟡 | ⬜ open | SSE cancel() only logs — client disconnect does not stop in-flight model work |
| `EP-REL-06` | 🟡 | ⬜ open | Client collapses the server's voice error taxonomy into one generic message |
| `EP-REL-07` | 🟡 | ⬜ open | No React error boundary — a render crash blanks the app and loses the conversation |
| `EP-REL-08` | 🟡 | ⬜ open | Recording has no length cap; an over-long clip fails late with a misleading message |
| `EP-REL-09` | 🟡 | ⬜ open | finish() re-resolves the session by id and can write the turn into a phantom session |
| `EP-RET-04` | 🟡 | ⬜ open | The documented "15 known failure cases" contradicts the results file it cites |
| `EP-RET-05` | 🟡 | ✅ fixed | The rerank constants buy ~1 case at k=3 and 0 at k=1 — unjustified as tuned |
| `EP-RET-06` | 🟡 | ⬜ open | Eval set too small for the decisions being made on it; no confidence intervals or significance testing |
| `EP-RET-07` | 🟡 | ⬜ open | 491 duplicate chunk bodies indexed as distinct documents, polluting IDF and burning candidate slots |
| `EP-RET-08` | 🟡 | ✅ fixed | Vector half of hybrid ignores the product filter that the lexical half enforces |
| `EP-RET-09` | 🟡 | 🟡 partial | Deep-anchor coverage 36.6% with no fallback — most citations land at the top of the page — Partially addressed. |
| `EP-RET-10` | 🟡 | ⬜ open | docs/RETRIEVAL.md has drifted from the code on five separate facts |
| `EP-SCALE-04` | 🟡 | ⬜ open | Whole pipeline is synchronous on one event loop with no offload and no lag metric |
| `EP-SCALE-05` | 🟡 | ✅ fixed | /api/diag re-reads and re-parses the entire gaps.jsonl (up to 5 MB) synchronously on every request |
| `EP-SCALE-06` | 🟡 | ⬜ open | Client re-parses the entire conversation markdown on every streamed token |
| `EP-SCALE-07` | 🟡 | ✅ fixed | No per-request deadline: retries can exceed maxDuration ~2x and amplify load onto a rate-limited provider |
| `EP-SCALE-08` | 🟡 | ⬜ open | Client disconnect does not cancel the in-flight model call |
| `EP-SCALE-09` | 🟡 | ⬜ open | Embeddings load path parses a ~27 MB JSON into per-chunk arrays before building the Float32Array |
| `EP-SEC-04` | 🟡 | ✅ fixed | No Origin / Sec-Fetch-Site check on any POST route; the multipart voice endpoint is a CORS-simple request |
| `EP-SEC-05` | 🟡 | ✅ fixed | redactSecrets misses the most common bare-token pastes, including the Liara CLI's own login form |
| `EP-SEC-06` | 🟡 | ⬜ open | Permissions-Policy disables the microphone for the app's own origin, breaking the voice feature it ships |
| `EP-SEC-07` | 🟡 | ✅ fixed | /api/diag and /internal are gated only by an env flag — no authentication on a user-content surface |
| `EP-SEC-08` | 🟡 | ✅ fixed | Voice endpoint consumes one rate-limit token for an 8 MB upload plus a paid 40 s third-party job |
| `EP-SEC-09` | 🟡 | ⬜ open | CSP permits 'unsafe-inline' scripts, neutralising it as XSS defense-in-depth |
| `EP-UX-05` | 🟡 | ✅ fixed | Citation labels hardcode `dir="ltr"` around titles that are 99.6% Persian |
| `EP-UX-06` | 🟡 | ✅ fixed | Inline `[n]` citation markers are inert text — the core evidence affordance is not interactive |
| `EP-UX-07` | 🟡 | 🟡 partial | Refusal / low-evidence answers dead-end with no recovery affordance — including from the app's own starter chip — Partially addressed. |
| `EP-UX-08` | 🟡 | ✅ fixed | Landing content is clipped and unreachable on short viewports — `overflow: hidden` plus flex centering plus autofocus |
| `EP-UX-09` | 🟡 | ✅ fixed | Screen-reader experience: token-level deltas stream into one polite live region, and turns carry no role labels |
| `EP-UX-10` | 🟡 | ✅ fixed | Read-aloud silently does nothing when no Persian voice is installed, and races `getVoices()` on first use |
| `EP-A11Y-11` | ⚪ | ✅ fixed | English content inside lang="fa" is read with Persian phonemes (SC 3.1.2) |
| `EP-A11Y-12` | ⚪ | ✅ fixed | Toggle buttons expose state visually but not in their accessible name |
| `EP-AGT-11` | ⚪ | ✅ fixed | Greeting/chitchat detection is anchored-exact, so ordinary pleasantries take the full 2-3 model-call path |
| `EP-AGT-12` | ⚪ | 🟡 partial | The keyless Fix message lists every hypothesis, contradicting the ONE-next-step rule it is meant to embody — Partially addressed. |
| `EP-ANS-08` | ⚪ | ⬜ open | docs/EVALUATION.md contradicts its own committed numbers in three places |
| `EP-ANS-09` | ⚪ | ✅ fixed | "Deep-anchor citations" holds for only 36.6% of chunks |
| `EP-ARCH-08` | ⚪ | ⬜ open | `/api/diag` embeds filesystem/eval-discovery logic that belongs in a module |
| `EP-ARCH-09` | ⚪ | ✅ fixed | Seven `*ForTests` hooks exported from production modules; `finish()` re-fetches state it was handed |
| `EP-ARCH-10` | ⚪ | ⬜ open | Dead exports in `local-embeddings.ts` |
| `EP-COST-10` | ⚪ | ⬜ open | Voice spend is bounded by bytes, not by audio duration, on a per-minute-billed API |
| `EP-COST-11` | ⚪ | ✅ fixed | No spend ceiling beyond requests-per-minute, and no single-flight for concurrent identical questions |
| `EP-DOCS-07` | ⚪ | ✅ fixed | benchmarks/README.md's "Latest" retrieval line cites MRR 0.595, which the committed results file contradicts |
| `EP-DOCS-08` | ⚪ | ✅ fixed | ADR 0004's own "Revisit when" condition has fired, but the ADR was edited in place instead of superseded, against the stated ADR process |
| `EP-DOCS-09` | ⚪ | ✅ fixed | Two competing spec files with two AC numbering schemes; DECISIONS.md cites an AC id that does not exist in the source of truth |
| `EP-DOCS-10` | ⚪ | ✅ fixed | No mechanical guard against doc drift, in a repo whose docs demonstrably drift |
| `EP-MAINT-07` | ⚪ | ⬜ open | Bounded-map eviction idiom hand-rolled three times, once with an unnamed magic 5000 that shadows a named constant |
| `EP-MAINT-08` | ⚪ | ⬜ open | Five test-only reset hooks exported from production modules with nothing preventing production use |
| `EP-MAINT-09` | ⚪ | ✅ fixed | Test output is drowned in structured JSON logs, making real failures hard to locate |
| `EP-MAINT-10` | ⚪ | ⬜ open | Two styling systems in one component: 1062-line hand-written globals.css alongside stray Tailwind utilities and inline styles |
| `EP-MAINT-11` | ⚪ | ⬜ open | Twenty-two issue IDs referenced in code comments resolve only by grepping eight undocumented review directories |
| `EP-OBS-12` | ⚪ | ⬜ open | Feedback-driven gap rows are keyed on a random UUID, so 100% of them are unaggregatable noise |
| `EP-PRD-10` | ⚪ | ⬜ open | The archetypal triage query — vague crash, empty logs — retrieves irrelevant pages |
| `EP-PRD-11` | ⚪ | ✅ fixed | Landing promise overshoots the delivered behaviour |
| `EP-REL-10` | ⚪ | ✅ fixed | Non-network exceptions are retried as network failures and reported as model_unavailable |
| `EP-REL-11` | ⚪ | ⬜ open | Index load has an unguarded read and non-atomic writes, so a corrupt index reports 'internal' instead of index_missing |
| `EP-REL-12` | ⚪ | ⬜ open | Concurrent requests on one session share a single mutable SessionState |
| `EP-RET-11` | ⚪ | 🟡 partial | headingPath and contentType are computed and stored but never used at retrieval time; h2 breadcrumb is unsearchable — Measured and rejected: indexing `headingPath` as a 4th field cost 3 cases (hit@5 0.813→0.750), so it was deliberately not adopted. |
| `EP-RET-12` | ⚪ | ✅ fixed | The 'high' confidence tier fires on ~5% of cases, leaving the fast-model route and FAQ cache nearly dead |
| `EP-SCALE-10` | ⚪ | ⬜ open | Rate-limit map sweep is O(n) per request once the map passes 10k keys and may free nothing |
| `EP-SCALE-11` | ⚪ | ⬜ open | Index loads lazily inside the first request instead of at process start |
| `EP-SCALE-12` | ⚪ | ⬜ open | Runtime JSONL files on local disk contradict the stateless-process claim |
| `EP-SEC-10` | ⚪ | ✅ fixed | Uploaded audio has no MIME allowlist or magic-byte check before being relayed to the paid STT provider |
| `EP-SEC-11` | ⚪ | 🟡 partial | Prompt-injection detector is a regex allowlist and is bypassed by ordinary paraphrase, spacing, or another language — Partially addressed. |
| `EP-SEC-12` | ⚪ | ⬜ open | Claim-verification prompt embeds the model answer unfenced and unsanitized |
| `EP-UX-11` | ⚪ | ✅ fixed | Several interactive controls fall below the 44px minimum touch target |
| `EP-UX-12` | ⚪ | 🟡 partial | No client-side input-length guard, and secret redaction is never surfaced to the user — Partially addressed. |
