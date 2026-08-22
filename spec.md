# Liara Copilot — Product & Engineering Specification

> Source of truth for the product. Kept in sync with the implementation; when a
> material decision changes behavior, this file and the relevant ADR are updated.
> Phase status: **Phase I (local, grounded, voice-enabled). No real Liara
> deployment or real Liara-account API yet — architected for it (see §Future).**

## 1. Problem statement

Liara users open support tickets because they cannot find, understand, connect,
or apply the official documentation. The product moves a user from *"I have a
problem"* to *"verified resolved"*, grounded strictly in official Liara docs
(`docs.liara.ir` / `liara-cloud/docs`). A confident wrong answer is a failure;
an honest *"I couldn't find this in the docs"* is a success.

## 2. Challenge objectives

Answer quality & grounding · agentic help (Ask/Fix/Guide) · Persian-first UX ·
voice · security/reliability/observability · cost control · reproducible
engineering evidence. Highest weight: **answer correctness**.

## 3. Users

- Persian-speaking developers deploying apps/databases/domains on Liara.
- Mixed Persian/English technical writing (RTL prose, LTR code/commands/URLs).
- Beginners who don't know Liara's product taxonomy, and experienced users
  pasting an error/log for triage.

## 4. Use cases

- Ask a grounded how-to ("چطور Next.js را روی لیارا دیپلوی کنم؟").
- Paste an error/log and get support-engineer-style triage.
- Follow a multi-step deployment workflow (e.g. Django + PostgreSQL).
- Speak the question instead of typing; optionally hear the answer.

## 5. Scope (Phase I)

In: docs ingestion → hybrid retrieval → evidence gate → grounded generation +
citations → conversation state → Ask/Fix/Guide → Persian RTL UI → **text and
voice input** → optional spoken answer → security/observability/cost controls →
evaluation + benchmarks → internal diagnostics.

## 6. Non-goals (Phase I)

Real Liara deployment; real Liara-account/API actions (deploy, restart, logs,
billing); user accounts/auth; multi-tenant persistence; a public analytics
dashboard as the primary surface; autoplaying spoken answers.

## 7. Functional requirements

- **FR1 Ingestion.** Ingest `liara-cloud/docs` `public/llms/**/*.md`, chunk
  structurally (headings; code stays attached to its explanation), preserve
  metadata (product, platform, title, heading, URL, anchor, source path, hash).
- **FR2 Incremental index.** Stable content hashes; only changed chunks
  reprocessed; embeddings (when enabled) cached by chunk-hash + model.
- **FR3 Hybrid retrieval.** Intent/context → bounded query rewrite → metadata
  filter → lexical (BM25/MiniSearch) + optional vector (cosine) fused by RRF →
  rerank/boost → evidence selection. Persian normalization applied identically
  at index and query time. Exact identifiers (`DATABASE_URL`, `502`, `CNAME`)
  must retrieve well — the reason hybrid (not vector-only) is used.
- **FR4 Evidence gate.** Below a confidence threshold, do not answer; refuse
  honestly or ask one targeted clarification. No fabricated absence claims.
- **FR5 Citations.** Cite specific page + section anchor
  (`https://docs.liara.ir/...#anchor`), never just the docs root. Measured:
  only **36.5%** of chunks carry an authored `<Section id=…>` anchor, so the rest
  cite a `#:~:text=` highlight fragment on the chunk's opening sentence —
  36.5% anchored + 57.4% text-fragment = **93.9% deep-linked**, 6.1% land at the
  page top (`EP-PRD-06` / `EP-RET-09`; re-measured by
  `tests/docs-numbers.test.ts`).
- **FR6 Claim verification.** A post-answer stage checks Liara-specific claims
  against evidence; unsupported claims are corrected/flagged.
- **FR7 Conversation memory.** Track framework/packageManager/database/goal/
  problem; update on correction; never keep stale state after a correction.
- **FR8 Fix flow.** Diagnose → one useful next test → observe → update
  hypothesis. Not a wall of 14 causes.
