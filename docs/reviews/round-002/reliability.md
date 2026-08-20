# Round 2 — Reliability judge (Security/reliability/monitoring 50)

Commit reviewed: 1c35583. Keyless server at http://localhost:3000 (3746-chunk v3 index).
Reviewed as-is; nothing assumed fixed. Real evidence captured via curl/tests.

## Findings

### REL-201 (P2) — Concurrent requests on the same session bleed context; retrieval filter corrupted
Prior REL-004 is STILL PRESENT. `getOrCreateSession` returns a single shared mutable
`SessionState`; `handleChatMessage` mutates it across `await search()` with no lock
(`src/lib/state/sessions.ts`, `src/lib/agent/orchestrator.ts:49,96`).

Reproduced (twice):
- Baseline, postgres question alone → chips `["DBaaS","PostgreSQL"]`.
- Same session, concurrent "my nextjs build failed" + "postgres pricing plan cost" →
  the postgres request emits chips `["Next.js","DBaaS","PostgreSQL"]`.

The `Next.js` platform leaked from the concurrent Next.js request onto the postgres
request's context, which then feeds `filters.platform=nextjs` into retrieval for a
postgres query — wrong docs filtered in. Realistic trigger: double-click send, or two
browser tabs (single user, single instance — not a multi-instance-only issue). Corrupted
state persists to later turns (follow-up still showed Next.js). Untested (no concurrency
test in tests/orchestrator.test.ts).
Direction: copy-on-write the session per turn and merge on save, or a per-session async
mutex around the read→patch→save window.

### REL-202 (P2) — Plan-step model error masked by fallback; retry budget can exceed maxDuration during a provider hang
`makePlan` catch (plan.ts:296) swallows every ModelError (incl. model_timeout) and returns
the deterministic fallback, then the orchestrator proceeds to the answer call. Per call the
provider does `MODEL_MAX_RETRIES+1 = 3` attempts × `MODEL_TIMEOUT_MS=30000` = up to ~91s
on a hung provider (config.ts:13-14). Plan(91s)+answer(91s) = ~182s > route `maxDuration=120`
(route.ts:18). When the platform kills the function at 120s it aborts req.signal → orchestrator
treats it as ClientAbortError and returns emitting NO `error` and NO `done` event: the client
sees a silently truncated SSE stream. A hung provider on the plan step wastes ~91s before the
answer call is even tried, instead of surfacing a clean `model_timeout`.
Direction: on a plan model_timeout/model_unavailable, surface the error instead of proceeding;
or budget the total request against maxDuration (shrink per-call timeout/retries so plan+answer
+verify fit).

### REL-203 (P3) — loadIndex reads meta.json without an existsSync guard → wrong error taxonomy
`loadIndex` checks `chunks.json`/`lexical.json` exist (index.ts:60) but reads `meta.json`
unconditionally (index.ts:64). A missing/corrupt meta.json throws a generic ENOENT Error, not
`IndexMissingError`. The orchestrator then classifies it `internal` (orchestrator.ts:229) and
tells the user "unexpected error" instead of the actionable "run `npm run index`". Health still
returns 503 (its catch is generic), so happy-path 503 is unaffected.
Direction: guard metaPath with existsSync (or wrap the meta read) so it throws IndexMissingError.

### REL-204 (P3) — Mid-stream provider drop: partial answer shown, then an error banner; partial discarded
If `generateStream` throws after some deltas (provider drops mid-stream, non-abort network
error), the for-await throws → orchestrator catch emits an `error` event AFTER partial `delta`s
already rendered, and `pushTurn(..., '<error:...>')` stores the error gist, discarding the
partial the user already saw. Honest but jarring; the stored turn no longer reflects what the
user read.
Direction: if any delta was emitted, finish the turn (done) with a soft "connection interrupted"
note rather than an error event, and store the partial answer.

### REL-205 (P3/informational) — TRUST_PROXY default 'off' collapses all direct clients into one 20rpm bucket
`clientIp` returns the literal `'direct'` when TRUST_PROXY=off (validate.ts:96, default off in
config.ts:26). Deliberate fail-closed anti-spoof choice, but the blast radius is large: any
deployment placed behind a proxy that forgets to set TRUST_PROXY=on rate-limits ALL users
through a single shared 20 rpm bucket (RATE_LIMIT_RPM default 20) — a self-inflicted availability
cap that is easy to misconfigure and hard to diagnose (no signal that every client shares a key).
Direction: log a one-time warning when TRUST_PROXY=off in production, or key on the socket remote
address when available.

## Cleared (attacked, not broken)
- Input validation: empty body→400, malformed JSON→400, empty/whitespace message→400,
  bad sessionId→400, wrong-type message→400, >64000B→413, >8000 chars→400. All verified via curl.
- Health happy path: 200 `{status:ok, chunkCount:3746}` — the 503 change did not break it.
- Injection front door: "ignore all previous instructions…" refused deterministically with NO
  citations emitted (verified).
- Dependencies: `npm audit --omit=dev` → 0 vulnerabilities (SEC-004 resolved).
- Verify stage: fully wrapped in try/catch → returns skip; a verify failure cannot emit a
  spurious error after a good answer (verify.ts:59).
- Provider stream leak: reader.cancel() in finally on normal end / throw / return (provider.ts:131).
- Rate limiter: clock-step-back clamped (ratelimit.ts:25); per-key checked before global backstop
  so a throttled key can't drain the shared bucket.
- Client-abort: ClientAbortError classified before timeout; abort path pushes an `<aborted>` turn
  so a retry isn't mistaken for a stateless turn 0.
- Body cap enforced on the actual stream (readJsonCapped) with reader.cancel() on oversize.

Residual risk: REL-201 needs a real concurrent load to fully characterize (filter corruption
under many interleaved turns); REL-202 numbers are config+code math — not reproduced against a
truly hung provider (keyless).
