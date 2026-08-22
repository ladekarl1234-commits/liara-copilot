# Phase III — Vercel production deployment, hardening, and measured re-evaluation

> Delta spec. Amends `spec.md` for the areas it names; everything else in
> `spec.md` stands. Written 2026-08-22 from evidence in
> `docs/reviews/phase-iii/recon.json` (5 parallel audits, 159 evidenced facts)
> plus live provider measurements recorded in §2.

## 1. Objective

Ship the existing Liara Copilot to **Vercel** as a real, publicly reachable
production deployment, then raise it — by measurement, not assertion — on the
Liara AI Challenge rubric (300 pt):

| Criterion | Max |
|---|---:|
| Answer quality and correctness | 80 |
| UI and user experience | 55 |
| Agentic capabilities and personalization | 50 |
| Security, reliability and monitoring | 50 |
| Deployment | 40 |
| Cost optimization | 25 |

The Liara/Docker deployment path (`Dockerfile`, `liara.json`) **must keep
working**. Vercel is an additional target, not a replacement.

## 2. Non-negotiable defect: the default model is not a chat model

`OPENROUTER_MODEL` defaults to `openrouter/free`, a dynamic router. Measured on
2026-08-22, six samples of the prompt `"Say OK"`:

| routed model | reply |
|---|---|
| `cohere/north-mini-code:free` | `OK` |
| `nvidia/nemotron-nano-12b-v2-vl:free` | `OK` |
| **`nvidia/nemotron-3.5-content-safety:free`** | **`User Safety: safe`** |
| `poolside/laguna-xs-2.1:free` | `OK` |

`nemotron-3.5-content-safety` is a safety **classifier**. Two of six samples
routed to it. In production that is ~⅓ of turns answered with `User Safety:
safe`, and a planner whose JSON never parses (permanent silent regex fallback).
A separate sample returned `content: null` with the whole budget spent on
`reasoning` tokens.

**AC-M1** The provider MUST send an explicit, pinned model preference list, not
a router alias.
**AC-M2** The provider MUST disable provider-side reasoning tokens by default.
**AC-M3** A stream that completes with zero content characters MUST be treated
as a provider failure (retry/fallback or a typed error), never surfaced as an
empty answer.

Measured effect of AC-M1+AC-M2 (streamed Persian RAG answer, 6 runs, pinned
chain `nemotron-3-super-120b-a12b` → `nemotron-3-nano-30b-a3b` →
`nemotron-nano-12b-v2-vl`):

```
TTFT   742 / 951 / 1101 / 1199 / 2747 / 3732 ms   median ~1150 ms
total 1125 / 1347 / 1842 / 2142 / 3114 / 4249 ms
[n] citations present 6/6 · Persian preserved 6/6 · model stable 6/6
planner JSON valid 8/8 across 4 queries × response_format on/off
```

Reasoning off vs on, identical prompt: `super-120b` 2297→2567 ms TTFT and
149→255 completion tokens; `nano-30b` 3330→7350 ms TTFT and 81→311 tokens.
Disabling reasoning is both faster and 40–60 % cheaper in output tokens.

Models observed persistently HTTP 429 on this key and therefore excluded from
the chain: `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`,
`z-ai/glm-5.2:free`. `nvidia/nemotron-3.5-lightning:free` is a reasoning model
with a measured 21.9 s TTFT — excluded.

## 3. Vercel blockers that must be closed

Each is evidenced in the recon artifact; the acceptance criterion is what the
deployed URL must do.

**AC-V1 — the index must reach the deployment.** `data/index/` is gitignored,
`git ls-files data` returns 0, `"build": "next build"` never builds it, and
Next's tracer cannot see a runtime-computed relative path. Today a Vercel build
yields `loadIndex()` throwing on every request and `/api/health` → 503.
*Deployed `/api/health` MUST return 200 with a loaded index.*

**AC-V2 — no model download inside a request.** The default
`AI_EMBEDDINGS_MODEL=local:` fetches ~52 MB from huggingface.co on every cold
isolate, into a read-only cache dir. *The embedding model MUST be resolved from
files shipped with the function; remote model fetching MUST be disabled so the
failure mode is an immediate lexical degrade, not a 10 s stall.*

**AC-V3 — no filesystem writes outside `/tmp`.** `/api/feedback` does
`mkdir`+`appendFile` under a relative `data/runtime`, returning HTTP 500 on
Vercel. *Feedback MUST succeed (2xx) on the deployed URL.*

