# Expert Panel Review — Liara Copilot

**Date:** 2026-08-20 · **Commit reviewed:** `6b9837a` · **Reviewers:** 15 independent specialized agents · **Findings:** 170

> This is the complete, auditable record of a multi-expert evaluation of this codebase.
> It publishes the method, the per-dimension scores **and their reasoning**, every identified
> issue with its evidence, and the overall assessment — not just a headline number.
> The full machine-readable output is committed alongside it as
> [`expert-panel-2026-08.json`](expert-panel-2026-08.json); the complete issue register is
> [`EXPERT-PANEL-FINDINGS.md`](EXPERT-PANEL-FINDINGS.md).

## 1. Method

**15 specialized expert agents** reviewed the software in parallel, each owning one dimension.
Each agent worked **independently** (no shared conclusions, no cross-talk), inspected the real
source tree, and was required to:

- **verify claims against code**, not against the README or any summary — several agents ran
  `npm test`, `npm run evaluate:retrieval`, `npm run build`, and wrote throwaway probes against
  the real index to check behavior first-hand;
- back **every finding** with evidence (`file:line`, or a command and its output);
- **not manufacture issues** — a genuinely clean category had to be reported as a strength;
- score 0–100 on a shared calibration (90+ exceptional · 75–89 strong with real gaps ·
  60–74 adequate, notable weaknesses · <60 deficient) and justify the exact number;
- make every finding **actionable**: concrete recommendation + effort estimate (S/M/L).

**Scope exclusions (deliberate):** deployment, hosting, CI/CD and the Liara production deploy
were excluded from this round, as was anything related to video generation. This review scores
**the software itself**.

**Panel cost:** 1.64M tokens across 567 tool calls; all 15 agents reported (0 failures).

## 2. Scorecard

| # | Dimension | Score | Confidence | Findings | Verdict |
|---:|---|---:|---|---:|---|
| 1 | Technical architecture & engineering quality | **82** | high | 10 (0C/1H) | A genuinely well-layered modular monolith with a framework-free core, honest ADRs, and a green toolchain — undermined by one god-function orchestrator that has no seam for the tool-calling extension the docs promise, and by three "ready" abstractions that have zero runtime consumers. |
| 2 | Answer quality, grounding & correctness | **73** | medium | 9 (1C/3H) | A genuinely well-architected grounding stack (fenced evidence, exact-coverage gate, citation hygiene, claim verification, honest refusals) whose measured behaviour falls short of its design: retrieval hit@1 is 44%, the gate refuses ~17% of answerable eval questions — including cases where the correct page ranked #1 — and the highest-weight thing being judged, actual answer correctness, has never been measured end-to-end even once. |
| 3 | Retrieval / RAG pipeline quality | **70** | high | 12 (1C/2H) | Unusually disciplined RAG engineering — shared Persian normalization, a version-stamped index, a reproducible eval I re-ran and matched exactly, and an ablation harness that drives the real search() — wrapped around a retriever that as shipped is lexical-only at hit@1 0.44, whose headline hybrid gain is not reachable in the shipped configuration, and whose chunker truncates code fences in 5.6% of chunks. |
| 4 | Agentic capability & personalization | **72** | high | 12 (0C/4H) | A genuinely stateful three-capability agent with careful deterministic scaffolding and end-to-end UI wiring, but every actual state *advancement* is delegated to the LLM — keyless the ledger and checklist freeze, three state-lifecycle bugs let stale/dropped state through silently, and "personalization" reduces to one prompt line plus two dead fields. |
| 5 | Product quality, value & business viability | **73** | high | 11 (1C/3H) | A genuinely well-conceived support-deflection product with the right stance (refuse rather than guess), real Liara-wide corpus coverage and honest evidence culture — but it ships the weakest measured retrieval configuration, has never been exercised against a real LLM, and is missing the two things that turn it from a strong demo into a business: an escalation handoff and a working "which docs fail users" analytics loop. |
| 6 | UX, usability & interaction design | **78** | high | 12 (0C/4H) | Unusually disciplined CSS and state design for a hackathon build — correct logical-property RTL, a real 3-state theme with no-flash, a fully enumerated 6-state voice model, and a proper Persian error taxonomy — undercut by four concrete core-flow defects a Persian user on a phone hits within the first minute: keyboard occlusion of the composer, LTR-flipping prose paragraphs, no way to stop generation, and refusal states that dead-end. |
| 7 | Accessibility (WCAG 2.2 AA) | **68** | medium | 12 (1C/4H) | Real, deliberate accessibility groundwork — native semantics, Persian labels on every icon button, excellent bidi/RTL handling, honoured reduced-motion — undercut by genuine WCAG 2.2 AA failures on the product's core surface: a streaming live region that will flood screen readers, a 2.93:1 link colour, a keyboard-unreachable scroll container, and no speaker attribution or heading structure in the chat view. |
| 8 | Security posture | **78** | high | 12 (0C/3H) | Genuinely thoughtful, layered application security — stream-enforced body caps, server-minted session ids, hashed identifiers in logs, no raw-HTML sink, real security headers — undercut by one proven data-protection hole (feedback comments bypass redaction and are served verbatim by /api/diag), a spoofable rate-limit key, and no cross-origin request controls on the paid upload endpoint. |
| 9 | Reliability, resilience & error handling | **78** | high | 12 (0C/3H) | A genuinely well-built failure model — typed taxonomy, a three-level degradation ladder, a correct SSE lifecycle and unusually rigorous client stream parsing — undermined at the edges by an unbounded retry budget (~91s per provider call, ~182s to a user-visible error), a streaming deadline that truncates long answers and mislabels them `internal`, no user-facing cancel, and no reuse of the existing sources-only fallback when the answer model dies. |
| 10 | Observability & operational readiness | **68** | high | 12 (0C/4H) | The per-request instrumentation is unusually thoughtful for a build this size (hashed PII, actual-served-model capture, Persian-aware token estimation, typed error taxonomy), but the operational loop is broken end to end: user feedback cannot be joined to any request signal, the three main silent-degradation modes (planner fallback, verification off, refusal rate) emit no signal at all, there is zero aggregation, and the only drill-down surface is a 50-entry in-process ring buffer that 404s in production by default. |
| 11 | Data & analytics quality (eval integrity) | **68** | high | 12 (0C/6H) | A genuinely real, well-labelled 61-case bilingual eval set with an auditable, CI-enforced harness — undermined by no held-out split (the ranker was hand-tuned on the same cases), published documentation that contradicts the committed artifact in five places, regression floors far too loose to catch a real drop, and zero measured data on the answer quality that carries the most weight. |
| 12 | Scalability & performance | **77** | high | 12 (0C/3H) | Unusually honest and well-bounded single-instance design with real reproducible benchmarks, but it has no working horizontal-scale story today (silent session loss on instance N+1), an O(n) brute-force vector scan that is the documented 10x-corpus breaker with no mitigation, and a per-request CPU cost meaningfully higher than the published headline number. |
| 13 | Code quality, maintainability & tech debt | **84** | high | 11 (0C/2H) | Unusually disciplined for a competition build — strict TypeScript with effectively zero `any`, 192 fast behavior-focused tests, rationale-dense comments that explain *why* rather than *what*, and clean module boundaries — held back from production-grade by the complete absence of an automated code-quality gate (no ESLint, no formatter, no `lint` script), two 150–240 line hot functions, ~200 LOC of speculative scaffolding that contradicts the codebase's own stated discipline, and a bilingual-string layer that has already diverged in a user-visible way. |
| 14 | Cost efficiency & token economics | **78** | high | 11 (0C/3H) | Genuinely cost-conscious architecture with real zero-call paths, hard per-call token caps and a documented cost model — but the three headline levers (fast/smart routing, FAQ cache, verify budget) are measurably inert or inverted in practice, and the largest single line item (verify = 42% of input tokens) is unoptimized. |
| 15 | Documentation quality & claim integrity | **78** | high | 10 (0C/2H) | The outward-facing evidence layer is genuinely exceptional — every headline number in README.md, spec.md and the ADRs reproduces exactly against the committed artifacts, and the retrieval eval re-runs at HEAD to the same digits — but the second-layer docs (SECURITY, EVALUATION, DESIGN, RETRIEVAL) carry verifiable drift, including a security doc that describes two controls as the pre-fix vulnerable versions. |
| | **Mean across 15 dimensions** | **75** | | **170** | |

### Severity distribution

| 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low | Total |
|---:|---:|---:|---:|---:|
| 4 | 47 | 83 | 36 | 170 |

## 3. Mapping to the challenge criteria

The product was built for a competition scored out of 300. **Deployment (40 pts) is excluded**
from this review, leaving 260 in scope. Mapping the panel scores onto those criteria gives a
**panel-derived projection** — this is an internal estimate from the dimension scores above,
not an official grade:

| Criterion | Max | Contributing dimensions (mean) | Projected |
|---|---:|---|---:|
| Answer quality & correctness | 80 | Answer 73, Retrieval 70, Data 68 → 70.33 | **56.27** |
| UI / UX | 55 | UX 78, Accessibility 68 → 73.00 | **40.15** |
| Agentic & personalization | 50 | Agentic 72 → 72.00 | **36.00** |
| Security, reliability & monitoring | 50 | Security 78, Reliability 78, Observability 68 → 74.67 | **37.33** |
| Cost optimization | 25 | Cost 78 → 78.00 | **19.50** |
| **Total (deployment excluded)** | **260** | | **189.25** |

*(Values at 2dp so the column sums exactly; the same numbers are in
[`expert-panel-2026-08.json`](expert-panel-2026-08.json) under `projection`.)*

Cross-cutting engineering dimensions are not directly weighted by the competition rubric but
carry the project: Technical architecture **82** · Product quality, value **73** · Scalability **77** · Code quality, maintainability **84** · Documentation quality **78**.

## 4. Critical findings

Four findings were rated **critical**. Each is reproducible and each strikes at a claim the
product makes about itself.

### `EP-ANS-01` — Evidence gate refuses answerable questions whose retrieval was perfect — it measures query verbosity, not groundedness

**Dimension:** Answer quality, grounding & correctness · **Effort:** M

- **Evidence:** Probe via `npx tsx` against the real index: Q="چطور برنامه و دیتابیسم رو توی یک شبکه خصوصی بذارم که از بیرون قابل دسترسی نباشن و به هم وصل بشن؟" → top-1 AND top-2 chunks are exactly the expected page `docs.liara.ir/paas/details/private-network/`, yet `conf=low, cov=0.333 (4/12)`; the missed tokens are conversational filler absent from STOPWORDS: `رو توی بذارم بیرون قابل نباشن بشن دیتابیسم`. The identical intent typed as "شبکه خصوصی" returns `high (cov=1.00)`. Hard veto at src/lib/retrieval/index.ts:350 (`coverage.ratio < 0.34 → low`). From evals/results/retrieval-2026-08-20.json: 8/48 sourced cases return `low` (→ orchestrator.ts:171 refuses), and 5 of those had the correct page at rank 1-3 (`discover-file-storage:1`, `persian-private-network-apps:1`, `app-db-private-network:1`, `app-send-email:2`, `pop3-assumption:3`).
- **Impact:** ~10% of questions where retrieval fully succeeded are answered with "I couldn't find a reliable answer in the official docs" — a false refusal that reads as the product not knowing its own documentation. The bias is systematic against long, natural, colloquial Persian, i.e. exactly the phrasing a Persian-first conversational product invites. It bites hardest in the degraded paths: with no LLM key, or on any plan-call failure/parse error, `fallbackPlan` sends the RAW user message as the retrieval query (plan.ts, `retrievalQueries: [message.slice(0,200)]`), which is precisely the condition measured here.
- **Recommendation:** Two changes, both local to retrieval/index.ts + persian.ts: (1) stop gating on a ratio over ALL informative tokens — add an absolute-evidence escape (`matched >= 2 non-generic tokens && scorePerToken >= ~40 && topTitleMatch` → `medium`), or weight tokens by corpus IDF so rare terms like «خصوصی» outweigh «بذارم»; (2) extend STOPWORDS with the colloquial function words the probe surfaced (رو، توی، بذارم، بشن، نباشن، بیرون، قابل، کدوم، بهم، مناسبه، بزنن). Re-run `npm run evaluate:retrieval` and add a *false-refusal* metric (sourced cases returning `low`) to the summary so this class stops being invisible.

### `EP-RET-01` — The benchmarked hybrid gain (+14.6pt hit@1) is unreachable in the shipped artifact

**Dimension:** Retrieval / RAG pipeline quality · **Effort:** M