- **FR9 Guide flow.** A deployment goal seeds a stateful checklist advanced by
  conversation.
- **FR10 LLM provider.** Server-side, provider-abstracted (`ModelProvider`).
  Default generation via **OpenRouter Free Router** (`openrouter/free`); works
  keyless (grounded source listing) and with a `MockLLMProvider` for tests/load.
- **FR11 Voice input.** Press mic → speak → stop → see transcript → send →
  grounded answer. STT behind `SpeechToTextProvider`; Phase I uses **Soniox**
  (server-side key). Typed content is never lost on mic failure.
- **FR12 Spoken answer (optional).** A `🔊 Listen` control reads an answer aloud
  via browser TTS. No autoplay; user controls playback; never blocks generation.
- **FR13 Secret redaction.** Obvious secrets in pasted content (API keys,
  connection-string passwords, bearer tokens) are redacted before the text is
  sent to the external model, preserving diagnostic structure.
- **FR14 Internal diagnostics.** A dev-gated `/internal` page exposes index
  status, source commit, retrieval traces, eval scores, model usage — separate
  from the public UI.

## 8. Non-functional requirements

Stateless app processes (state externalizable); provider abstractions for LLM,
STT, TTS, Liara API, cache; bounded retries + timeouts on all external calls;
structured JSON logs with hashed PII; server-side secrets only; graceful
degradation (keyless, index-missing, voice-unconfigured, mic-denied).

## 9. UX principles

High internal sophistication, near-zero external complexity. The center of the
page is one composer: *"Ask Liara anything."* No RAG/vector/agent jargon in the
UI. A few starter actions (deploy / fix / connect DB / domain). Calm, single
conversation column.

## 10. Conversation behavior

Auto-infer Ask/Fix/Guide from the message; no mode tabs. Maintain context chips;
correct on user correction; degrade to grounded sources when keyless.

## 11. Voice requirements

Mic states: `idle · requesting · listening · processing · transcribed · error`.
Graceful handling of: permission denied, unsupported browser, empty recording,
transcription failure, network failure. Persian STT quality prioritized (Soniox
`language_hints:["fa","en"]` + language identification). STT/TTS decoupled behind
interfaces; no hard coupling to one browser API or vendor.

## 12. Retrieval & grounding requirements

Hybrid retrieval is implemented (lexical + vector, RRF + rerank) and
**benchmarked** (`benchmarks/retrieval/`, local `multilingual-e5-small`
embeddings): five modes compared on the 48 sourced eval cases — hit@1 lexical
43.8% → lexical+rerank 45.8% → vector 58.3% → hybrid 58.3% → **hybrid+rerank
62.5%** (MRR 0.601 → 0.719). Hybrid+rerank is the strongest **and is the
deployed default**: `AI_EMBEDDINGS_MODEL` defaults to the local model, so hybrid
runs with no API key and no configuration (ADR 0008, superseding ADR 0004 —
the earlier lexical-only default was the panel's `EP-PRD-02` / `EP-RET-01`:
we shipped the weakest mode we had benchmarked). The grounding eval
(`evals/`) now runs in that same shipped configuration. Setting
`AI_EMBEDDINGS_MODEL=''` is the documented opt-out to lexical-only. Answers are
grounded only in retrieved evidence; unknown → say so.

## 13. Citation behavior

Deep anchors preferred; citations shown as page · product with an "open source"
link. Citation correctness is tested (sources must support claims), not merely
presence of links.

## 14. Failure behavior

Typed error codes (`rate_limited`, `model_timeout`, `model_unavailable`,
`index_missing`, `invalid_input`, `voice_unavailable`, `internal`) with Persian
user messages and retry. Health returns 503 when the index is unloadable.

## 15. Security requirements

Server-side keys (OpenRouter, Soniox) never reach the browser/logs/errors;
prompt-injection detector + `<user_data>` fencing; secret redaction (FR13);
per-IP rate limit + global backstop; streamed body caps; safe Markdown (no raw
HTML sink). A repo-wide secret scan is a **stated intent, not an implemented
control** — see §20.1 `AC-SEC-001`.

