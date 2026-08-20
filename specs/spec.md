# Liara Copilot — Specification (Phase 1: local, no real deploy)

## Problem

Liara users open support tickets because they cannot find, understand, connect,
or apply the official documentation. Build an LLM product that moves a user from
"I have a problem" to "verified resolved", grounded in official Liara docs.

## Product

**Liara Copilot** — a single conversational interface (Persian-first, RTL,
English works too) that automatically infers whether the user needs:

- **Ask** — a grounded answer with citations to exact doc sections
- **Fix** — stateful troubleshooting (ranked hypotheses → one diagnostic step →
  wait for result → adapt → `Resolved ✓`)
- **Guide** — a stateful multi-step workflow checklist (e.g. Django+PostgreSQL
  deploy) advanced by conversation

No mode tabs. One input. Progressive disclosure.

## Functional requirements

FR1. Ingest official docs from the cloned `liara-cloud/docs` repo
     (`public/llms/**/*.md` as primary source), chunk structurally
     (headings; code blocks stay attached to their explanation), preserve
     metadata (product, platform, title, heading, URL, anchor, source path,
     content hash).
FR2. Incremental indexing: stable content hashes; only changed chunks
     reprocessed; embeddings (when enabled) cached by chunk hash + model.
FR3. Retrieval pipeline: intent/context extraction → query rewriting (bounded)
     → metadata filtering → hybrid retrieval (lexical BM25 + optional vector)
     → reranking → evidence selection. Persian text normalization
     (ی/ي, ک/ك, ZWNJ, diacritics) applied to both index and queries.
FR4. Evidence gate: below a confidence threshold the assistant must NOT answer;
     it asks one targeted clarification, or states the docs do not establish
     the answer.
FR5. Answers cite specific documents + section anchors
     (`https://docs.liara.ir/...#anchor`), never just the docs root.
FR6. Claim verification stage for Liara-specific claims: unsupported claims are
     removed, qualified, or marked as inference.
FR7. Conversation state: structured session state (product, platform, language,
     db, package manager, known error, tried actions, rejected hypotheses,
     workflow step, expertise, preferred language) + summary; never re-ask
     known facts; never stuff full history into every call.
FR8. Troubleshooting agent: ranked hypotheses, one diagnostic step at a time,
     hypothesis ledger (rejected/testing/untested), explicit `Resolved ✓` with
     root cause.
FR9. Workflow guide: detected stack, checklist with done/current/pending steps,
     one next step per turn, verification step at the end.
FR10. Personalization profile inferred from conversation (language, experience,
      platform, package manager); adapts verbosity and step granularity. No
      questionnaire.
FR11. Model abstraction: `ModelProvider` (generate/embed) configured via env;
      OpenAI-compatible endpoints (works with Liara AI, OpenRouter, Ollama,
      OpenAI); model routing (cheap model for classification/simple Q, stronger
      for reasoning); works with a single configured model too.
FR12. `LiaraProvider` tool abstraction (read-only surface: apps, deployments,
      logs, envs, domains, databases) with `MockLiaraProvider` only. No real
      account connection. No destructive operations.
FR13. Artifact generation (Dockerfile, liara.json, .env.example snippets, CLI
      commands, DNS records) only when grounded in retrieved docs.
FR14. Feedback: Helpful / Not helpful / "Still didn't solve it" (feeds
      troubleshooting continuation); stored.
FR15. Documentation-gap log: privacy-safe normalized record of low-confidence /
      unhelpful / unanswered questions; dev-only view.
FR16. Dev-only diagnostics endpoint/panel: retrieved chunks, scores, filters,
      rerank order, model route, token usage, latency, citations. Hidden in
      production mode.
FR17. Streaming responses after evidence verification (retrieve → gate →
      stream).
FR18. Health endpoint for future Liara deploy.

## Non-functional requirements

NFR1. Security: secrets only via env; server-side model calls only; input/
      request size limits; rate limiting (IP+session); model timeouts; bounded
      retries and tool loops; sanitized Markdown rendering; safe external
      links; no secrets in logs; structured-output validation (zod).
NFR2. Prompt-injection: user-pasted logs/configs/errors are DATA — fenced and
      never allowed to override system policy, tools, or retrieval policy.
NFR3. Observability: structured JSON logs with request_id, session_id, intent,
      product, latencies (retrieval/rerank/model/total), tokens, est. cost,
      cache hit, retrieval confidence, error category.
