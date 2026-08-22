# Phase III — implementation plan

Ordered by dependency. Each step names its acceptance criterion from
`specs/phase-iii-vercel.md` and the evidence that closes it.

## Wave 1 — make Vercel possible (serial; interlocking core files)

| # | Change | Files | AC | Evidence |
|---|---|---|---|---|
| 1 | Pinned model chain (`models: [...]`), `reasoning:{enabled:false}`, empty-stream guard | `src/lib/ai/provider.ts`, `src/lib/config.ts` | AC-M1/2/3 | unit test + live TTFT sample |
| 2 | `embeddings.json` → `embeddings.bin` (Float32 LE) + `meta.json` dims/count | `scripts/build-index.ts`, `src/lib/retrieval/index.ts` | AC-L2 | parse-time before/after |
| 3 | Commit the built index; stop gitignoring `data/index` | `.gitignore`, `data/index/*` | AC-V1 | `git ls-files data/index` non-empty |
| 4 | Ship the e5 model with the function; `allowRemoteModels=false`, local path | `src/lib/ai/local-embeddings.ts`, `next.config.mjs` | AC-V2 | no hub fetch in a request |
| 5 | Tracing includes/excludes; drop `standalone` on Vercel; drop unused ORT wasm + gpt/llama tokenizers | `next.config.mjs` | AC-V7 | bundle size from build output |
| 6 | Feedback → structured stdout log, no FS write | `src/app/api/feedback/route.ts` | AC-V3 | deployed POST returns 2xx |
| 7 | `maxDuration` 60 and internal budget < it | `src/app/api/chat/route.ts`, `src/lib/config.ts` | AC-V4 | build accepted; budget test |
| 8 | Client IP from `x-forwarded-for` on Vercel | `src/lib/security/validate.ts`, env | AC-V5 | two IPs → two buckets |
| 9 | Conversation state carried by the client, HMAC-signed — removes the single-instance ceiling | `src/lib/state/sessions.ts`, `src/lib/agent/orchestrator.ts`, `src/components/useChat.ts` | AC-V6 | 2-turn HTTP test resolves context |
| 10 | `Permissions-Policy: microphone=(self)` | `next.config.mjs` | AC-C1 | header on deployed URL |
| 11 | `VOICE_MAX_BYTES` ≤ 4 MB on Vercel | `src/lib/config.ts`, `.env.example` | AC-V8 | config test |

**Gate: deploy and prove `/api/health` 200 + a real cited answer over HTTPS.**

## Wave 2 — heavy end-to-end testing against the deployed URL

Real HTTP, real key, no mocks. Persian and English. Ask / Fix / Guide. Multi-turn.
Injection. Rate limit. Voice. Bad input. Cold vs warm. ≥20 requests for latency
percentiles (AC-L3). Every failure becomes a defect with a repro.

## Wave 3 — quality fixes (parallel, disjoint file sets)

- **A — retrieval accuracy**: `src/lib/retrieval/*`, `scripts/build-index.ts`
- **B — UI/UX/a11y**: `src/app/globals.css`, `src/app/page.tsx`, `src/components/*`
- **C — security precision**: `src/lib/security/injection.ts` + tests
- **D — latency**: overlap `search()` with `makePlan()`; client-abort propagation
  (`src/lib/agent/orchestrator.ts`, `src/app/api/chat/route.ts`) — AC-L1, AC-C6

## Wave 4 — evaluation harness against a deployed URL (AC-E1)

`scripts/evaluate.ts --url https://…` driving the real SSE endpoint, emitting a
committed artifact with per-case grounding, citation validity, refusal
correctness, language match and latency.

## Wave 5 — judging panel (AC-E2/E3/E4)

Independent judges, one per rubric criterion, scoring the **deployed** system
from artifacts they can re-derive. Published to the repo.

## Wave 6 — fix judged findings, re-run identical evaluation, publish before/after

Same cases, same rubric, same commands; two artifacts side by side.