## 16. Performance requirements

Retrieval before prose streaming. Evidence selection completes before unsupported
tokens stream. Load behavior measured with a **mock** LLM (never live OpenRouter)
— see `benchmarks/load/`.

## 17. Scalability requirements

Stateless web nodes; externalizable session/rate/cache stores; independent index
build (can become a worker); replaceable cache; provider abstractions. Expected
first bottleneck: external LLM latency/quota, then single-instance in-memory
stores (documented upgrade: shared store). See `docs/ARCHITECTURE.md`.

## 18. Observability requirements

Per-request metrics: intent, retrieval latency/confidence, candidate count,
model route, **requested vs actual model** (OpenRouter free is a dynamic
router), input/output tokens, estimated cost, cache hit, error category. Ring
buffer of pipeline traces for `/internal`.

## 19. Evaluation requirements

Fixed dataset (60+ cases across Persian/English/mixed/errors/multi-hop/
unsupported/citation-trap). Retrieval metrics (hit@1/3/5, MRR, evidence-recall,
refusal-recall, false-refusal rate) with floors enforced in CI, **derived** from
`evals/baseline.json` rather than hand-typed. Load benchmark with mock LLM.
Bounded live-model smoke test kept separate from high-volume load.

## 20. Acceptance criteria

- **AC-CHAT-001** A Persian user asks a Liara question and receives a response.
- **AC-RAG-001** Liara-specific factual answers contain official citations
  (page + anchor where available).
- **AC-RAG-002** Unsupported Liara claims are not fabricated; the gate refuses.
- **AC-RAG-003** Exact identifiers (`DATABASE_URL`, `502`) retrieve the right page.
  Enforced floor: hit@5 on the 48 sourced eval cases, **derived from
  `evals/baseline.json`** (accepted value minus one case) and failed via exit
  code by `npm run evaluate:retrieval` in CI. Currently accepted at hit@5 0.854.
  This criterion carried no threshold until the panel review; the historical
  amendment from ≥ 0.8 to ≥ 0.6 recorded in `docs/DECISIONS.md` D9 belongs here
  (`EP-DOCS-09`).
- **AC-VOICE-001** A supported browser captures voice input and converts it to a
  query via the server STT provider.
- **AC-VOICE-002** Mic permission denied / unsupported / empty / failed
  transcription each show a clear state and never discard typed text.
- **AC-VOICE-003** A completed answer can be read aloud via an opt-in control.
- **AC-RTL-001** Persian messages render RTL while code/commands/URLs stay LTR.
- **AC-CONTEXT-001** The assistant does not repeatedly ask for known framework info.
- **AC-FIX-001** Pasting an error yields ranked hypotheses + one diagnostic step.
- **AC-GUIDE-001** A deployment goal seeds a multi-step checklist.
- **AC-SEC-001** OpenRouter/Soniox keys never appear in API/HTML/bundle/logs.
- **AC-SEC-002** Pasted `API_KEY=…` / `DATABASE_URL=…` secrets are redacted
  before reaching the external model.
- **AC-SEC-003** Instruction-override / exfiltration attempts are refused with
  zero model calls.
- **AC-COST-001** Greeting/cache/keyless paths make zero LLM calls; deterministic
  work (hashing, fusion, schema validation) never calls the LLM.
- **AC-OBS-001** Each answered request records requested + actual model when the
  provider reports it.
- **AC-PROVIDER-001** With `OPENROUTER_API_KEY` set, real generation works with no
  architecture change; with it empty, the app still runs (mock/keyless).

### 20.1 Traceability — which test proves which criterion

There are **17** AC-* criteria above. Before the panel review only two of them
(`AC-SEC-002`, `AC-VOICE-002`) appeared anywhere outside this file, so "AC met"
could not be checked without re-deriving the mapping by hand (`EP-DOCS-05`).

