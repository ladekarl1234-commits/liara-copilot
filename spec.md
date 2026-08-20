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
  (`https://docs.liara.ir/...#anchor`), never just the docs root.
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

Hybrid required; evaluated against lexical-only and (when embeddings configured)
vector/rerank. Answers grounded only in retrieved evidence; unknown → say so.

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
HTML sink); automated secret scan before completion.

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
unsupported/citation-trap). Retrieval metrics (Recall@1/3/5, MRR) with enforced
floors in CI. Load benchmark with mock LLM. Bounded live-model smoke test kept
separate from high-volume load.

## 20. Acceptance criteria

- **AC-CHAT-001** A Persian user asks a Liara question and receives a response.
- **AC-RAG-001** Liara-specific factual answers contain official citations
  (page + anchor where available).
- **AC-RAG-002** Unsupported Liara claims are not fabricated; the gate refuses.
- **AC-RAG-003** Exact identifiers (`DATABASE_URL`, `502`) retrieve the right page.
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

## 21. Current-phase limitations

Keyless troubleshooting ledger is a deterministic snapshot; retrieval hit@1 is
lexical-only lower bound; single-instance in-memory session/rate/cache; CSP
allows `unsafe-inline` (Next hydration; no HTML sink). See `docs/reviews/`.

## 22. Future: API integration

`LiaraProvider` seam exists with `MockLiaraProvider`; a future `RealLiaraProvider`
adds app/log/deploy inspection behind per-action confirmation. `LiaraTool`
boundary allows inert→real tools without rewriting conversation logic.

## 23. Future: Liara deployment

Dockerfile + `liara.json` + health + `TRUST_PROXY` prepared and locally verified;
real deploy is a later phase (worth 40 challenge points, intentionally PENDING).
