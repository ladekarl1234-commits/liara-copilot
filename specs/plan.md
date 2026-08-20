# Implementation plan

## Verified facts driving the design (from liara-cloud/docs inspection)

- `public/llms/**/*.md`: 1,142 generated Persian markdown files, 7.3 MB.
  Line 1 = `Original link: https://docs.liara.ir/<path>/` → deterministic
  citation mapping. Each file ends with a boilerplate `## all links` section
  (strip on ingest).
- Categories: paas(425) dbaas(167) one-click-apps(189) ai(127) iaas(66)
  references(65) email-server(38) object-storage(34) mirrors(21)
  dns-management-system(8) overview(2). PaaS subdirs = platform metadata.
- Heading anchors are NOT slugified: authored as `<Section id="..."
  title="...">` inside `src/pages/**/*.mdx`. The llms .md keeps only the
  heading text ⇒ recover anchors by parsing the sibling MDX and matching
  Section title → heading text. Fallback: page URL without anchor.
- The official indexer pushes to MeiliSearch by crawling the LIVE site ⇒ not
  reusable offline. We index locally instead (DECISIONS.md #2).
- Liara AI product exposes OpenAI-compatible API at
  `https://ai.liara.ir/api/v1/<workspace>` incl. embeddings ⇒ default provider
  shape = OpenAI-compatible (works for Liara AI, OpenRouter, Ollama, OpenAI).

## Stack

Next.js 15 (App Router, standalone output) + TypeScript strict + Tailwind v4.
MiniSearch (in-memory lexical, BM25-like) + optional brute-force cosine vectors.
zod for structured-output validation. Vitest. No DB: JSONL persistence under
`data/runtime/` + in-memory LRU session store (ceilings documented).

## Modules & file map

```
scripts/sync-docs.mjs          clone/pull liara-cloud/docs into data/liara-docs
scripts/build-index.ts         ingest → chunk → anchors → lexical index JSON
                               (+ embeddings if AI_EMBEDDINGS_MODEL set),
                               incremental by chunk hash
scripts/evaluate.ts            retrieval eval (hit@k, no model needed) +
                               answer eval (LLM-judged, needs key)
src/types.ts                   shared contracts (done)
src/lib/config.ts              env parsing + validation (zod)
src/lib/text/persian.ts        normalization: ي→ی ك→ک, diacritics, ZWNJ,
                               digits fa→en, tokenizer for MiniSearch
src/lib/docs/ingest.ts         walk llms/, parse Original link, strip
                               boilerplate, structural chunking (headings,
                               code stays attached), MDX anchor recovery
src/lib/retrieval/index.ts     load/build MiniSearch + vector store, hybrid
                               RRF fusion, metadata filters, rerank boosts,
                               evidence-gate confidence scoring, query cache
src/lib/ai/provider.ts         ModelProvider: OpenAI-compatible chat
                               (stream + JSON mode) + embeddings, timeout,
                               bounded retry
src/lib/ai/router.ts           fast vs smart model routing + cost estimate
src/lib/agent/orchestrator.ts  per-message pipeline: plan call → retrieval →
                               evidence gate → answer stream → verification
src/lib/agent/prompts.ts       system prompts (fa/en), injection fencing
src/lib/agent/plan.ts          deterministic pre-classifier + cheap-model
                               AgentPlan structured call (zod-validated)
src/lib/agent/verify.ts        post-answer claim check (flagged)
src/lib/state/sessions.ts      LRU session store + JSONL persistence
src/lib/security/ratelimit.ts  token bucket per IP+session
src/lib/security/validate.ts   input schema, length caps
src/lib/obs/log.ts             structured JSON logger + RequestMetrics
src/lib/obs/gaps.ts            documentation-gap JSONL recorder
src/lib/liara/mock.ts          MockLiaraProvider
src/app/api/chat/route.ts      POST SSE stream (ChatEvent protocol)
src/app/api/feedback/route.ts  POST feedback
src/app/api/health/route.ts    GET health (index loaded, provider configured)
src/app/api/diag/route.ts      dev-only diagnostics (last N pipeline traces)
src/app/layout.tsx, page.tsx   UI shell (fa, dir=rtl, Vazirmatn font)
src/components/*               Chat, Composer, Message, CodeBlock, Sources,
                               WorkflowChecklist, ContextChips, Feedback
evals/cases/*.json             ≥40 cases across mandated categories
docs/*.md, README.md, Dockerfile, .env.example, liara.json
tests/*.test.ts                unit: persian, chunking, anchors, retrieval,
                               ratelimit, plan validation, citation mapping,
                               api validation; integration: orchestrator with
                               fake provider
```

## Pipeline per message (cost-bounded)

1. Deterministic pre-pass (regex/keyword: language detect, error-pattern
   detect, platform/product hints) — free.
2. ONE cheap-model structured call → `AgentPlan` (intent + state patch +
   ≤3 retrieval queries + action). Skipped for cache-hit FAQs.
3. Local retrieval (lexical + optional vector, RRF, metadata filters, boosts).
4. Deterministic evidence gate (top score, margin, coverage) → may downgrade
   action to clarify/insufficient.
5. ONE routed answer call, streamed after the gate passes. Evidence fenced as
   DATA; user pastes fenced as DATA.
6. Optional verification call (cheap model) on final text → appended note +
   groundedness metric. Config `VERIFY_CLAIMS`.

Budgets: ≤8 evidence chunks / ~6k chars fa, plan ≤600 out-tokens, answer ≤1400
out-tokens, 2 retries max, 30s model timeout.

## Stages

S1 (lead): config, persian, ingest, index, retrieval, scripts, unit tests.
S2 (parallel agents): server agent layer + API; UI; eval dataset + runner.
S3 (lead): integration, build, full tests, retrieval eval + tuning.
S4: adversarial panel (correctness / error-handling+state / security lenses) →
    fix → re-review same lenses.
S5: docs, final gate walk, delivery report.

## Risks

- Persian lexical matching quality → mitigated by normalization + query
  rewriting into doc vocabulary; measured by retrieval eval before answer work.
- Anchor recovery misses (authored ids) → fallback to page URL, measured
  coverage reported.
- No API key at runtime → graceful degradation path tested with FakeProvider.
- OneDrive path: node_modules churn is slow but harmless.