The table below is the mapping. **Where nothing automated proves a criterion,
the row says so** — an unproven AC must be visibly different from a proven one,
not quietly absent. Test names are `describe` + `it` as `npx vitest run` prints
them; re-derive with `npx vitest run --reporter=json`.

| AC | Automated evidence | Gap |
|---|---|---|
| `AC-CHAT-001` | `tests/orchestrator.test.ts` → *answers a grounded question with citations and done*; `tests/route-chat.test.ts` → *streams SSE with the right headers on a valid request* | — |
| `AC-RAG-001` | `tests/orchestrator.test.ts` → *answers a grounded question with citations and done*; `tests/retrieval.test.ts` → *citationUrl appends #anchor with a guaranteed trailing slash* + *falls back to a text-fragment deep link when there is no anchor*; `tests/ui-markdown-citations.test.ts` (6) | — |
| `AC-RAG-002` | `tests/orchestrator.test.ts` → *gates low-confidence retrieval into an honest insufficient answer*; `tests/gate.test.ts` (17); `tests/retrieval-panel-fixes.test.ts` → *still refuses a question the docs genuinely do not answer*; eval refusal-recall 11/11 | — |
| `AC-RAG-003` | `tests/persian.test.ts` → *tokenizeFa splits DATABASE_URL into joined identifier + parts*; `tests/retrieval.test.ts` → *search returns non-low confidence for an exact-match query*; the hit@5 floor in `npm run evaluate:retrieval` | **Partial.** Page-level correctness is only measured *in aggregate* (hit@5 0.854). No test pins a specific identifier→page pair, and `502` in particular is untested. |
| `AC-VOICE-001` | `tests/voice-route.test.ts` → *transcribes and returns text when configured* | **Partial.** Server half only. Browser `MediaRecorder` capture (`useVoice.ts`) has no automated test — verified manually. |
| `AC-VOICE-002` | `tests/voice-route.test.ts` → *503 voice_unavailable when STT is not configured*, *rejects an empty recording with 400*, *maps stt_empty to 422*, *maps a transcription failure to 502* | **Partial.** The four failure states are covered server-side. "Never discards typed text" is structural (`useVoice.ts:36`, transcript is appended by the caller, never assigned) and **manually verified** — no test. |
| `AC-VOICE-003` | `tests/ui-a11y-contract.test.ts` → *the listen button names its action rather than relying on flipping text* | **Partial.** Control presence + a11y only; `SpeechSynthesis` playback is manual. |
| `AC-RTL-001` | `tests/ui-a11y-contract.test.ts` → *Markdown sets one base direction from the answer language* + *citation labels no longer force LTR over Persian titles*; `tests/ui-markdown-citations.test.ts` → *hasPersian drives one base direction per answer* | — |
| `AC-CONTEXT-001` | `tests/orchestrator.test.ts` → *remembers session context across turns*; `tests/agent-units.test.ts` → *DOES inherit the session platform for a topic-less follow-up*, *does NOT inherit a stale session platform when the new message has its own topic* | — |
| `AC-FIX-001` | `tests/orchestrator.test.ts` → *runs the Fix flow (ranked hypotheses + state) even when retrieval is weak*; `tests/agent-units.test.ts` → *seeds ranked troubleshooting hypotheses deterministically (keyless Fix)* + the 8 *Fix-flow continuation* tests | **Partial.** "One diagnostic step, not a wall of causes" is not asserted; the keyless message still lists the ledger (`EP-AGT-12`, open). |
| `AC-GUIDE-001` | `tests/orchestrator.test.ts` → *runs the Guide flow (workflow checklist) for a deploy intent even keyless* + *emits a workflow checklist event when the plan builds one*; `tests/agent-units.test.ts` → *seeds a deployment workflow (Guide) for a deploy intent* + the 3 *workflow lifecycle* tests | — |
| `AC-SEC-001` | — | **No automated evidence.** The claim rests on structure: keys are read only in server modules (`docs/SECURITY.md` §Server-side provider keys names them — `config.ts`, `ai/provider.ts`, `speech/soniox.ts`) and log fields matching `apikey`/`authorization`/`token` are stripped. Nothing *asserts* the absence in API/HTML/bundle output, and §15's "automated secret scan before completion" is **not implemented** — there is no such npm script or CI step. |
| `AC-SEC-002` | `tests/redact.test.ts` (6, titled with the AC id); `tests/redact-e2e.test.ts` (2, incl. *does NOT leak a turn-1 secret to the model on turn 2 via the session summary*); `tests/security-hardening.test.ts` → *EP-SEC-05* (6) | — |
| `AC-SEC-003` | `tests/injection.test.ts` → *orchestrator refuses injection before any model call — emits a refusal and never touches the provider* (+5 detector tests); `tests/security-hardening.test.ts` → *EP-SEC-11* (2) | **Partial.** The detector is a pattern list; `EP-SEC-11` (partial) records that novel paraphrases still get through. |
| `AC-COST-001` | `tests/integration-realindex.test.ts` → *caches a high-confidence first-turn answer and replays it with no model calls*; `tests/agent-units.test.ts` → *treats a greeting as chitchat with no retrieval* + *recognises ordinary pleasantries, not just the exact word*; `tests/orchestrator.test.ts` → *degrades gracefully without a configured provider (sources only)* | — |
| `AC-OBS-001` | `tests/ai-provider-config.test.ts` → *generate returns text + model + usage and reports model via onMeta*; `tests/orchestrator-observability.test.ts` (12) | **Partial.** The `onMeta` plumbing and the trace fields are tested; **no test asserts that a served request emits both the requested and the actual model** into `request_metrics`. Verified by reading `/internal`. |
| `AC-PROVIDER-001` | `tests/ai-provider-config.test.ts` → the 5 *provider resolution (config)* tests incl. *is keyless (not configured) when nothing is set*; `tests/orchestrator.test.ts` → *degrades gracefully without a configured provider (sources only)* | **Partial.** The keyless and mock halves are proven. "Real generation works" against a live key has never been executed — that is the still-open critical `EP-PRD-01`. |