- **Evidence:** `ls data/index/` returns only chunks.json, lexical.json, meta.json — no embeddings.json; meta.json has `"embeddedCount": 0`. `rg -n 'embedQuery\|local-embeddings' src/` shows the runtime path is orchestrator.ts:131-133 → `provider.embed(texts, cfg.AI_EMBEDDINGS_MODEL)`, and src/lib/ai/local-embeddings.ts (the model the benchmark measured) has NO runtime caller despite its header claiming it is "available to the runtime". The two paths also embed differently: benchmark passages = `[title, heading, text]` with the `passage:` prefix (benchmark-retrieval-modes.ts:68, local-embeddings.ts:53); production passages = `title\nheadingPath\ntext` with NO prefix (build-index.ts:50), and production queries go through `provider.embed` (provider.ts:153-159) which cannot apply `query:` at all.
- **Impact:** benchmarks/retrieval/modes-2026-08-20.json advertises hybrid+rerank recall1 0.5833 vs lexical 0.4375. The shipped system runs lexical. Even if an operator sets AI_EMBEDDINGS_MODEL, the un-prefixed asymmetric embedding is exactly the failure local-embeddings.ts:8-9 warns "silently halves recall" — so the advertised number cannot be obtained by any supported configuration.
- **Recommendation:** Either (a) wire `local-embeddings.embedTexts` as the default in-process embedder (query side is one text, ~30-60ms WASM; 3,746×384 float32 = 5.7MB, trivially shippable) and rebuild data/index/embeddings.json so the shipped index is genuinely hybrid; or (b) add an `embedKind` argument to `ModelProvider.embed` and apply the e5 prefixes plus an identical passage template on both sides. Then re-run the modes benchmark against the actually-shipped configuration. Until then, label the benchmark file explicitly as not-the-shipped-configuration.

### `EP-PRD-01` — The core value claim — answer quality — has never been measured or even run against a real model

**Dimension:** Product quality, value & business viability · **Effort:** M

- **Evidence:** docs/EVALUATION.md:190 "**This has not been run for this submission** — no AI provider key was configured." · `ls evals/results` → only `retrieval-2026-08-20.json` (no `answers-*.json`) · `awk -F= '/^[A-Z]/' .env` → only `DOCS_DIR` is set; OPENROUTER_API_KEY and SONIOX_API_KEY are absent.
- **Impact:** Everything the product sells — grounded correct answers, useful refusals, citation fidelity, the claim-verifier catching hallucinations, Persian answer fluency — rests on an LLM path that has never produced a single real answer in this repo. The measured evidence covers only retrieval (whether the right page is in the top-k), which is a necessary but far from sufficient condition. For a product graded 80/260 on answer correctness, the headline number does not exist, and the team has no idea whether the free router's underlying model is even competent in Persian.
- **Recommendation:** Get one OpenRouter key, run `npm run evaluate -- --answers` over the 61 committed cases, commit `evals/results/answers-*.json`, and publish correctRate / groundedRate / citedExpectedSource in the README beside the retrieval table. If the free router scores badly, that is itself the most valuable finding the project can produce. Repeat with at least one paid model to establish the quality/cost curve.

### `EP-A11Y-01` — Streaming answer re-announces from scratch on every token inside role=log/aria-live

**Dimension:** Accessibility (WCAG 2.2 AA) · **Effort:** M

- **Evidence:** src/components/Chat.tsx:230 `<div role="log" aria-live="polite">` wraps the whole transcript; src/components/useChat.ts:71 `return { ...m, text: m.text + ev.text }` re-renders `<Markdown>` (react-markdown re-parses the full string) on every SSE delta. Worse, useChat.ts:82 `case 'done': return { ...m, id: ev.messageId, done: true }` changes the message id, which is the React key at Chat.tsx:238 — the entire AssistantMessage unmounts and a new one mounts inside the live region at end of stream.
- **Impact:** For the product's single most important interaction, a screen-reader user hears a continuous torrent of partial Persian sentences (markdown re-parse replaces whole subtrees, so NVDA/JAWS/VoiceOver re-read large spans, not just the delta), then the complete answer read once more when the key flips at `done`. A long grounded answer becomes effectively unlistenable, and there is no `aria-busy` or completion cue to fall back on.
- **Recommendation:** Take the streamed text out of the live region: render the in-progress message with `aria-live="off"` (or set `aria-busy="true"` on the message and drop aria-live from the log container), and announce only discrete status via a separate persistent `role="status"` node — stage text while working, then one 'پاسخ آماده شد' on `done`. Fix the key churn by keeping the client-generated id stable and storing the server messageId in a separate field (`serverId`) instead of overwriting `m.id`.

## 5. Per-dimension detail

Each section gives the score with its rationale, what the expert found genuinely strong, and
the issues raised. Full evidence for every finding is in
[`EXPERT-PANEL-FINDINGS.md`](EXPERT-PANEL-FINDINGS.md).

### 5.1 Technical architecture & engineering quality — 82/100

*A genuinely well-layered modular monolith with a framework-free core, honest ADRs, and a green toolchain — undermined by one god-function orchestrator that has no seam for the tool-calling extension the docs promise, and by three "ready" abstractions that have zero runtime consumers.*

**Why this score:** Not lower than 82 because the hard structural properties are genuinely right and I verified them rather than trusting the docs: `src/lib` has zero imports from `next/` or `@/components` and components import only `@/types` (grep-verified both directions), the SSE contract is a discriminated union enforced on both sides of the wire, the ModelProvider abstraction has two real implementations with the mock actually driving a load benchmark, routes are thin, `tsc --noEmit` exits 0 under strict mode, and 192 tests across 20 files pass in 4.4s. The ADRs also flag their own gaps (ARCHITECTURE.md:174 volunteers that LiaraProvider is unwired), which is the opposite of the usual failure mode. Not higher than 82 because of two things a production-grade codebase would not ship. First, the extension seam the docs sell does not exist: adding a Liara API tool means editing inside a 235-line function with ~10 exit paths and 8 mutable captured locals — exactly the "would make a new engineer slow" criterion. Second, three abstractions have zero runtime consumers (LiaraProvider at 166 lines incl. test, TextToSpeechProvider with two comments falsely claiming an implementation, local-embeddings reachable only from a benchmark), and in the local-embeddings case ADR 0004 asserts a config-only upgrade path for the one retrieval win the team actually measured, which is untrue. Add a complete absence of linting despite four `eslint-disable` directives, and a `loadIndex(dir)` that returns the wrong index when the cache is warm, and this is squarely "strong with real gaps." None of the findings break the happy path, which keeps it in the 80s rather than the 70s.

**Strengths**

- Dependency direction is clean and verifiable: `rg "from '@/components\|from 'next/" src/lib` returns zero hits, and `rg "from '@/lib" src/components src/app/page.tsx` returns zero hits. `src/lib` is pure TypeScript with no Next.js coupling, so it is portable and unit-testable without a framework harness — the strongest structural property of the codebase.
- `src/types.ts` (257 lines) is a real shared contract, not a dumping ground: `ChatEvent` (types.ts:192-202) is a discriminated union consumed symmetrically by the server emitter (orchestrator.ts) and the client reducer (`applyEvent`, useChat.ts:69-88), so adding an event type is a compile error on both sides.
- The `ModelProvider` abstraction has two real implementations, not one: `OpenAICompatibleProvider` (provider.ts:30) and `MockLLMProvider` (mock-provider.ts), selected by config (config.ts:76 `llmMock`) and actually exercised by `scripts/benchmark-load.mjs`. That abstraction earns its keep, unlike the Liara/TTS ones.
- `/api/chat/route.ts` is 114 lines and does only transport concerns (rate limit → byte-capped read → zod parse → SSE plumbing → heartbeat), delegating all business logic to `handleChatMessage`. Error taxonomy is typed end to end (`ModelError`/`ClientAbortError` at provider.ts:10-26 → `ErrorCode` at types.ts:204-211 → `faError` at useChat.ts:31).
- Toolchain is green and the tests are structural, not decorative: `npx tsc --noEmit` exits 0 under `strict: true`; `npx vitest run` passes 192 tests across 20 files in 4.4s, including a real-index integration suite (tests/integration-realindex.test.ts) and a route-level rate-limit test.
- Deliberate simplifications are marked at the source with their ceiling and upgrade path (`ponytail:` comments at orchestrator.ts:22, sessions.ts:2, ratelimit.ts:2, retrieval/index.ts:272), and docs/ARCHITECTURE.md:174-184 explicitly states the LiaraProvider is NOT wired in rather than implying it is.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-ARCH-01` | 🟠 high | `handleChatMessage` is a 235-line god-function with ~10 exit paths and no step seam | M |
| `EP-ARCH-02` | 🟡 medium | ADR 0004 claims the local-embeddings seam "is ready"; it is unreachable from the runtime | M |
| `EP-ARCH-03` | 🟡 medium | `loadIndex(indexDir)` silently ignores its argument whenever the global cache is warm | S |
| `EP-ARCH-04` | 🟡 medium | No linter is installed, yet the code carries four `eslint-disable` directives | S |
| `EP-ARCH-05` | 🟡 medium | `LiaraProvider` + `MockLiaraProvider` are 166 lines of speculative abstraction with zero runtime consumers | S |
| `EP-ARCH-06` | 🟡 medium | `TextToSpeechProvider` has zero implementations, and two source comments claim otherwise | S |
| `EP-ARCH-07` | 🟡 medium | Feedback persistence is inline in the route and, unlike its sibling gap log, has no size bound | S |
| `EP-ARCH-08` | ⚪ low | `/api/diag` embeds filesystem/eval-discovery logic that belongs in a module | S |
| `EP-ARCH-09` | ⚪ low | Seven `*ForTests` hooks exported from production modules; `finish()` re-fetches state it was handed | S |
| `EP-ARCH-10` | ⚪ low | Dead exports in `local-embeddings.ts` | S |

### 5.2 Answer quality, grounding & correctness — 73/100

*A genuinely well-architected grounding stack (fenced evidence, exact-coverage gate, citation hygiene, claim verification, honest refusals) whose measured behaviour falls short of its design: retrieval hit@1 is 44%, the gate refuses ~17% of answerable eval questions — including cases where the correct page ranked #1 — and the highest-weight thing being judged, actual answer correctness, has never been measured end-to-end even once.*

**Why this score:** Not 85+: the two defects that matter most for this criterion are both live and both measured. The gate refuses questions whose retrieval was already correct (5 eval cases with the answer at rank 1-3 returned `low`; the private-network probe shows top-1 = the exact expected page at `conf=low`), and it does so as a function of how conversationally the user types — a systematic failure against the product's own target phrasing. Meanwhile hit@1 is 44% and 6 total-miss cases still reach the answer model at `medium`. Not 60-65: the grounding scaffolding is real and better than most — the gate was rebuilt after review proved the original metric vacuous, refusals deliberately carry no citations, `citationsFromAnswer` handles code fences and out-of-range markers, a fabrication-prone hardcoded absence list was found and removed with the reasoning recorded in code, and 192 tests pass. 73 reflects a system whose design would score in the high 80s and whose measured answer-grounding behaviour currently does not — with the decisive caveat that end-to-end answer correctness, the actual 80-point item, has never been evaluated even once, so the upper half of this dimension rests on unexercised prompt rules.

**Strengths**

- Real layered defence, not prompt theatre: `detectInjection` front door (injection.ts) → evidence gate (`gateConfidence`, retrieval/index.ts:333-360) → grounded answer prompt (`answerSystemPrompt` rule 1: "never invent capabilities, prices, or limits", explicit inference marking) → `verifyAnswer` claim check, which is `VERIFY_CLAIMS` default **on** (config.ts) and whose note is surfaced to the *user*, not just the log (orchestrator.ts:239-251).
- Refusal path is honest in a way most RAG demos are not: on a gate failure the system emits the canned "couldn't find it" **and deliberately attaches no citations** (orchestrator.ts:171-180) — 3 confident-looking sources under a refusal would be self-contradictory. Verified in code and in the eval (16/61 cases land `low`).
- `citationsFromAnswer` (orchestrator.ts:376-390) strips code fences and inline code before scanning `[n]`, so `argv[2]` never becomes a citation, preserves the model's own numbering, and rejects out-of-range markers. Covered by 5 unit tests (tests/agent-units.test.ts:134-160).
- Citations are real deep anchors where the source permits: `loadAnchors` (ingest.ts:96-108) recovers authored `<Section id=…>` ids from the sibling MDX rather than guessing slugs — 1370/3746 chunks carry a verified anchor (measured against data/index/chunks.json).
- docs/EVALUATION.md is unusually self-critical and mostly checkable: it names individual failing cases with what ranked instead, and documents that the original gate metric was *vacuous* (a hardcoded `return 'medium'` would have scored identically) before being rebuilt and made strict. The runner enforces floors that set `process.exitCode = 1` (scripts/evaluate.ts) so a regression fails rather than silently rewriting the JSON.
- A hardcoded "features Liara doesn't offer" list was built and then **removed** with the reason recorded in code (injection.ts, closing comment) — it made false absence claims the corpus contradicted. Choosing "I couldn't find it" over "Liara doesn't offer it" is the correct grounding call and it is documented so it won't be reintroduced.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-ANS-01` | 🔴 critical | Evidence gate refuses answerable questions whose retrieval was perfect — it measures query verbosity, not groundedness | M |
| `EP-ANS-02` | 🟠 high | Answer correctness — the 80-point criterion — has never been measured end-to-end, not even once | M |
| `EP-ANS-03` | 🟠 high | Fix/Guide low-evidence path emits model-authored domain claims with zero citations and zero verification | S |
| `EP-ANS-04` | 🟠 high | hit@1 of 44% plus a gate that answers at 'medium' routinely hands the model evidence lacking the answer | M |
| `EP-ANS-05` | 🟡 medium | The gate is blind to the vector signal, so it refuses exactly the semantic matches vector retrieval exists to catch | M |
| `EP-ANS-06` | 🟡 medium | Citations silently fall back to the top 3 evidence chunks when the answer contains no [n] markers | S |
| `EP-ANS-07` | 🟡 medium | Claim verification has no tests, no success metric, and degrades to a silent no-op | S |
| `EP-ANS-08` | ⚪ low | docs/EVALUATION.md contradicts its own committed numbers in three places | S |
| `EP-ANS-09` | ⚪ low | "Deep-anchor citations" holds for only 36.6% of chunks | M |

