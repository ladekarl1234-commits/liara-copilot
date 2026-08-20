# Reliability Judge — Round 001

**Owned criterion:** Security / reliability / monitoring — 50
**Score:** 42 / 50
**Verdict:** changes required (no P0/P1; several P2 defects)

## Method
Reviewed provider.ts (retry/timeout/abort), orchestrator.ts (pipeline/error path),
plan.ts (extractJson + zod .catch), verify.ts, retrieval/index.ts (IndexMissingError,
gate), validate.ts, ratelimit.ts, sessions.ts, chat/route.ts, health/diag routes.
Live-tested against localhost:3000 (keyless degraded mode).

## Live evidence (all PASS)
- Bad JSON → 400 `invalid JSON body`; empty msg → 400; missing msg → 400;
  bad sessionId `../etc` → 400 `invalid session id`.
- Body > 64KB → 413 `request too large`; 9000-char message → 400 `exceeds 8000`.
- Gibberish `asdkjhasd qwe zzz` → honest EN refusal + nearest sources (gate held).
- Degraded keyless mode is HONEST: states `AI_BASE_URL / AI_API_KEY` not set, shows sources.
- Concurrent same-session requests both completed cleanly (keyless is fast; interleave window small).

## Findings

### REL-001 (P2, medium) — Timeouts are retried; worst-case model call ~91s, request can exceed maxDuration=120s
`provider.ts:49-79` retries ALL fetch failures including `AbortSignal.timeout` firing.
With defaults MODEL_TIMEOUT_MS=30000, MODEL_MAX_RETRIES=2 → 3 attempts × 30s + backoff
(0.25s+1s) ≈ 91s per model call. Orchestrator issues up to 3 calls (plan+answer+verify).
A provider-wide slowdown makes the user wait ~91s for a fallback plan, and plan+answer can
sum past `maxDuration=120` (route.ts:18) → platform hard-kills with no graceful fa/en error
event. Retrying a timeout rarely succeeds and multiplies latency+cost. Fix: don't retry on
`isTimeout` (only on network/5xx), or cap total wall-clock across attempts.

### REL-002 (P2, medium) — Verify swallows every error silently, incl. ClientAbortError
`verify.ts:59 catch { return skip }` — no log. If the verify model always 500s/times out,
answers ship unverified with ZERO signal (checklist 18: undiagnosable at 3am). Also a
client abort DURING verify is swallowed, so orchestrator proceeds to `finish`/cache/
`record('answered')` instead of the abort branch — a gone-client turn is mislabeled and a
FAQ-cache write is wasted. Fix: `log('warn','verify_failed',…)` and rethrow ClientAbortError.

### REL-003 (P2, medium) — Global rate backstop caps ALL users at RATE_LIMIT_RPM×10 = 200 rpm
`ratelimit.ts:19,55-57`. Even behind a trusted proxy (per-IP working), aggregate traffic is
capped at 200 req/min across every user; the 201st legit request/min gets 429. Deliberate
cost backstop, but the shared ceiling is a self-inflicted availability limit under real load
and is not surfaced in health/metrics. Fix: raise/scale GLOBAL_FACTOR with expected concurrency
or make it env-tunable; emit a metric when the global bucket throttles.

### REL-004 (P3, theoretical) — Concurrent same-session requests share a mutable object
`sessions.ts:14-22` returns the same in-memory reference. At model-latency await points in
orchestrator, two requests on one session can interleave: double-count `turns`, both see
`turns===0` and double-write the FAQ cache, or clobber each other's `applyPatch` merge.
Low real-world likelihood (per-user), single-threaded narrows the window. Confirmed by code,
not reproduced live (keyless too fast). Fix: per-session in-flight guard or copy-on-write patch.

### REL-005 (P3, minor) — Health reports status:'ok' while aiConfigured:false
`health/route.ts:16`. A monitor keying on `status` cannot tell the app is in keyless
degraded mode (cannot generate prose). Consider `status:'degraded'` when `!aiConfigured`,
or a distinct field, so uptime checks reflect actual capability.

### REL-006 (P3, minor) — Mid-stream break emits generic 'internal' after partial deltas
`orchestrator.ts:163-166` + provider stream: a connection drop after 200 OK throws inside the
for-await; no stream-level retry, user sees partial answer then a generic `internal` error
event. Acceptable, but the error code doesn't distinguish a mid-stream cut from a pre-stream
failure. Observability nicety.

## Cleared (attacked, not broken)
- extractJson/zod: `.catch()` on every field + `safeParse` → malformed model JSON degrades to
  fallback plan (plan.ts:195-196), never throws. Verified by reading.
- Reader/body release: `generateStream` finally `reader.cancel()` (provider.ts:131-135);
  retryable-status path drains `res.text()` (line 60); readJsonCapped cancels on oversize.
- Abort taxonomy: client abort classified BEFORE timeout (provider.ts:71), ClientAbortError
  rethrown in plan (plan.ts:211) and handled in orchestrator (202) — no error metric for gone clients.
- IndexMissingError: health stays 200/degraded (live), errorMessage has index_missing fa/en.
- Retries bounded (max 5, default 2, backoff bounded); global map swept (ratelimit.ts:39).
- Rate key is IP-only, fail-closed 'direct' default; sessionId can't mint a bucket. Verified live.

## Reasoning
The failure taxonomy, drain/release discipline, fail-closed defaults, and degraded-mode
honesty are genuinely strong — better than typical. The real weakness is timeout handling
(REL-001): the retry policy optimizes for transient blips at the cost of catastrophic tail
latency, and nothing bounds total wall-clock against the platform's 120s kill. REL-002 is the
observability blind spot that would bite at 3am.