**AC-V4 — `maxDuration` must be inside the platform ceiling**, and the
orchestrator's own composed budget MUST be smaller than it, so the platform
never kills a stream that the app still believes is alive.

**AC-V5 — client identification must work.** `TRUST_PROXY=off` makes
`clientIp()` return the literal `'direct'` for every visitor, so all traffic
worldwide shares one 20 rpm bucket. *On Vercel `x-forwarded-for` is
platform-set; the deployment MUST derive a per-client key from it.*

**AC-V6 — conversation state must survive across isolates.** Sessions, the FAQ
cache, the single-flight map and the rate limiter are module-level `Map`s. With
N isolates, ~(N−1)/N of follow-up turns silently start a new conversation.
*A follow-up turn MUST resolve its prior context on the deployed URL,
demonstrated by a two-turn HTTP test that references the first turn.*

**AC-V7 — function bundle under the platform limit.** Current trace 146.4 MB
before the index and the embedding model. *The deployed function MUST build,
and the bundle budget MUST be recorded.*

**AC-V8 — request-body limits must match the platform.** `VOICE_MAX_BYTES`
defaults to 8 MB; Vercel rejects bodies over 4.5 MB at the edge before the
function runs, so the app's own error path is unreachable.

## 4. Correctness and UX defects that cost rubric points

**AC-C1** `Permissions-Policy: microphone=()` disables the microphone for the
app's own origin, so the shipped voice feature cannot work in **any**
deployment. Voice MUST be permitted for `self`.

**AC-C2** The injection detector refuses legitimate Liara questions — measured
2 of 10 — with a hard canned refusal and no path forward. False-positive rate on
a legitimate-question corpus MUST be 0 %, with the true-positive corpus still
fully blocked.

**AC-C3** A pasted error log — the primary *Fix* use case — is silently clipped
at 8000 characters by `maxLength`, making the over-limit branch unreachable. The
user MUST be told, and long logs MUST remain usable.

**AC-C4** `prefers-reduced-motion` resets `animation` but not `animation-delay`;
elements using `fadeUp` with `both` fill and delays up to 0.75 s stay invisible.
Content MUST be visible with reduced motion on.

**AC-C5** Voice UI is offered regardless of whether the server has an STT
provider, so the user grants microphone permission and then fails. The
affordance MUST reflect server capability.

**AC-C6** A disconnected client MUST stop model spend (the `cancel()` handler
only logs today).

## 5. Latency contract

Critical path today is serial: `makePlan` (LLM) → `search()` → `generateStream`
(LLM) → `verifyAnswer` (LLM). Retrieval does not overlap planning.

**AC-L1** Retrieval MUST NOT sit behind the planner on the critical path.
**AC-L2** Cold-start index parse MUST be measured and reduced; `embeddings.json`
is 12 MB of JSON for what is 3744 × 384 Float32 = 5.75 MB of bytes.
**AC-L3** Targets on the deployed URL, measured over ≥20 real requests:
p50 time-to-first-token ≤ 2.5 s warm, p95 ≤ 6 s; p50 full answer ≤ 6 s.
**AC-L4** No accuracy regression is accepted for latency: the retrieval eval
floors in `evals/baseline.json` MUST hold or improve.

## 6. Evaluation contract

**AC-E1** An evaluation harness MUST be able to run against a **deployed HTTPS
URL**, not only in-process. Today no eval does.
**AC-E2** A judging panel scores the deployed system against the 300-point
rubric with per-criterion subscores and evidence.
**AC-E3** Results are published in the GitHub repository, with a **before/after**
comparison on identical cases and rubric, so the improvement is measurable.
**AC-E4** Every number published MUST be reproducible from a committed artifact
and a named command. No asserted metrics.

## 7. Definition of done

1. `https://<app>.vercel.app` serves the product; `/api/health` 200 with a
   loaded index.
2. A real multi-turn conversation over HTTP returns grounded, cited answers in
   Persian and English, with working follow-up context.
3. AC-M*, AC-V*, AC-C*, AC-L*, AC-E* each closed or explicitly recorded as an
   accepted risk with a reason.
4. `npm test`, `npm run typecheck`, `npm run lint` pass.
5. The Liara/Docker path still builds.
6. Before/after evaluation published in the repo.