### 5.3 Retrieval / RAG pipeline quality — 70/100

*Unusually disciplined RAG engineering — shared Persian normalization, a version-stamped index, a reproducible eval I re-ran and matched exactly, and an ablation harness that drives the real search() — wrapped around a retriever that as shipped is lexical-only at hit@1 0.44, whose headline hybrid gain is not reachable in the shipped configuration, and whose chunker truncates code fences in 5.6% of chunks.*

**Why this score:** Two different quality levels are being averaged. The engineering process is 80-85 tier: a version-stamped index that refuses to load stale, one tokenizer shared by build and query, an ablation harness that drives the shipped code path rather than a copy, a gate rebuilt after adversarial review proved it was a no-op, and an eval I re-ran independently and matched case-for-case. That is rarer than it sounds. The delivered retrieval is 60 tier: hit@1 0.4375, 9 of 48 questions never surfacing the right page in top-5, whole categories (ai-api, error-log, mixed) at 0% hit@1, and 5.6% of chunks carrying truncated code fences. Three things pull it below 75 specifically: (1) the flagship hybrid result is not in the shipped artifact and is not obtainable from any supported config, because the production embed path lacks the e5 prefixes the benchmark used; (2) the eight tuned rerank constants move exactly one eval case at k=3 and zero at k=1 by my own ablation, so the most visible piece of sophistication is unearned; (3) the honesty artifacts contradict their own data (15 documented failures vs 9 actual; RETRIEVAL.md stale on five facts), the cheapest thing to fix and the most damaging to leave. Not below 65 because nothing here is fabricated — the numbers reproduce, the failure analysis is real analysis, and every fix is small and well-localized.

**Strengths**

- Reproducibility is real, not claimed. I independently re-ran the shipped `search()` over `evals/cases` (48 sourced) and got hit@1 0.4375 / hit@3 0.7500 / hit@5 0.8125 / MRR 0.5920 and the identical 9-case miss list as `evals/results/retrieval-2026-08-20.json`. Very few submissions have an eval that actually reproduces.
- Index/query drift is structurally prevented: `normalizeFa`/`tokenizeFa` (src/lib/text/persian.ts) are the single tokenizer for both `miniOptions()` and query time, and `LEXICAL_VERSION = 3` (src/lib/retrieval/index.ts:36) is stamped into meta.json and hard-checked at load (index.ts:72), throwing rather than silently mis-scoring on a stale index.
- Persian handling is substantive, not cosmetic: ZWNJ-aware morpheme splitting with a deliberate decision NOT to emit the meaningless joined form for pure-Persian words (persian.ts:82-87), a curated concept-fold applied symmetrically at index and query time (persian.ts:31-52), and prototype-safe lookup via `Map` with the reason documented (persian.ts:55-58).
- The evidence gate was rebuilt after adversarial review proved the first version was a no-op (docs/RETRIEVAL.md round-2 note: a hardcoded `return 'medium'` would have scored identically), and the eval metric was made strict — unsupported/adversarial must return `low`, not merely `!= high`. Gate accuracy 12/13 on the current run.
- The mode benchmark drives the SHIPPED `search()` through `mode`/`rankOnly` flags (scripts/benchmark-retrieval-modes.ts:106-111) rather than reimplementing retrieval, so lexical/vector/hybrid numbers are comparable and cannot drift from production code. It also isolates its vector cache to `.cache/` to avoid clobbering the production index (lines 34-36).
- The e5 asymmetric-prefix contract is understood and correctly implemented in the local embedder (`query:`/`passage:`, src/lib/ai/local-embeddings.ts:52-54) with the failure mode documented in the header — a detail most implementations get silently wrong.
- Evidence dedup keys on the FULL normalized body with an explicit note on why a 400-char prefix key was wrong (index.ts:249-253), fixing a real observed failure where byte-identical boilerplate filled all 8 evidence slots.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-RET-01` | 🔴 critical | The benchmarked hybrid gain (+14.6pt hit@1) is unreachable in the shipped artifact | M |
| `EP-RET-02` | 🟠 high | Chunker cuts inside open code fences: 211 chunks (5.6%) carry truncated code | S |
| `EP-RET-03` | 🟠 high | Shipped hit@1 is 0.44, with 19% of questions never retrieving the right page in top-5 | M |
| `EP-RET-04` | 🟡 medium | The documented "15 known failure cases" contradicts the results file it cites | S |
| `EP-RET-05` | 🟡 medium | The rerank constants buy ~1 case at k=3 and 0 at k=1 — unjustified as tuned | S |
| `EP-RET-06` | 🟡 medium | Eval set too small for the decisions being made on it; no confidence intervals or significance testing | M |
| `EP-RET-07` | 🟡 medium | 491 duplicate chunk bodies indexed as distinct documents, polluting IDF and burning candidate slots | S |
| `EP-RET-08` | 🟡 medium | Vector half of hybrid ignores the product filter that the lexical half enforces | S |
| `EP-RET-09` | 🟡 medium | Deep-anchor coverage 36.6% with no fallback — most citations land at the top of the page | M |
| `EP-RET-10` | 🟡 medium | docs/RETRIEVAL.md has drifted from the code on five separate facts | S |
| `EP-RET-11` | ⚪ low | headingPath and contentType are computed and stored but never used at retrieval time; h2 breadcrumb is unsearchable | S |
| `EP-RET-12` | ⚪ low | The 'high' confidence tier fires on ~5% of cases, leaving the fast-model route and FAQ cache nearly dead | S |

### 5.4 Agentic capability & personalization — 72/100

*A genuinely stateful three-capability agent with careful deterministic scaffolding and end-to-end UI wiring, but every actual state *advancement* is delegated to the LLM — keyless the ledger and checklist freeze, three state-lifecycle bugs let stale/dropped state through silently, and "personalization" reduces to one prompt line plus two dead fields.*

**Why this score:** 72 (top of the \"adequate, notable weaknesses\" band), not higher and not lower. Above 60 comfortably: this is real agentic architecture, not prompt theatre — a deterministic pre-pass with genuinely hard negation cases handled and regression-tested, cross-turn state with non-obvious hygiene rules (mid-flow knownError retention, ledger reset on topic switch), bounded coercion-hardened state, and Fix/Guide wired all the way from plan seed to per-message UI panels that survive keyless. Held below 75 by three things that are core to the dimension rather than peripheral. (1) Advancement is entirely model-delegated: the probes show the keyless ledger and checklist are byte-identical across three turns, `problem` gets overwritten by the follow-up, and `resolved` can never be set — so \"diagnose -> ONE next test -> adapt\" degrades to a loop on exactly the fallback paths (parse errors, model errors) that occur in production, not just in a keyless demo. (2) Personalization is closer to scaffold than product: two of four profile fields have zero readers anywhere in the repo, `packageManager` is fed to the model with no rule binding it, only `experience` has effect via a single prompt line, nothing is user-settable, and the deterministic path infers none of it (probe: `profile= {}` after an explicit \"I'm a beginner\"). (3) Two silent state-integrity bugs — a whole statePatch dropped on one bad sub-object with no log, and a workflow that no code path can ever clear — plus a single-turn-only eval harness (evaluate.ts never sends sessionId) meaning none of the agentic claims are measured end-to-end. Not below 70 because none of these are architectural dead ends: findings 1-4 and 6-7 are S/M edits inside functions that already exist and already have tests around them.

**Strengths**

- Ask/Fix/Guide inference is a real deterministic pre-pass, not a prompt trick: preClassify (src/lib/agent/plan.ts:159) yields platform/db/product/error/greeting signals, and fallbackPlan seeds a ranked hypothesis ledger and a deploy checklist with zero model calls (verified: probe T1 produced 3 ranked 502 hypotheses with h1=testing, G1 produced a 7-step checklist that correctly inserted the DB-migration steps only because postgres was detected).
- Negation and correction handling is unusually careful and correct on the hard cases: directional cues (NEG_BEFORE_RE/NEG_AFTER_RE, plan.ts:129) plus second-term adoption on a switch. Probe output: "دیگه از nextjs استفاده نمی‌کنم، رفتم سراغ django" -> platform=django, negated=true; "my app is not working on nextjs" -> platform=nextjs, negated=false; "the db connection dropped" -> no false negation. Each case has a named regression test (tests/agent-units.test.ts:82,87).
- State hygiene resolves real conflicts rather than ignoring them: a fresh non-error question clears a stale knownError, but NOT while a troubleshooting flow is live (sessions.ts:65-74), and a product topic switch drops the old ledger — all three covered by tests (tests/agent-units.test.ts:175,183,196).
- The agentic state is wired all the way through: orchestrator emitState (orchestrator.ts:347) fires on the answered, clarify, degraded, and both low-evidence branches; useChat folds workflow/troubleshooting into the specific message (useChat.ts:74-78) and Chat.tsx:145-146 renders a per-message snapshot, so the transcript preserves the ledger's history instead of one mutating panel.
- State is bounded and coercion-hardened everywhere it crosses the model boundary: 8 hypotheses / 12 steps / 20 triedActions / 900-char rolling summary, with zod .catch() on every enum — probe confirmed an invalid status "maybe" is silently coerced to "untested" rather than corrupting the ledger.
- The support-engineer behaviour is explicitly encoded, not hoped for: answer rule 5 mandates exactly ONE next diagnostic step and waiting for the result, rule 6 mandates current-step-only for guides (prompts.ts:64-65), and stateBlock (prompts.ts:111) feeds the live ledger with per-hypothesis statuses back into every later turn.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-AGT-01` | 🟠 high | One invalid sub-object silently discards the ENTIRE statePatch — context, profile and workflow all lost, unlogged | S |
| `EP-AGT-02` | 🟠 high | session.workflow is never cleared — a Guide checklist renders above every later answer for the session's life | S |
| `EP-AGT-03` | 🟠 high | Without an LLM the Fix ledger cannot advance and overwrites the original problem with the follow-up text | M |
| `EP-AGT-04` | 🟠 high | The product's own one-click follow-up "هنوز حل نشده" drops out of the Fix flow into a generic refusal | S |
| `EP-AGT-05` | 🟡 medium | Personalization is largely nominal: two profile fields are write-only dead state, and nothing is inferred without an LLM | M |
| `EP-AGT-06` | 🟡 medium | Hypothesis ledger is replaced wholesale — a shortened model response silently erases tested/rejected history | S |
| `EP-AGT-07` | 🟡 medium | No deterministic resolution — a Fix flow has no termination condition without the model | S |
| `EP-AGT-08` | 🟡 medium | The agentic claims are never measured end-to-end: the eval harness is strictly single-turn | M |
| `EP-AGT-09` | 🟡 medium | triedActions is declared, bounded, prompt-fed — and never populated by any deterministic path | M |
| `EP-AGT-10` | 🟡 medium | Inferred context is not correctable through the UI, and a stale platform survives a product topic switch | M |
| `EP-AGT-11` | ⚪ low | Greeting/chitchat detection is anchored-exact, so ordinary pleasantries take the full 2-3 model-call path | S |
| `EP-AGT-12` | ⚪ low | The keyless Fix message lists every hypothesis, contradicting the ONE-next-step rule it is meant to embody | S |

### 5.5 Product quality, value & business viability — 73/100

*A genuinely well-conceived support-deflection product with the right stance (refuse rather than guess), real Liara-wide corpus coverage and honest evidence culture — but it ships the weakest measured retrieval configuration, has never been exercised against a real LLM, and is missing the two things that turn it from a strong demo into a business: an escalation handoff and a working "which docs fail users" analytics loop.*

