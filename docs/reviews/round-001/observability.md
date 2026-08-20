# Observability Review — round-001

Commit under review: 67caf52. Judge: observability (owns Security/reliability/monitoring 50).
Environment: keyless degraded mode (aiConfigured:false), server at :3000 running with diag disabled (404 verified).

## Owned criterion score: monitoring/observability portion ~ 38/50

### What is genuinely present and correct (evidence-backed)
- request_id generated per request, propagated to the response as `x-request-id` and into every log line (chat/route.ts:23,110).
- session id is hashed (SHA-256, 12-char prefix) in BOTH `chat_request` and `request_metrics` — raw id never logged (orchestrator.ts:229, chat/route.ts:57). Verified in /tmp/srvp2.log: `"session":"2520b10268f2"` == `"sessionId":"2520b10268f2"`.
- Metric schema (types.ts:207-223) covers intent, product, retrievalLatencyMs, candidateCount, modelLatencyMs, totalLatencyMs, in/out tokens, estimatedCostUsd, cacheHit, retrievalConfidence, modelRoute, errorCategory. `record()` runs on every return path incl. catch and client-abort.
- Error taxonomy (ModelError codes / index_missing / internal) surfaced as errorCategory and to the user; client-abort deliberately excluded from error metrics.
- Secret-key stripping replacer at all JSON depths (log.ts:8-15); circular-fields fallback keeps the event.
- /api/diag correctly 404s when diagEnabled=false — verified `HTTP 404` against the running server.

### Defects (deductions)

| id | sev | criterion | location | issue |
|----|-----|-----------|----------|-------|
| OBS-001 | P2 | Cost 25 / monitoring | orchestrator.ts:168, provider.ts:100-136 | Answer-generation input tokens hardcoded to 0; cost/token metric systematically undercounts the dominant cost. |
| OBS-002 | P2 | Security/monitoring | chat/route.ts:53-59, validate.ts:91-97 | Raw client IP logged unhashed; in production (TRUST_PROXY=on) this is real PII, while session id is deliberately hashed. |
| OBS-003 | P2 | Security/monitoring | trace.ts:6, orchestrator.ts:247, diag/route.ts:20 | Dev diag exposes raw user message text (300 chars) from the trace ring buffer; /api/diag is unauthenticated and enabled-by-default in non-prod. |
| OBS-004 | P3 | Cost/monitoring | router.ts:25-32, config.ts:16-18 | estimatedCostUsd is emitted only if operator hand-sets two pricing env vars; default deployment emits no cost signal at all. |
| OBS-005 | P3 | monitoring/reliability | gaps.ts:21-37 | `warned` one-shot never resets: after the first gap-write failure, all subsequent failures are silently swallowed for the process lifetime. |

## OBS-001 (detail)
`provider.generateStream` yields only text deltas and never surfaces `usage`; the code never requests `stream_options:{include_usage:true}`. The orchestrator's answer accounting is:
`usage = addUsage(usage, { inputTokens: 0, outputTokens: Math.ceil(answer.length / 4) })`.
The answer prompt (system prompt + ALL retrieved chunks — the single largest prompt) contributes ZERO input tokens. Plan and verify calls (non-streaming `generate` → `usageOf`) count input tokens correctly, so total inputTokens = plan+verify only. estimatedCostUsd therefore ignores the dominant input cost. Code-provable (high) even though the model path can't run keyless.
Fix: request usage in the stream (`stream_options.include_usage`) and parse the final chunk, or estimate answer input from the built prompt char length.

## OBS-002 (detail)
Log line: `{"event":"chat_request","ip":"direct",...}` — here 'direct' only because TRUST_PROXY=off locally. DEPLOYMENT.md/config.ts:22-26 document TRUST_PROXY=on for Liara, where `clientIp` returns the real forwarded IP, which is then logged raw. Inconsistent with the (correct) session-hashing posture. Route the raw-IP-PII policy call to security-reviewer; observability owns that the log content leaks it.
Fix: hash or truncate the IP in logs, or gate raw IP behind a debug flag.

## OBS-003 (detail)
`recordTrace({ message: message.slice(0,300) ... })` stores the raw question; `/api/diag` returns `lastTraces(20)`. diagEnabled defaults to `!isProd` (config.ts:58), so any dev/staging deploy serves the last 50 users' raw questions (which may contain pasted secrets) with no auth. The gap recorder is careful (normalizedKey strips stopwords) but the trace is not.
Fix: store only normalizedKey in traces, or require an auth token on /api/diag.

## Reasoning / residual risk
The observability design is above-average for a hackathon submission — the metric schema is near-complete and session hashing shows real privacy thought. The deductions cluster on (a) cost blindness (OBS-001/004): the app cannot actually tell an operator what a request costs, which undercuts the Cost criterion, and (b) two PII channels (raw IP in prod logs, raw user text in dev diag) that contradict the otherwise-careful hashing posture. None is catastrophic; all are diagnosable and fixable with small diffs.
Model-written answer prose and live model-latency/token numbers could not be exercised (no key) — OBS-001's runtime magnitude is theoretical but the accounting bug itself is code-certain.