Score, stated plainly: **8 of 17 fully proven by automated tests, 8 partial, 1
(`AC-SEC-001`) with no automated evidence at all.** §15 also claims an
"automated secret scan before completion" that does not exist; that sentence is
an intent, not a control.

## 21. Current-phase limitations

Keyless troubleshooting ledger is a deterministic snapshot; single-instance
in-memory session/rate/cache; CSP allows `unsafe-inline` (Next hydration; no HTML
sink). Retrieval hit@1 (60.4%) is a raw single-query lower bound — the live
pipeline adds query rewriting and conversation-state filters the eval does not
exercise. Answer *correctness* has never been measured end-to-end: that needs a
real provider key (`EP-PRD-01`, the one open critical).

**Corpus ceiling.** The index covers 11 `docs.liara.ir` product sections (`paas`,
`ai`, `one-click-apps`, `dbaas`, `iaas`, `email-server`, `references`,
`object-storage`, `mirrors`, `dns-management-system`, `overview`). There is no
pricing/plans page, no status or changelog feed and no account API, so pricing,
quota, incident and "why is *my* app down" questions are structurally
unanswerable and are refused honestly. The deflectable share of support volume is
therefore *doc-answerable questions only* — see `EP-PRD-07` and §22. See
`docs/reviews/`.

## 22. Future: API integration

`LiaraProvider` seam exists with `MockLiaraProvider`; a future `RealLiaraProvider`
adds app/log/deploy inspection behind per-action confirmation. `LiaraTool`
boundary allows inert→real tools without rewriting conversation logic.

## 23. Future: Liara deployment

Dockerfile + `liara.json` + health + `TRUST_PROXY` prepared and locally verified;
real deploy is a later phase (worth 40 challenge points, intentionally PENDING).