**Why this score:** Starts high on product thinking: the ICP is specific, the refusal-over-guessing stance is the correct and rare choice for this category and is genuinely implemented (gate, no-citations-on-refusal, user-visible verification note), the corpus spans all 11 Liara product lines, live retrieval probes return the right pages on most realistic queries, and the Ask/Fix/Guide surface plus experience-adaptive prompting is real differentiation over both docs-site search and ChatGPT-with-pasted-docs. The evidence culture (measured retrieval numbers committed, answers-mode explicitly declared unrun) is more honest than most commercial products. That is comfortably 'strong' territory on intent and craft. It does not reach 75+ because as a *product/business* it is unfinished in ways that matter more than any of its engineering: the primary claim (answer quality) has never been measured or even run once against a real model; the shipped configuration is the weakest one benchmarked (44% vs 58% Recall@1, embeddedCount=0); the deflection loop has no escalation exit, so it cannot be safely fronted to customers; the negative-feedback analytics that would prove ROI to Liara record opaque uuids; developer strings leak into user copy; and there is no unit-economics model behind a free-router dependency no cloud vendor could ship on. Not below 70, because none of these are architectural dead ends — the seams (LiaraProvider, AI_BASE_URL, comment field, local embeddings) already exist and each fix is S/M effort. 73 = the top of 'adequate with notable weaknesses': an excellent demo two or three deliberate weeks from being a product.

**Strengths**

- Correct product stance for the category, implemented not just claimed: the evidence gate refuses on low confidence (src/lib/agent/orchestrator.ts:146-187), deliberately withholds citations on a refusal so a 'couldn't find it' isn't dressed up with three confident links (orchestrator.ts:174-176), and surfaces the claim-verification warning to the user rather than only the log (orchestrator.ts:238-248). This is what makes an assistant safe to put in front of paying cloud customers.
- Corpus is real and Liara-wide, not a toy slice: 3,746 chunks / 1,142 files pinned to docs commit 31f2ef7 across all 11 product lines (paas 1197, ai 1052, one-click-apps 442, dbaas 356, iaas 183, email-server 168, object-storage 126, references 130, dns 31, mirrors 47, overview 14). A generic ChatGPT session cannot reach this and the docs site's own search cannot reason over it.
- Retrieval is genuinely useful on realistic queries, verified by running the shipped search() directly: 'how do I deploy a Django app with postgres' → docs.liara.ir/paas/django/how-tos/connect-to-db/postgresql/ at rank 1; 'خطای 502 bad gateway' → the 502 fix pages; 'اتصال دامنه اختصاصی و CNAME' → paas/domains/add-domain. Latency 3-186 ms. This beats keyword search on the docs site for mixed Persian/English phrasing.
- Real differentiation beyond RAG-over-docs: auto-inferred Ask/Fix/Guide with a persisted hypothesis ledger and workflow checklist that survive a weak-retrieval turn instead of collapsing into a flat refusal (orchestrator.ts:152-171), plus experience-adaptive answer style (prompts.ts:140-150) and a one-diagnostic-step-at-a-time troubleshooting rule (prompts.ts:64). That is a support-engineer product, not a search box.
- Honest evidence culture that a business buyer can audit: measured retrieval metrics committed (evals/results/retrieval-2026-08-20.json), and docs/EVALUATION.md:190 states outright that answers-mode was never run — no fabricated quality numbers. Rare, and it is the reason the rest of the claims are believable.
- The seeds of the Liara-side business artifact exist: a documentation-gap recorder fires on low-confidence, repeated-clarification and negative feedback (src/lib/obs/gaps.ts), rolled up on /internal alongside index freshness, provider state and eval scores — i.e. the product is designed to tell Liara which docs to fix, not just to answer users.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-PRD-01` | 🔴 critical | The core value claim — answer quality — has never been measured or even run against a real model | M |
| `EP-PRD-02` | 🟠 high | The product ships the weakest retrieval mode it benchmarked, while marketing the strongest | M |
| `EP-PRD-03` | 🟠 high | No escalation path — the support-deflection loop has no exit, so the product cannot be safely fronted to customers | M |
| `EP-PRD-04` | 🟠 high | Negative-feedback analytics are structurally unusable — the thumbs-down signal cannot be traced back to a question | S |
| `EP-PRD-05` | 🟡 medium | Developer-only strings leak into end-user copy, breaking the product illusion | S |
| `EP-PRD-06` | 🟡 medium | Deep-anchor citations — the headline trust differentiator — cover only 37% of the corpus | M |
| `EP-PRD-07` | 🟡 medium | Corpus scope caps the deflectable ticket volume: no pricing, quota, status or account state | L |
| `EP-PRD-08` | 🟡 medium | No unit economics, and the default model supply chain is not one a cloud vendor can ship on | S |
| `EP-PRD-09` | 🟡 medium | Conversations do not persist, and a reload leaves invisible server-side context attached | S |
| `EP-PRD-10` | ⚪ low | The archetypal triage query — vague crash, empty logs — retrieves irrelevant pages | M |
| `EP-PRD-11` | ⚪ low | Landing promise overshoots the delivered behaviour | S |

### 5.6 UX, usability & interaction design — 78/100

*Unusually disciplined CSS and state design for a hackathon build — correct logical-property RTL, a real 3-state theme with no-flash, a fully enumerated 6-state voice model, and a proper Persian error taxonomy — undercut by four concrete core-flow defects a Persian user on a phone hits within the first minute: keyboard occlusion of the composer, LTR-flipping prose paragraphs, no way to stop generation, and refusal states that dead-end.*

**Why this score:** Not 85+: four defects sit on the primary path, not the polish layer. The composer disappearing under the mobile keyboard (globals.css:1006 + missing `interactive-widget`) and paragraphs flipping to LTR whenever a sentence opens with a command (Markdown.tsx:38) are both first-minute, every-session failures for the stated target user — a Persian developer on a phone. No stop button despite a live AbortController, and a landing that clips its own onboarding chips when autofocus opens the keyboard, compound that. The evidence panel — the product's differentiator — has its inline [n] markers inert and its 914-of-918 Persian titles forced to `dir=\"ltr\"`. Not below 75: the craft underneath is real and rare. Layout is written almost entirely in logical properties and the RTL mirroring of the message bubble is correct (a detail most ports get wrong); the theme implements all three states with the correct `:not([data-theme=\"light\"])` guard and a no-flash script; the voice hook enumerates six states with per-state Persian labels, handles the stop-during-permission-prompt race, releases tracks on unmount, and structurally cannot lose typed text; errors are six distinct Persian messages with a correct retry; reduced-motion is honored including the decorative blobs; contrast passes AA in both themes (measured 5.26:1 / 7.31:1). Nothing here is filler or dead UI. 78 = strong execution with a short, entirely fixable list of core-flow bugs — most of the high-severity items are S-effort.

**Strengths**

- Genuine RTL discipline, not a `dir="rtl"` sprinkle: globals.css uses logical properties throughout (`padding-inline`, `inset-inline-start`, `border-inline-start`, `margin-inline-end`, `text-align: start`, `border-end-end-radius`) with essentially no physical left/right in layout. The user bubble at globals.css:319-328 (`margin-inline-start: auto` + `border-end-end-radius`) correctly mirrors the outgoing-message convention to RTL (bubble and tail on the left), which most RTL ports get backwards.
- Theme handling is textbook: `:root` light palette, dark redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` (globals.css:32-54) AND under `:root[data-theme="dark"]` (globals.css:56) so the toggle wins in both directions, plus a pre-paint inline script (layout.tsx:27) that eliminates the light/dark flash. Contrast computes to 5.26:1 (light) and 7.31:1 (dark) for `--muted` on `--bg` — passes AA at every size used.
- The voice flow enumerates all six states with a distinct Persian label for each (Chat.tsx:47-54), wires `aria-pressed` + `role="status" aria-live="polite"` (Chat.tsx:118-122), handles the stop-pressed-during-permission-prompt race (useVoice.ts:113-118, `cancelRef`), releases mic tracks on unmount (useVoice.ts:55-65), and structurally guarantees a mic failure can never destroy typed text — the transcript is *appended* by the caller (Chat.tsx:78), never assigned.
- Error UX is specific rather than generic: six distinct Persian messages keyed by error code (useChat.ts:31-48), an inline `role="alert"` block, and a retry that correctly drops the failed assistant turn before re-sending (useChat.ts:230-237). Stream-ended-without-terminal-event is caught and surfaced as an error rather than hanging (useChat.ts:210).
- `prefers-reduced-motion` is honored three times (globals.css:139, 247, 987) and covers the decorative pieces that usually get missed — the ambient blobs, the logo entrance, and the mic pulse.
- Streaming feedback is well-judged: Persian stage labels that auto-clear on the first token (useChat.ts:162), and sticky-scroll gated on a 120px near-bottom check (Chat.tsx:177-184) so scrolling up to re-read is not hijacked mid-stream.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-UX-01` | 🟠 high | Mobile keyboard covers the composer: fixed 100dvh shell with no `interactive-widget` viewport hint | S |
| `EP-UX-02` | 🟠 high | `dir="auto"` flips whole Persian paragraphs to LTR whenever a sentence opens with a command or identifier | M |
| `EP-UX-03` | 🟠 high | No stop-generation control, and the composer is fully disabled while streaming | S |
| `EP-UX-04` | 🟠 high | Session id survives reload but the transcript does not — stale server context is silently applied to an apparently blank chat | M |
| `EP-UX-05` | 🟡 medium | Citation labels hardcode `dir="ltr"` around titles that are 99.6% Persian | S |
| `EP-UX-06` | 🟡 medium | Inline `[n]` citation markers are inert text — the core evidence affordance is not interactive | M |
| `EP-UX-07` | 🟡 medium | Refusal / low-evidence answers dead-end with no recovery affordance — including from the app's own starter chip | M |
| `EP-UX-08` | 🟡 medium | Landing content is clipped and unreachable on short viewports — `overflow: hidden` plus flex centering plus autofocus | S |
| `EP-UX-09` | 🟡 medium | Screen-reader experience: token-level deltas stream into one polite live region, and turns carry no role labels | M |
| `EP-UX-10` | 🟡 medium | Read-aloud silently does nothing when no Persian voice is installed, and races `getVoices()` on first use | S |
| `EP-UX-11` | ⚪ low | Several interactive controls fall below the 44px minimum touch target | S |
| `EP-UX-12` | ⚪ low | No client-side input-length guard, and secret redaction is never surfaced to the user | S |

### 5.7 Accessibility (WCAG 2.2 AA) — 68/100

*Real, deliberate accessibility groundwork — native semantics, Persian labels on every icon button, excellent bidi/RTL handling, honoured reduced-motion — undercut by genuine WCAG 2.2 AA failures on the product's core surface: a streaming live region that will flood screen readers, a 2.93:1 link colour, a keyboard-unreachable scroll container, and no speaker attribution or heading structure in the chat view.*