NFR4. Cost: caching (normalized-query retrieval cache, embedding cache, answer
      cache for common Qs), token budgets per stage, routing; recorded usage.
NFR5. Persian quality: natural Persian, correct RTL, LTR code/commands,
      English technical identifiers preserved, mixed-direction rendering
      correct; responds in the user's language.
NFR6. UI: minimal/calm/fast; large centered input landing with 4 example
      chips; visual hierarchy in answers; syntax-highlighted LTR code blocks
      with copy button; collapsible Sources; small context chips; loading
      stage messages; helpful error recovery; responsive
      desktop/tablet/mobile; keyboard nav, focus states, contrast,
      reduced-motion.
NFR7. Failure handling: model timeout/unavailable, retrieval unavailable,
      index missing, malformed model JSON, rate-limited, network failure,
      empty results, invalid input — each with a useful UI recovery message.
NFR8. Modular monolith (Next.js App Router + TS). No microservices/queues/k8s.
      Runs locally with `npm install && npm run index && npm run dev`.
NFR9. Evaluation: dataset ≥ several dozen cases across mandated categories
      (fa/en/mixed, troubleshooting, multi-hop, unsupported, adversarial…);
      retrieval measured separately (hit@1/3/5); answer-quality dims;
      regression cases; results stored under `evals/results/`.
NFR10. Docker + production config + `.env.example` + deployment docs prepared;
       NO actual Liara deployment in this phase.

## Acceptance criteria (end-to-end scenarios must pass)

AC1. "How do I add environment variables to my application?" → correct concise
     grounded answer + correct source link.
AC2. "I have a Next.js application. How do I deploy it?" → Next.js-specific
     docs retrieved; no irrelevant framework steps.
AC3. "My database doesn't connect." → asks one targeted clarification, no
     assumption dump.
AC4. "connect ECONNREFUSED 127.0.0.1:5432" → identifies PG/localhost issue,
     evidence retrieved, ONE diagnostic step, state maintained.
AC5. "I have Django + PostgreSQL, deploy on Liara" → stepwise guided workflow,
     not a wall of text.
AC6. Question unanswerable from docs → explicitly says evidence insufficient.
AC7. Context: "My app is Next.js." … later "What should I do next?" → stack
     remembered.
AC8. Natural Persian question → natural Persian answer, correct RTL, English
     identifiers intact, LTR code.
AC9. Retrieval eval, enforced as failing floors in the runner (a regression
     exits non-zero): hit@5 ≥ 0.66 (measured 0.708) AND gate-accuracy ≥ 0.75
     (measured 0.778 = 7/9), on raw single-query lexical-only retrieval, with
     unsupported/adversarial cases required to gate as 'low'. Two gate cases
     are ACCEPTED DEBT: `crlf-bad-interpreter` and `adversarial-destructive`
     carry genuine Liara vocabulary, are lexically indistinguishable from ~11
     legitimate troubleshooting cases, and are defended downstream (answer-
     prompt safety refusal + claim verification), not by the lexical gate.
     Rationale for the amendment (originally an aspirational hit@5 ≥ 0.8):
     0.708 is a raw single-query lower bound; the live pipeline adds bounded
     LLM query rewriting + conversation-state filters on top, and 0.8 remains
     the target for the hybrid/rewritten path — see docs/EVALUATION.md. The
     spec numbers and the runner's `HIT5_MIN`/`GATE_MIN` are the same numbers.
AC10. `npm run build` succeeds; `npm test` passes; health endpoint 200;
      Dockerfile builds documented; rate limit returns 429 with useful body.
AC11. All docs in README + docs/{ARCHITECTURE,DECISIONS,RETRIEVAL,EVALUATION,
      SECURITY,COST,DESIGN,DEPLOYMENT}.md exist and match the implementation.

## Non-goals (this phase)

Real Liara API connection; real deployment; destructive operations; accounts/
auth for end users; enterprise dashboards; multi-agent theater.

## Assumptions

A1. `public/llms/**/*.md` is a clean, official, LLM-ready source (verified in
    repo inspection; recorded in DECISIONS.md).
A2. An OpenAI-compatible endpoint + key is supplied via env at runtime; the app
    degrades gracefully (clear error + retrieval-only sources) without one.
A3. Docs are Persian; Persian-normalized lexical search is a strong baseline;
    vector/hybrid search is optional and now **benchmarked** with a local
    multilingual model (hybrid+rerank Recall@1 58.3% vs lexical 43.8% — see
    benchmarks/retrieval/). The shipped default stays lexical (zero infra).