**Why this score:** Not 75+: four failures land on the primary reading path and would be caught by any real screen-reader or axe pass — the streaming live region (critical, and it degrades the product's core interaction specifically for the users live regions exist to serve), a 2.93:1 link colour in light mode, a chat log that keyboard-only users cannot scroll in Chromium, and a transcript with no speaker attribution or heading structure. Two of the three headline capabilities (Guide checklist, Fix hypotheses) are semantically flat because their status glyphs are aria-hidden. Not below 60: this is clearly not accidental — labels are on every icon button, aria-pressed is on every real toggle, controls are native elements with no ARIA reinvention, reduced-motion is honoured twice over, body/muted contrast passes AA in both themes, the new gradient send button measures 7.8–9.9:1, and the bidi work (dir=auto, bdi, logical properties, IME composition guard) is better than most Persian-first products ship. 68 reflects a solid foundation with a well-defined, mostly S-effort fix list: eight of the twelve findings are single-attribute or single-token changes, and the score would move into the low 80s once findings 1–5 are addressed.

**Strengths**

- Native semantics throughout, no ARIA-widget reinvention: every control is a real <button>/<textarea>/<a>, sources use <details>/<summary> (src/components/Sources.tsx:28-29), so keyboard operability comes for free. `rg -n 'tabIndex\|role="button"\|onKeyDown.*div' src/` returns nothing — there are no div-buttons or custom focus traps to get wrong.
- Every icon-only control is labelled in Persian and exposes toggle state: send/mic (Chat.tsx:104,108,113), theme (Chat.tsx:60), copy (CodeBlock.tsx:73), feedback (Feedback.tsx:70,79). `aria-pressed` is present on the three genuine toggles — mic (Chat.tsx:108), listen (Chat.tsx:158), feedback (Feedback.tsx:71,80) — satisfying 4.1.2 for state, and VOICE_LABEL (Chat.tsx:47-54) makes the mic label state-dependent rather than static.
- Bidi handling is better than most Persian products: html lang=fa dir=rtl (layout.tsx:31), dir="auto" on user text, assistant markdown, paragraphs and list items (Chat.tsx:148,233; Markdown.tsx:28,38,39), <bdi dir="ltr"> around source titles (Sources.tsx:36), dir="ltr" + unicode-bidi on code (globals.css:474-483, 510-512), and CSS logical properties (margin-inline, inset-inline, border-inline-start) used consistently rather than left/right — so mirroring is correct by construction, not by patch.
- Reduced motion is genuinely honoured, twice: a global override collapsing animation-duration/iteration-count/transition-duration (globals.css:139-147) plus explicit `animation: none !important` for the infinite offenders — mic pulse, ambient blobs, logo, headline (globals.css:247-249, 987). The infinite background blobs are also aria-hidden (Chat.tsx:191).
- Body and secondary text contrast passes 1.4.3 comfortably in both themes: --ink #181f24 on --bg #f6f8f9 = 15.64:1; --muted #5d6975 on --bg = 5.27:1, on --surface = 5.61:1; dark --muted #94a0aa on #0b0e11 = 7.25:1. The gradient send button, the riskiest new colour, is fine: #06282f measures 9.92:1 on --g1 #7ce3a8 and 7.80:1 on --g2 #38c6f4 (all computed with the WCAG relative-luminance formula).
- Text entry respects IME and Persian input: Enter submits, Shift+Enter newlines, and `!e.nativeEvent.isComposing` (Chat.tsx:95) prevents the classic bug where an IME/keyboard-layout composition commit fires a premature send. Voice transcripts are appended to — never replacing — typed text, and focus returns to the textarea afterwards (Chat.tsx:78, 82).

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-A11Y-01` | 🔴 critical | Streaming answer re-announces from scratch on every token inside role=log/aria-live | M |
| `EP-A11Y-02` | 🟠 high | Link/accent colour fails 1.4.3 (2.93:1) and the same token is the focus indicator (fails 1.4.11) | S |
| `EP-A11Y-03` | 🟠 high | Chat log is a scrollable region with no keyboard access (SC 2.1.1) | S |
| `EP-A11Y-04` | 🟠 high | Focus is destroyed on landing→chat transition and later stolen back mid-read | M |
| `EP-A11Y-05` | 🟠 high | No speaker attribution, no per-message heading, and no <h1> in the chat view (1.3.1 / 2.4.6) | S |
| `EP-A11Y-06` | 🟡 medium | Workflow and hypothesis status is conveyed only by an aria-hidden glyph plus colour | S |
| `EP-A11Y-07` | 🟡 medium | Live regions are injected together with their content, so the first announcement is dropped | S |
| `EP-A11Y-08` | 🟡 medium | Input field boundary is invisible (1.17:1) and the textarea's focus outline is explicitly removed | S |
| `EP-A11Y-09` | 🟡 medium | Source links, sources summary, and the 'still broken' button are under the 24px minimum target (SC 2.5.8, WCAG 2.2 AA) | S |
| `EP-A11Y-10` | 🟡 medium | No automated accessibility gate, and DESIGN.md's a11y section overclaims | M |
| `EP-A11Y-11` | ⚪ low | English content inside lang="fa" is read with Persian phonemes (SC 3.1.2) | S |
| `EP-A11Y-12` | ⚪ low | Toggle buttons expose state visually but not in their accessible name | S |

### 5.8 Security posture — 78/100

*Genuinely thoughtful, layered application security — stream-enforced body caps, server-minted session ids, hashed identifiers in logs, no raw-HTML sink, real security headers — undercut by one proven data-protection hole (feedback comments bypass redaction and are served verbatim by /api/diag), a spoofable rate-limit key, and no cross-origin request controls on the paid upload endpoint.*

**Why this score:** Not 90+: three findings are real data-protection or control failures, not hardening nits — user-typed secrets provably reach disk and the /api/diag response unredacted (reproduced end-to-end), the raw session credential is persisted in a file while every other sink hashes it, and the rate-limit key trusts the spoofable leftmost X-Forwarded-For hop, which defeats the only cost and availability control the system has. A production-grade posture would also have an origin check on a paid multipart upload endpoint and a CSP without 'unsafe-inline'. Not below 75: the fundamentals are done properly and often better than commercial code — stream-enforced byte caps rather than trusting content-length, per-key-before-global limiter ordering with the DoS reasoning written down, server-minted non-adoptable session ids, hashed identifiers in logs, a depth-recursive secret-key stripper in the logger, redaction wired into the easily-missed rolling-summary sink, zero raw-HTML sinks, no client-exposed env, full security-header set, and 39 passing tests across six security-specific test files. The gaps are all narrow, well-localised, and mostly S-effort; none require redesign. 78 reflects a strong, deliberately reasoned posture with a handful of concrete holes that a competent team closes in a day.

**Strengths**

- Secret redaction is wired into the non-obvious model-bound sink: `sessions.pushTurn` redacts before the rolling summary, which `prompts.stateBlock` re-injects into the system prompt on every later turn (src/lib/state/sessions.ts:104-113). Most implementations redact only the current turn and leak on turn 2. Verified passing by tests/redact-e2e.test.ts.
- Body caps are enforced on the actual stream, not the advisory content-length header, and the reader is `cancel()`ed rather than merely released so an oversize upload stops arriving (src/lib/security/validate.ts:47-106). Used by both /api/chat and /api/voice/transcribe before `formData()` buffers anything.
- Session ids are server-minted `crypto.randomUUID()` and a client-supplied unknown id is never adopted (src/lib/state/sessions.ts:15-38), closing session fixation; raw ids are SHA-256-truncated in every log line (src/app/api/chat/route.ts:55-58, src/lib/agent/orchestrator.ts:290).
- Rate-limit ordering was reasoned about rather than copy-pasted: a request rejected by its own per-key bucket does not burn a global token, so one throttled attacker cannot drain the shared backstop (src/lib/security/ratelimit.ts:43-57). Bucket key is the IP, never the client-mintable sessionId — proven by tests/route-chat.test.ts ("a fresh sessionId does NOT reset the bucket").
- No HTML injection sink: react-markdown with no `rehype-raw`, anchors forced to `rel="noopener noreferrer nofollow"` (src/components/Markdown.tsx:29-44); the only `dangerouslySetInnerHTML` is a static no-flash theme constant (src/app/layout.tsx:27,33). Provider keys never reach the client — no `NEXT_PUBLIC_*` config, `.env` is gitignored, and the JSON logger strips secret-named keys at every depth (src/lib/obs/log.ts:8-15).
- Prompt-injection defense is layered rather than regex-only: `<user_data>`/`<evidence>` fences with an explicit data-not-instructions instruction, and `sanitizeFences()` applied to both the state block and the evidence block at every prompt construction site (src/lib/agent/prompts.ts:46,87,91). The system prompt itself contains no credentials, so a fence bypass has low blast radius.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-SEC-01` | 🟠 high | Feedback comments bypass redaction: user-pasted secrets persist to disk and are served verbatim by /api/diag | S |
| `EP-SEC-02` | 🟠 high | Raw sessionId written to feedback.jsonl, violating the codebase's own 'session id is a credential' invariant | S |
| `EP-SEC-03` | 🟠 high | Rate-limit key trusts the leftmost X-Forwarded-For hop, which is client-controlled behind an appending proxy | S |
| `EP-SEC-04` | 🟡 medium | No Origin / Sec-Fetch-Site check on any POST route; the multipart voice endpoint is a CORS-simple request | S |
| `EP-SEC-05` | 🟡 medium | redactSecrets misses the most common bare-token pastes, including the Liara CLI's own login form | S |
| `EP-SEC-06` | 🟡 medium | Permissions-Policy disables the microphone for the app's own origin, breaking the voice feature it ships | S |
| `EP-SEC-07` | 🟡 medium | /api/diag and /internal are gated only by an env flag — no authentication on a user-content surface | S |
| `EP-SEC-08` | 🟡 medium | Voice endpoint consumes one rate-limit token for an 8 MB upload plus a paid 40 s third-party job | S |
| `EP-SEC-09` | 🟡 medium | CSP permits 'unsafe-inline' scripts, neutralising it as XSS defense-in-depth | M |
| `EP-SEC-10` | ⚪ low | Uploaded audio has no MIME allowlist or magic-byte check before being relayed to the paid STT provider | S |
| `EP-SEC-11` | ⚪ low | Prompt-injection detector is a regex allowlist and is bypassed by ordinary paraphrase, spacing, or another language | M |
| `EP-SEC-12` | ⚪ low | Claim-verification prompt embeds the model answer unfenced and unsanitized | S |

### 5.9 Reliability, resilience & error handling — 78/100

*A genuinely well-built failure model — typed taxonomy, a three-level degradation ladder, a correct SSE lifecycle and unusually rigorous client stream parsing — undermined at the edges by an unbounded retry budget (~91s per provider call, ~182s to a user-visible error), a streaming deadline that truncates long answers and mislabels them `internal`, no user-facing cancel, and no reuse of the existing sources-only fallback when the answer model dies.*

**Why this score:** Not 85+: four of the twelve findings are user-visible failure behaviour on the most likely production fault (a slow or rate-limited free LLM route) — ~91s per provider call with timeouts retried, ~182s to any user feedback against a 120s platform cap, no way to cancel, a streaming deadline that truncates long answers and mislabels them 'internal', and a ready-made sources-only fallback that is never reused when the model dies. There is also no React error boundary, so one bad render loses the conversation. Several of these are the team's own REL-001/REL-201/REL-202/REL-203 from docs/reviews/round-001 and round-002, still live in the code while docs/reviews/FINAL-AUDIT.md:107 asserts \"No open actionable P0/P1/P2\" — the gap between the claimed and the actual state costs credibility as well as points. Not below 75: the fundamentals are genuinely strong and rare at this level — a coherent typed taxonomy wired end to end into bilingual user copy, client abort treated as a non-error, a correct SSE lifecycle with guarded writes and finally-clean teardown, an unusually careful client stream parser that explicitly detects a stream ending without a terminal event, stream-enforced body caps, a real three-level degradation ladder (vector→lexical, model-plan→deterministic plan, verify→skip), no unhandled promise rejections anywhere, honest reader/recorder/timer cleanup, and 192 passing tests. 78 = strong engineering with real, concrete edge-case gaps.

**Strengths**

- Coherent typed error taxonomy end to end: ModelError/ClientAbortError (ai/provider.ts:10-26), IndexMissingError (retrieval/index.ts:110), SttError (speech/soniox.ts:16), ValidationError/PayloadTooLargeError (security/validate.ts:8,105) — each mapped to a bilingual user message (agent/orchestrator.ts:405-421) and a distinct Persian client message with a retry affordance (components/useChat.ts:31-48, Chat.tsx:129-131).
- Client disconnect is modelled as a non-error, not a failure: ClientAbortError short-circuits before any error event or error metric, the turn is still recorded so a retry isn't mistaken for a stateless first turn (orchestrator.ts:263-270), and verifyAnswer skips its model call when the signal is already aborted (verify.ts:32).
- SSE lifecycle is correct: closed-flag guarded writes that tolerate enqueue-after-disconnect, a 15s comment heartbeat, and clearInterval + controller.close in a finally that runs on every path (api/chat/route.ts:63-97). Headers (no-transform, x-accel-buffering:no) are right for proxied streaming.
- Client terminal-event handling is better than most: CRLF normalisation, malformed-frame skip, unconsumed-tail carry, a final flush of the buffer, and an explicit `if (!terminal) fail('network')` for a stream that ends without done/error (useChat.ts:194-212), all covered by tests (tests/ui-usechat.test.ts).
- A real degradation ladder rather than all-or-nothing: vector-search failure falls back to lexical (retrieval/index.ts:185-189), plan-model failure falls back to a deterministic plan (plan.ts:358-361), verification failure is swallowed and never breaks the answer (verify.ts:58), keyless mode still returns grounded sources (orchestrator.ts:190-199), and health 503s only when the index — the one hard dependency — is unloadable (api/health/route.ts:19-26).
- Boundary hygiene: body caps enforced on the actual stream with reader.cancel() in finally rather than trusting content-length (validate.ts:47-100, proven by tests/route-chat.test.ts:122); rate limit consumed before body read; no floating unhandled promises anywhere (`rg 'void .*\(\|\.then\('` — every fire-and-forget has a .catch: gaps.ts:40, soniox.ts:99-100); generateStream cancels its reader in a finally (provider.ts:146-150). `npx vitest run` → 20 files, 192 tests, all passing.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-REL-01` | 🟠 high | Answer-model failure returns a bare error even though the sources-only fallback already exists | S |
| `EP-REL-02` | 🟠 high | Retry budget is unbounded against any request deadline: ~91s per provider call, ~182s to a user-visible error | M |
| `EP-REL-03` | 🟠 high | MODEL_TIMEOUT_MS also aborts the response body, so a long answer is truncated mid-stream and reported as 'internal' | M |
| `EP-REL-04` | 🟡 medium | No user-facing cancel for an in-flight stream; the only escape destroys the conversation | S |
| `EP-REL-05` | 🟡 medium | SSE cancel() only logs — client disconnect does not stop in-flight model work | S |
| `EP-REL-06` | 🟡 medium | Client collapses the server's voice error taxonomy into one generic message | S |
| `EP-REL-07` | 🟡 medium | No React error boundary — a render crash blanks the app and loses the conversation | S |
| `EP-REL-08` | 🟡 medium | Recording has no length cap; an over-long clip fails late with a misleading message | S |
| `EP-REL-09` | 🟡 medium | finish() re-resolves the session by id and can write the turn into a phantom session | S |
| `EP-REL-10` | ⚪ low | Non-network exceptions are retried as network failures and reported as model_unavailable | S |
| `EP-REL-11` | ⚪ low | Index load has an unguarded read and non-atomic writes, so a corrupt index reports 'internal' instead of index_missing | S |
| `EP-REL-12` | ⚪ low | Concurrent requests on one session share a single mutable SessionState | M |

### 5.10 Observability & operational readiness — 68/100

*The per-request instrumentation is unusually thoughtful for a build this size (hashed PII, actual-served-model capture, Persian-aware token estimation, typed error taxonomy), but the operational loop is broken end to end: user feedback cannot be joined to any request signal, the three main silent-degradation modes (planner fallback, verification off, refusal rate) emit no signal at all, there is zero aggregation, and the only drill-down surface is a 50-entry in-process ring buffer that 404s in production by default.*

**Why this score:** Not higher than 75: the dimension's central question — \"could you debug a bad answer in production?\" — is answered no on four independent counts, each verified in code: feedback rows cannot be joined to any request (F1), no trace records the answer text and traces don't exist in prod by default (F7), the retrieval/plan path that produced the answer has no persistent record, and the two largest silent-degradation modes (planner fallback F2, verification off F3) emit literally nothing. Add zero aggregation of any kind (F6) and invisible throttling (F5) and the monitoring story is events-without-rates. Not lower than 60: the instrumentation that exists is well above hackathon norm and demonstrably correct — I ran the suite and captured real `request_metrics` lines showing split retrieval/model latency, confidence, cache-hit, hashed session, and the actually-served model; PII hashing is consistent and joinable; the error taxonomy is typed end to end with client-abort correctly excluded; health fails closed and is tested; the trace buffer redacts secrets. 68 reflects a solid per-request telemetry foundation with a broken operational loop on top of it — and notably, nine of the twelve findings are S-effort field-plumbing changes, so the gap is shallow rather than architectural.

**Strengths**

- `RequestMetrics` is genuinely rich and actually emitted on every path — verified live by running `npx vitest run tests/orchestrator.test.ts`, e.g. `{"requestId":"req-test","sessionId":"d7eaa893eddb","intent":"question","product":"paas","retrievalLatencyMs":2,"candidateCount":1,"modelLatencyMs":0,"totalLatencyMs":10,"inputTokens":695,"outputTokens":27,"cacheHit":false,"retrievalConfidence":"medium","modelRoute":"smart:openai/gpt-4.1-mini",...,"event":"request_metrics"}` — retrieval and model latency are split, which is the split that matters when triaging slowness.
- PII hygiene is production-grade and consistent: client IP and session id are both sha256-truncated to the same 12 chars so the two log streams join (src/app/api/chat/route.ts:55-58, src/lib/agent/orchestrator.ts:290), and the trace ring buffer runs `redactSecrets()` on the stored user message before it lands in the buffer (src/lib/agent/orchestrator.ts:309).
- The logger itself is defensive in the right places: depth-wise stripping of secret-named keys via a `JSON.stringify` replacer, `ts`/`level`/`event` spread last so caller fields cannot shadow them, and a fallback line that preserves the event when fields are unserializable (src/lib/obs/log.ts:13-25).
- Actual-served-model attribution through the streaming path (`onMeta` fired from the first SSE chunk's `model` field, src/lib/ai/provider.ts:135-137, surfaced as `modelRoute: "smart:x → actual"` at orchestrator.ts:302). On a dynamic router like `openrouter/free` this is the only way to know what answered — most builds never capture it.
- Error taxonomy is typed and travels end to end: `ModelError.code` → `errorCategory` metric field → localized user message (orchestrator.ts:271-277, verified in live output as `"errorCategory":"model_unavailable"`), with client aborts deliberately excluded from error metrics so disconnects don't inflate the error rate (orchestrator.ts:263-270).
- `/api/health` fails closed — 503 + `status:degraded` when the index is unloadable, 200 in keyless mode — and it is the one observability surface with a real test (tests/health.test.ts:15-40). `/internal` is gated server-side with `notFound()` (src/app/internal/page.tsx:11), not merely hidden client-side.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-OBS-01` | 🟠 high | User feedback is unjoinable to any request signal — thumbs-down cannot be traced to a pipeline run | S |
| `EP-OBS-02` | 🟠 high | Planner fallback is computed as a diagnostic then thrown away — silent quality collapse | S |
| `EP-OBS-03` | 🟠 high | Claim verification has no operational signal, and its failure mode inverts the metric | S |
| `EP-OBS-04` | 🟠 high | No outcome dimension in metrics — refusal, clarify, chitchat and injection-block are indistinguishable | S |
| `EP-OBS-05` | 🟡 medium | Rate-limit rejections are completely unlogged, including the global spend backstop | S |
| `EP-OBS-06` | 🟡 medium | Zero aggregation anywhere; the gap summary is fetched but never rendered | M |
| `EP-OBS-07` | 🟡 medium | The only drill-down surface is a 50-entry in-process ring buffer that is off in production and unauthenticated when on | M |
| `EP-OBS-08` | 🟡 medium | Cost metric is absent by default and cannot attribute spend to the model that actually served | S |
| `EP-OBS-09` | 🟡 medium | Provider retries, timeouts and upstream status codes are entirely unlogged | S |
| `EP-OBS-10` | 🟡 medium | /api/diag blocks the event loop with a synchronous read+parse of up to 5MB of gaps.jsonl | S |
| `EP-OBS-11` | 🟡 medium | Feedback/gap write path lacks the redaction and hashing the log and trace paths enforce | S |
| `EP-OBS-12` | ⚪ low | Feedback-driven gap rows are keyed on a random UUID, so 100% of them are unaggregatable noise | S |

### 5.11 Data & analytics quality (eval integrity) — 68/100

*A genuinely real, well-labelled 61-case bilingual eval set with an auditable, CI-enforced harness — undermined by no held-out split (the ranker was hand-tuned on the same cases), published documentation that contradicts the committed artifact in five places, regression floors far too loose to catch a real drop, and zero measured data on the answer quality that carries the most weight.*

**Why this score:** Starts high because the foundations are real and verifiable, not claimed: 61 richly-labelled bilingual cases, gold URLs validated against the live corpus by a passing test, per-case rows that recompute the published aggregates exactly, floors wired into CI, and benchmark artifacts that carry commit/env/config plus honest disclosure notes. That is well above the median for a competition build and rules out anything below 60. It does not reach 75+ because the things that make a number trustworthy are the things missing: the ranker's boosts (retrieval/index.ts:215-226) were fitted to the same 48 cases the score is reported on with no holdout, so 0.813 is a training-set figure; the primary evaluation document contradicts its own committed artifact in five places (57 vs 61 cases, 9 vs 13 gate cases, 7/9 vs 12/13, 15 vs 9 misses); the floors are 15-17pp below measured and would pass a 7-case regression; the results artifact records no commit or docsCommit while sync-docs pulls an unpinned upstream HEAD, so nothing is reproducible; hit@5 is measured after evidence selection where 27/48 cases expose fewer than 5 pages; and the heaviest-weighted quality axis has zero measured data with an uncalibrated same-family judge. Each is individually fixable — most are S-effort — which is why this lands at the top of the 60-74 band rather than the bottom: the instrumentation is sound, the discipline around what it publishes is not.

**Strengths**

- Metrics are auditable and not fabricated: recomputing hit@1/3/5 and MRR from the per-case rows in evals/results/retrieval-2026-08-20.json reproduces the summary block exactly (0.4375 / 0.75 / 0.8125 / 0.5920138888888888), and every recorded `rank` is consistent with its own `topPages`/`expected` fields (0 inconsistencies across 48 sourced cases).
- Gold labels are validated against the live corpus, not asserted: tests/evals-schema.test.ts:76-92 resolves every `expectedSources` URL against the real docs link list (`public/all-links-llms.txt`) via a canonicalizer shared with the runner. Verified passing — `npx vitest run tests/evals-schema.test.ts` → 4 passed. This turns upstream doc renames into a test failure, which is the single best data-quality control in the repo.
- Case labels are rich enough to support more than one metric: each case carries expectedSources, expectedFacts, forbiddenClaims, shouldClarify and optional retrieval filters (32/61 cases carry filters), so the same dataset drives retrieval scoring, the LLM-judge rubric, and gate testing without a second dataset.
- Benchmark artifacts record provenance properly: benchmarks/retrieval/modes-2026-08-20.json and benchmarks/load/load-2026-08-20.json both carry ISO timestamp, git commit, model/dims or node/platform/cpus, and the run config — plus an explicit `note` disclosing that the load numbers use the mock LLM and measure plumbing, not model quality.
- The gate metric was hardened after review proved the original was true-by-construction (docs/EVALUATION.md:127-136 documents that a hardcoded `return 'medium'` would have scored 9/9 identically), and the replacement measures the real system decision — injection detector OR evidence gate — at scripts/evaluate.ts:110-116. Publishing that a prior metric was meaningless is unusual and correct.
- Documentation is candid about limits where it matters: EVALUATION.md states the run is a lexical-only lower bound with no query rewriting or filters, names the failing cases with diagnosis, and explicitly says the grounding hit@k and the modes Recall@k are not directly comparable.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-DATA-01` | 🟠 high | No held-out split: the ranker's boosts were fitted on the same 48 cases the score is reported on | M |
| `EP-DATA-02` | 🟠 high | docs/EVALUATION.md publishes five numbers that contradict the committed results artifact | M |
| `EP-DATA-03` | 🟠 high | Regression floors sit 15-17pp below measured — a 7-case hit@5 drop passes CI | S |
| `EP-DATA-04` | 🟠 high | Eval results are not reproducible: no commit/corpus provenance, unpinned docs, same-day overwrite | S |
| `EP-DATA-05` | 🟠 high | "hit@5" is measured after evidence selection, so k is not 5 for 27 of 48 cases | S |
| `EP-DATA-06` | 🟠 high | Zero measured data on answer quality; the LLM judge is uncalibrated self-evaluation | M |
| `EP-DATA-07` | 🟡 medium | Gate accuracy is one-sided and pools two different pass criteria into one ratio | S |
| `EP-DATA-08` | 🟡 medium | README presents hybrid+rerank as the shipped ranker while the shipped index has zero embeddings | S |
| `EP-DATA-09` | 🟡 medium | Modes benchmark records aggregates only — no per-case data, and the headline R@5 lift is 2 cases | S |
| `EP-DATA-10` | 🟡 medium | Per-category tables are published off n=2 for 11 of 20 categories — the percentages are noise | L |
| `EP-DATA-11` | 🟡 medium | "Recall@k" is a mislabel for binary hit@k, and it over-credits the 13 multi-source cases | S |
| `EP-DATA-12` | 🟡 medium | Feedback→gaps loop records a fabricated language and no question text, making it unusable as analytics | S |

### 5.12 Scalability & performance — 77/100

*Unusually honest and well-bounded single-instance design with real reproducible benchmarks, but it has no working horizontal-scale story today (silent session loss on instance N+1), an O(n) brute-force vector scan that is the documented 10x-corpus breaker with no mitigation, and a per-request CPU cost meaningfully higher than the published headline number.*

**Why this score:** Not 85+: there is no horizontal-scale path that works today — the session store is in-process and refuses to adopt unknown ids, so instance #2 silently wipes conversations (the two stateful capabilities, Fix and Guide, are the ones that break). The named 10x-corpus mechanism (vectorTopK) is a measured O(n·d) scan with a full sort and n object allocations per query, with no mitigation short of a rewrite, and it is 29 ms/query at 10x. There is no per-request deadline (retries can reach ~270 s against maxDuration 120), no cancellation on client disconnect, and no event-loop-lag visibility for what is a fully synchronous single-threaded pipeline. The published throughput figure also overstates the real ceiling ~3x because the mock skips the multi-query plan and the entire verify call. Not below 70: every measurable claim I checked held up — the index really is a load-once artifact (174 ms, then 2-28 ms pure CPU per search), every shared store is explicitly capped with an ADR-documented upgrade path, the evidence budget bounds prompt cost independently of corpus size, streaming has heartbeats and correct reader cleanup, and the load benchmark is reproducible, committed with commit/env/config, and carries accurate caveats about the mock. The team knows where the ceilings are and wrote them down; what is missing is that several of them are one small diff away from being raised and have not been.

**Strengths**

- Index is a read-only artifact loaded ONCE into a globalThis cache (src/lib/retrieval/index.ts:62-104) — measured 174 ms load, 92 MB heap / 196 MB RSS, then zero per-request I/O. Retrieval is 2-28 ms of pure CPU (measured via tsx against the real index).
- Every shared mutable store is explicitly capped with a named upgrade path: sessions 5000/24h LRU (sessions.ts:9-10,44-47), answerCache 200 (orchestrator.ts:25,256), lastAction 5000 (orchestrator.ts:36), trace ring 50 (trace.ts:21-27), gaps.jsonl 5 MB rotation (gaps.ts:22,36-37). I found no unbounded in-memory growth anywhere.
- The LLM prompt is bounded independently of corpus size — MAX_EVIDENCE_CHUNKS 8 / MAX_EVIDENCE_CHARS 7000 enforced from chunk #1 (retrieval/index.ts:121-122,246-258) — so answer latency and token cost do not grow as the docs grow.
- A real, checked-in, reproducible load benchmark with commit/env/config and explicit caveats that it uses a mock LLM (benchmarks/load/load-2026-08-20.json, benchmarks/README.md). Percentile method is stated and correct (nearest-rank, scripts/benchmark-load.mjs:28-33); the client fully drains the SSE body (drain(), :83-92) so throughput is not inflated by unread streams.
- Streaming hygiene is solid: SSE heartbeat every 15 s (chat/route.ts:20,76), a `closed` guard so enqueue-after-close cannot throw (chat/route.ts:66-73), and `reader.cancel()` in a `finally` on the provider stream so a consumer throw never leaks a live upstream socket (provider.ts:146-150).
- Zero-model-call short-circuits are real and ordered before any spend: injection refusal, FAQ cache, chitchat, gate refusal (orchestrator.ts:69-90,111-127,146-187). I verified 1 of the 5 benchmark questions actually reaches the cacheable 'high' gate, so the cache is exercised rather than decorative.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-SCALE-01` | 🟠 high | N instances silently reset conversations: in-process session Map + never-adopt policy | M |
| `EP-SCALE-02` | 🟠 high | vectorTopK is an O(n·d) scan + full sort + n object allocations, run once per query (up to 3/request) | M |
| `EP-SCALE-03` | 🟠 high | Headline load number (104 req/s, p50 232 ms) measures a cheaper pipeline than production runs | S |
| `EP-SCALE-04` | 🟡 medium | Whole pipeline is synchronous on one event loop with no offload and no lag metric | M |
| `EP-SCALE-05` | 🟡 medium | /api/diag re-reads and re-parses the entire gaps.jsonl (up to 5 MB) synchronously on every request | S |
| `EP-SCALE-06` | 🟡 medium | Client re-parses the entire conversation markdown on every streamed token | S |
| `EP-SCALE-07` | 🟡 medium | No per-request deadline: retries can exceed maxDuration ~2x and amplify load onto a rate-limited provider | M |
| `EP-SCALE-08` | 🟡 medium | Client disconnect does not cancel the in-flight model call | S |
| `EP-SCALE-09` | 🟡 medium | Embeddings load path parses a ~27 MB JSON into per-chunk arrays before building the Float32Array | S |
| `EP-SCALE-10` | ⚪ low | Rate-limit map sweep is O(n) per request once the map passes 10k keys and may free nothing | S |
| `EP-SCALE-11` | ⚪ low | Index loads lazily inside the first request instead of at process start | S |
| `EP-SCALE-12` | ⚪ low | Runtime JSONL files on local disk contradict the stateless-process claim | S |

### 5.13 Code quality, maintainability & tech debt — 84/100

*Unusually disciplined for a competition build — strict TypeScript with effectively zero `any`, 192 fast behavior-focused tests, rationale-dense comments that explain *why* rather than *what*, and clean module boundaries — held back from production-grade by the complete absence of an automated code-quality gate (no ESLint, no formatter, no `lint` script), two 150–240 line hot functions, ~200 LOC of speculative scaffolding that contradicts the codebase's own stated discipline, and a bilingual-string layer that has already diverged in a user-visible way.*

**Why this score:** Starts high on hard evidence: `npx tsc --noEmit` exits 0 under `"strict": true`; `npx vitest run` gives 20 files / 192 tests / 3.63s all green; `npm audit --omit=dev` reports 0 vulnerabilities; `rg ": any\|as any"` finds exactly one occurrence in all of `src/` (justified, on a dynamically-imported untyped lib); `rg "TODO\|FIXME\|HACK"` finds zero. Total source is a tight 6,054 LOC across 50 files with no file over 480 lines. Comment quality is genuinely top-decile — comments carry non-obvious rationale and regression IDs, and one (injection.ts:52-58) is a "do not reintroduce this" note that will save a future maintainer a real mistake. That profile is 90+ territory on its own. Four deductions: (1) −4 for zero automated quality gate — ESLint is not installed anywhere, proven by four dead `eslint-disable` directives written against a linter that never ran, and there is no formatter or `lint`/`format` script; a serious product does not hand-maintain React hook deps and import hygiene. (2) −4 for ~200 LOC of speculative dead code (`src/lib/liara/mock.ts` with zero production callers, an interface with zero implementers, two unused exports) in a codebase that explicitly documents anti-over-engineering discipline via `ponytail:` markers — the discipline is stated but not enforced. (3) −4 for the two hot functions: `search()` at ~150 lines / ~35 decision points doing six distinct jobs, and `handleChatMessage()` at 236 lines with eight early-return paths plus a 40-line closure; both are the files most likely to be edited next. (4) −4 for the bilingual-string layer, which is not merely stylistic: two fa/en error tables must be kept in sync by hand and the client already discards the server's localized message (useChat.ts:84), while Persian-only hypothesis text is interpolated into English message frames. 84 = top of "strong with real gaps": nothing here is rotten, but a maintainer inherits a linting vacuum and two functions that will keep accreting branches.

**Strengths**

- TypeScript rigor is near-exemplary: `tsconfig.json` sets `"strict": true` with `isolatedModules`, `npx tsc --noEmit` exits 0, and `rg ": any\|as any\|<any>"` over `src/` returns exactly ONE hit — `src/lib/ai/local-embeddings.ts:15` on a `Promise<any>` for the dynamically-imported `@xenova/transformers` pipeline, which is genuinely untypeable at that boundary and carries a comment saying why. Only 26 `as X` assertions and 9 non-null assertions across the whole tree.
- Test suite is fast, behavior-focused, and non-brittle: 20 files / 192 tests in 3.63s. Tests certify contracts rather than implementations — `tests/gate.test.ts:79-84` is an explicit regression lock ("the follow-up relaxation must fire ONLY for pure stopwords, never for off-vocabulary gibberish") with the reasoning inline, and `tests/gate.test.ts:122-125` documents *why* a particular behavior is certified against the real index instead of the fixture. Pure logic is deliberately extracted for testability (`parseSSE`, `applyEvent`, `gateConfidence`, `exactCoverage`, `expandQueries`, `preClassify`, `fallbackPlan`).
- Comments are rationale, not noise — ~21% of `src/lib/retrieval/index.ts` is comment lines and nearly all of it is load-bearing. `src/lib/security/injection.ts:52-58` records a *removed* feature and forbids its return with the reason ("it made confident factual-absence claims the corpus contradicted"); `src/lib/retrieval/index.ts:317-334` explains what the evidence gate deliberately CANNOT do and why trying would cause false refusals. This is institutional memory a new maintainer can actually use.
- Magic numbers are justified in two places, not one: every rerank multiplier in `src/lib/retrieval/index.ts:210-227` has an adjacent one-line reason, AND the boost table is restated in `docs/RETRIEVAL.md:111-129` (`RRF_K = 60`, ×1.25 platform match, `MAX_EVIDENCE_CHUNKS = 8`, `MAX_EVIDENCE_CHARS = 7000`), so the tuning surface is discoverable without reading the implementation.
- Module boundaries are clean and small: `security/`, `retrieval/`, `agent/`, `ai/`, `obs/`, `state/`, `speech/`, `docs/` — every file opens with a 2–5 line header stating its job, no file exceeds 477 lines, and abstractions are earned rather than speculative (`ModelProvider` has two real implementations — `OpenAICompatibleProvider` and `MockLLMProvider` — so it is not an interface-for-one).
- Dependency hygiene is tight for the production surface: nine runtime dependencies, all current majors (Next 15, React 19, zod 3.25, minisearch 7), `npm audit --omit=dev` reports `found 0 vulnerabilities`, and `overrides` in package.json pins two patched transitives with an inline `_overrides_note` explaining the reasoning. Zero `TODO`/`FIXME`/`HACK` markers anywhere in `src/`, `scripts/`, or `tests/`.
- Deliberate simplifications are tracked rather than hidden: four `ponytail:` comments (retrieval/index.ts:271, orchestrator.ts:22, sessions.ts:2, ratelimit.ts:2) each name the ceiling (single-instance, heuristic) and the upgrade path (Redis-compatible store, learned gate), which is exactly the right way to leave a known corner cut.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-MAINT-01` | 🟠 high | No linter, no formatter, no quality gate — four eslint-disable directives target a linter that is not installed | S |
| `EP-MAINT-02` | 🟠 high | Bilingual strings scattered across five files in three patterns; the fa/en error table is duplicated and the client already discards the server's localized message | M |
| `EP-MAINT-03` | 🟡 medium | ~200 LOC of speculative scaffolding with zero production callers, contradicting the codebase's own stated discipline | S |
| `EP-MAINT-04` | 🟡 medium | search() is a ~150-line, ~35-decision-point function doing six separable jobs | M |
| `EP-MAINT-05` | 🟡 medium | handleChatMessage() is a 236-line function with eight early-return paths and a 40-line trailing closure | M |
| `EP-MAINT-06` | 🟡 medium | Dev-only critical advisory chain from an unmaintained embeddings library | S |
| `EP-MAINT-07` | ⚪ low | Bounded-map eviction idiom hand-rolled three times, once with an unnamed magic 5000 that shadows a named constant | S |
| `EP-MAINT-08` | ⚪ low | Five test-only reset hooks exported from production modules with nothing preventing production use | S |
| `EP-MAINT-09` | ⚪ low | Test output is drowned in structured JSON logs, making real failures hard to locate | S |
| `EP-MAINT-10` | ⚪ low | Two styling systems in one component: 1062-line hand-written globals.css alongside stray Tailwind utilities and inline styles | S |
| `EP-MAINT-11` | ⚪ low | Twenty-two issue IDs referenced in code comments resolve only by grepping eight undocumented review directories | S |

### 5.14 Cost efficiency & token economics — 78/100

*Genuinely cost-conscious architecture with real zero-call paths, hard per-call token caps and a documented cost model — but the three headline levers (fast/smart routing, FAQ cache, verify budget) are measurably inert or inverted in practice, and the largest single line item (verify = 42% of input tokens) is unoptimized.*

**Why this score:** 78, not higher: the three cost levers the product advertises are measurably inert as shipped — routing resolves to one identical model string and fires 'smart' on ~95% of turns, the FAQ cache is eligible for 4.9% of turns and unreachable for returning tabs, and the largest input line item (verify, 42% of 5,970 measured tokens/turn) duplicates evidence it need not send. Cost observability exists as a field but produces no number by default (COST_* unset in .env.example, nothing aggregated, no token figure in any benchmark artifact), and the token estimator's 2.2 constant is off by +12% to +34% on the tokenizers the free router actually serves and -39% on cl100k. Not lower than 78: the fundamentals are genuinely production-grade and verified rather than claimed — five real zero-model-call paths correctly ordered so the cheapest check runs first, hard maxTokens at every call site, prompt size flat across turns via a 900-char rolling summary with bounded state patches, a global spend backstop in the limiter (not just per-IP), abort propagation into the provider with verify explicitly declining to spend on a gone client, hash-incremental embedding cache, embeddings off by default, a mock provider so load tests cost nothing, and a docs/COST.md that matches the code line-for-line. That is a stronger cost posture than most products at this scale; the gaps are quantified and six of eleven are S-effort.

**Strengths**

- Zero-model-call paths are real and correctly ordered, verified in code: injection refusal before anything (orchestrator.ts:69-77), FAQ cache lookup BEFORE the plan call (orchestrator.ts:81-90), greeting short-circuit (plan.ts:328 + orchestrator.ts:111-116), keyless degraded mode still returning sources (orchestrator.ts:190-200), and the evidence gate refusing after only the plan call (orchestrator.ts:146-187). The <=2 calls + 1 optional verify budget claim holds.
- Hard output caps at every call site — plan maxTokens 700 / temp 0 (plan.ts:338), answer 1400 / 0.2 (orchestrator.ts:215), verify 400 / 0 (verify.ts:48) — none env-overridable, so a runaway generation cannot happen.
- Prompt size is FLAT across conversation turns: a 900-char rolling summary replaces history (sessions.ts:11,111) and every state patch is bounded (triedActions <=20 sessions.ts:81, hypotheses <=8, workflow steps <=12 in plan.ts). Measured plan prompt 826 tokens on turn 0 and it does not grow quadratically — a common and expensive failure this design avoids.
- A global spend backstop exists in the rate limiter, not just per-IP: 10x RATE_LIMIT_RPM over ALL requests (ratelimit.ts:19,55-57), explicitly documented as a provider-cost guard against header spoofing, and correctly ordered so a throttled client cannot drain it.
- Client-disconnect is honoured where it counts: req.signal reaches the provider fetch (route.ts:83 -> provider.ts:57-63), ClientAbortError is classified separately from timeouts (provider.ts:78), and verify explicitly refuses to spend a call for a gone client (verify.ts:33).
- Indexing cost is properly amortized: build-index.ts:42-45 re-embeds only chunks whose content hash is absent from data/index/embeddings.json (10 changed chunks = 10 embeddings, not 3,746), embeddings are OFF by default (config.ts:15, meta.json embeddedCount=0), and MockLLMProvider makes load benchmarking spend zero provider quota. docs/COST.md matches the code line-for-line — I checked the routing pseudocode, the maxTokens table, the cache eligibility list and the request-class table against source.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-COST-01` | 🟠 high | Verify call re-sends the whole evidence block — 42% of per-turn input tokens for a 1-bit signal | S |
| `EP-COST-02` | 🟠 high | FAQ answer cache is eligible for ~5% of turns — the zero-call path almost never fires | M |
| `EP-COST-03` | 🟠 high | fast/smart routing is a no-op by default and inverted in practice: ~95% of answers route 'smart' | S |
| `EP-COST-04` | 🟡 medium | estimateTokens' 2.2 chars/token constant is unvalidated and wrong by 1.2-1.6x depending on the served model | S |
| `EP-COST-05` | 🟡 medium | Evidence budget (8 chunks / 7,000 chars) is oversized relative to measured retrieval recall | S |
| `EP-COST-06` | 🟡 medium | Cost observability produces no actual number: estimatedCostUsd is undefined by default and nothing aggregates | M |
| `EP-COST-07` | 🟡 medium | Stream cancellation only logs — an abandoned turn keeps generating and still pays for verify | S |
| `EP-COST-08` | 🟡 medium | 30s model timeout runs from request start across the whole stream — long answers are paid for and thrown away | M |
| `EP-COST-09` | 🟡 medium | The free local embedder is not reachable from the runtime — enabling hybrid retrieval requires paying a provider | M |
| `EP-COST-10` | ⚪ low | Voice spend is bounded by bytes, not by audio duration, on a per-minute-billed API | S |
| `EP-COST-11` | ⚪ low | No spend ceiling beyond requests-per-minute, and no single-flight for concurrent identical questions | M |

### 5.15 Documentation quality & claim integrity — 78/100

*The outward-facing evidence layer is genuinely exceptional — every headline number in README.md, spec.md and the ADRs reproduces exactly against the committed artifacts, and the retrieval eval re-runs at HEAD to the same digits — but the second-layer docs (SECURITY, EVALUATION, DESIGN, RETRIEVAL) carry verifiable drift, including a security doc that describes two controls as the pre-fix vulnerable versions.*

**Why this score:** Not higher than 85: the security document — for a dimension scored on security/reliability — misdescribes two shipped controls as their pre-fix vulnerable forms (SECURITY.md:48, :61 vs ratelimit.ts:6-7, validate.ts:44), the evaluation document that underwrites the highest-weighted score contradicts itself on gate accuracy (7/9 vs 12/13) and is wrong on five dataset facts, and the design document simultaneously claims and denies that Vazirmatn is bundled. Six distinct drift instances across four docs is not an isolated slip. Not lower than 75: every claim a judge is most likely to spot-check reproduces exactly — 192 tests / 20 files, the full retrieval table (which I re-ran at HEAD to identical digits), the four-mode hybrid table, the load table, and the `npm audit --omit=dev` = 0 caveat, all traceable to committed JSON; CI enforces the retrieval floors with a real exit code; the [M]/[I]/[P] labelling is genuinely honest about what was never benchmarked; the ADRs carry alternatives, trade-offs and revisit conditions; and the review history is committed and commit-pinned rather than summarized. 78 reflects an exceptional top layer (README/spec/ADRs/artifacts, ~90) sitting on a second layer that has visibly decayed (~65).

**Strengths**

- Every quantitative README claim I could check verifies exactly. `npx vitest run` → "192 passed / 20 files" (README.md:127 says 192 tests · 20 files); the retrieval table (0.44 / 0.75 / 0.813 / 0.592 / 0.923) matches evals/results/retrieval-2026-08-20.json field-for-field; the hybrid-modes table matches benchmarks/retrieval/modes-2026-08-20.json to the decimal (0.4375→43.8%, 0.5833→58.3%, MRR 0.582→0.676); the load table matches benchmarks/load/load-2026-08-20.json (640 / 104.5 / 255.3 req/s, p50 36/232/95). No fabricated numbers found in README.
- The eval is genuinely reproducible at HEAD, not just a committed artifact. `npx tsx scripts/evaluate.ts --retrieval-only` printed "overall hit@5=0.813 MRR=0.592 gate-accuracy=0.923" and left `git status --porcelain` empty — the committed results file is byte-identical to a fresh run on the current code.
- Claims are floored in CI, not just asserted. scripts/evaluate.ts:203-211 sets HIT5_MIN=0.66 / GATE_MIN=0.75 with `process.exitCode = 1`, and .github/workflows/ci.yml runs `npm run evaluate:retrieval` as a job step — so a retrieval regression fails the build rather than silently rewriting the JSON the docs cite.
- Honest framing of limits is the default register, not an afterthought: lexical-only is labelled a "lower bound" in README/spec/EVALUATION; the load test is repeatedly stamped "MOCK LLM … NOT model quality" (benchmarks/README.md, load JSON `note` field); benchmark numbers are scoped as model-specific to `multilingual-e5-small`; `npm audit --omit=dev` = 0 is stated together with the fact that dev-only embedding tooling pulls advisories (confirmed: full `npm audit` = 4 vulns, all via @xenova/transformers devDependency).
- docs/STACK-EVALUATION.md's [M]/[I]/[P] labelling is disciplined and honest — alternatives (pgvector, MeiliSearch, Qdrant) are consistently marked [I] with the explicit statement that they "were not stood up and benchmarked here", and every [M] cell I sampled traces to a real artifact. This is the correct way to compare a stack without manufacturing evidence.
- COST.md and VOICE.md are precise against code: maxTokens 700/1400/400 (plan.ts:338, orchestrator.ts:215, verify.ts:45), MAX_EVIDENCE_CHUNKS=8 / MAX_EVIDENCE_CHARS=7000 (retrieval/index.ts:121-122), MAX_SUMMARY_CHARS=900 (sessions.ts:11), hypotheses ≤8 (sessions.ts:94), ANSWER_CACHE_MAX=200 (orchestrator.ts:25), and every voice status code (503/413/400/422/502) matches api/voice/transcribe/route.ts:30-80.

**Findings**

| ID | Sev | Issue | Effort |
|---|---|---|---|
| `EP-DOCS-01` | 🟠 high | SECURITY.md documents two controls as the pre-fix, vulnerable versions that DECISIONS.md D9 says were replaced | S |
| `EP-DOCS-02` | 🟠 high | docs/EVALUATION.md dataset section is stale on five separate facts and contradicts its own metrics table | S |
| `EP-DOCS-03` | 🟡 medium | The "Known failure cases" table overstates failures by 67% and misses one real failure | S |
| `EP-DOCS-04` | 🟡 medium | docs/DESIGN.md contradicts itself and the shipped UI after the D12 redesign was appended rather than merged | S |
| `EP-DOCS-05` | 🟡 medium | spec.md's 21 AC-* acceptance criteria have almost no traceability to evidence | M |
| `EP-DOCS-06` | 🟡 medium | RETRIEVAL.md and COST.md quote a superseded chunk count and anchor coverage while citing the live meta.json | S |
| `EP-DOCS-07` | ⚪ low | benchmarks/README.md's "Latest" retrieval line cites MRR 0.595, which the committed results file contradicts | S |
| `EP-DOCS-08` | ⚪ low | ADR 0004's own "Revisit when" condition has fired, but the ADR was edited in place instead of superseded, against the stated ADR process | S |
| `EP-DOCS-09` | ⚪ low | Two competing spec files with two AC numbering schemes; DECISIONS.md cites an AC id that does not exist in the source of truth | S |
| `EP-DOCS-10` | ⚪ low | No mechanical guard against doc drift, in a repo whose docs demonstrably drift | M |

## 6. Overall assessment

**Mean score across 15 independent dimensions: 75/100.**

The panel's consensus is a codebase whose **engineering discipline outruns its proven
outcomes**. The structural dimensions score highest — maintainability **84**, architecture
**82** — and multiple experts independently praised the same properties: a framework-free
`src/lib` core with verifiable dependency direction, a discriminated-union event contract
shared by server and client, typed error taxonomy end to end, deliberate simplifications
marked in-source with their ceiling and upgrade path, and honest ADRs that state what is *not*
wired up.

The lowest scores cluster on **evidence of outcomes** rather than on code quality:
accessibility **68**, observability **68**, data quality **68**, retrieval **70**. Three of the
four critical findings share one root theme — *the product's headline claims are not yet backed
by the shipped artifact*: the evidence gate false-refuses questions whose retrieval actually
succeeded (`EP-ANS-01`); the measured hybrid-retrieval gain cannot be obtained in any shipped
configuration (`EP-RET-01`); and answer quality has never been run against a real model
(`EP-PRD-01`). The fourth is a live defect rather than an unbacked claim: the streaming answer —
the single most important interaction — floods screen readers and is effectively unusable with
assistive technology (`EP-A11Y-01`).

None of these is a defect of carelessness. They are the predictable consequence of building a
grounded RAG product without a live model key and without a11y in the loop. They are also all
fixable, and the panel rated most of them **M** effort.

**The honest summary:** this is a well-built, well-documented, security-conscious retrieval
system with a real evaluation culture — and an unproven answer layer. Closing the four
criticals would convert the project from *demonstrably careful* to *demonstrably correct*.

## 7. What happens next

Every finding carries a stable ID (`EP-<DIM>-<NN>`), a severity, evidence, a recommendation and
an effort estimate so the backlog can be worked systematically. Suggested order:

1. **The 4 criticals** — they invalidate published claims and are all M-effort.
2. **The 47 high findings** — concentrated in data quality (6), agentic (4), UX (4), accessibility (4) and observability (4).
3. **Medium/low** — sequenced by dimension owner.

Progress against this register should be tracked in-repo so the next review round can measure
movement rather than re-litigate the same issues.

### Already addressed in the same commit as this record

Documentation-integrity findings were fixed immediately, because publishing a transparency
record beside documentation that is provably false would defeat its purpose. Everything else
remains open in the register above.

| ID | Sev | What was wrong | Fix |
|---|---|---|---|
| `EP-DOCS-01` | 🟠 high | `SECURITY.md` described the **pre-fix, vulnerable** versions of two controls: rate limiting "keyed by `ip\|sessionId`" (client-mintable) and body caps checked against the `content-length` header | Rewritten to the shipped behavior — IP-only key + 10× global spend backstop + `TRUST_PROXY` gating, and stream-enforced byte caps (`readJsonCapped`/`readBytesCapped`). Residual `EP-SEC-03` risk documented inline |
| `EP-DOCS-02` | 🟠 high | `EVALUATION.md` dataset section stale on five facts (6 files/57 cases, language split, 9 gate cases) | Regenerated from `evals/cases/*.json`: 7 files, 61 cases, fa 39 / en 17 / mixed 5, 13 gate cases (ambiguous 2, unsupported 5, adversarial 6) |
| `EP-DOCS-03` | 🟡 medium | "Known failure cases" claimed 15/48 (31%) misses; the committed results have 9 (18.8%), and 7 listed cases now rank | Corrected count + actual miss list; the old table retained and explicitly labelled historical |
| `EP-DOCS-04` | 🟡 medium | `DESIGN.md` still carried a "Typography note (known gap)" saying Vazirmatn was never bundled, contradicting `layout.tsx` | Replaced with the resolved state (`next/font/google`, self-hosted, no CSP change) |
| `EP-DOCS-06` | 🟡 medium | `RETRIEVAL.md`/`COST.md` quoted a superseded 3,630-chunk / 36.1% anchor figure while citing the live `meta.json` | Updated to the artifact values: 3,746 chunks, 1,370 anchored (36.6%), 1,142 files |

`EP-DOCS-05` (AC-* traceability) remains open — it needs test-level tagging, not a doc edit.
