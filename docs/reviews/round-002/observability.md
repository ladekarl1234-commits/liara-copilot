# Round 2 — Observability / Monitoring judge (Security-reliability-monitoring 50)

Commit 1c35583. Running keyless server (aiConfigured:false, 3746-chunk v3 index).

## Verified fixed (round 1)
- OBS-002 IP now hashed: `chat_request` log shows `ipHash:"d15690f08a57"`, no raw IP. Session id hashed too (`session` / metric `sessionId` = 12-char sha256). Confirmed in /tmp/srvr2.log.
- OBS-003 diag gating: `GET /api/diag` -> 404 on the running server (config().diagEnabled false). Raw question in trace ring is capped at message.slice(0,300) and only reachable when diagEnabled.
- Health: /api/health returns 503 when index missing, 200 keyless — confirmed 200 with loaded index.
- RequestMetrics fields all populated in record(): requestId, sessionId(hash), intent, product, retrieval/model/total latency, candidateCount, inputTokens, outputTokens, estimatedCostUsd(when COST env set), cacheHit, retrievalConfidence, modelRoute, errorCategory.

## Findings

### OBS2-001 (P2) — token metric still wrong for Persian; chars/4 undercounts the primary language
orchestrator.ts:200-201, verify usage, router.estimateCostUsd. Token count = `content.length/4` and `answer.length/4`. That 4-chars/token ratio is an English-BPE figure. Persian (the product's dominant language) tokenizes at roughly 1-2 chars/token under gpt-4.1's byte-BPE, so inputTokens/outputTokens — and therefore estimatedCostUsd, the metric OBS-001/COST-001 was supposed to fix ("cost/token metrics were badly wrong") — are undercounted ~2-4x for real traffic. The headline number the fix produces is still materially wrong for the main use case. Direction: language-aware factor (fa ~1.5 chars/tok) or provider usage when a key is present.

### OBS2-002 (P2) — gaps.jsonl grows unbounded and persists normalized user questions to disk in prod
gaps.ts:27-38. recordGap is called from the orchestrator unconditionally (NOT diag-gated): every low-confidence / insufficient / repeated-clarification turn appends a line forever. No rotation, size cap, or retention. Two costs: (1) unbounded disk growth on the running instance (data/runtime/gaps.jsonl), and readGapSummary does a synchronous full-file read each diag call; (2) normalizedKey(text)=tokenizeFa(text).join(' ') is the user's question with only stopwords removed — content words (including anything a user pastes: emails, ids, secrets) are reconstructable and retained on disk indefinitely. Direction: cap file size / rotate; keep only a hash or drop rare keys.

### OBS2-003 (P3) — estimatedCostUsd conflates fast+smart+embed tokens under one price
router.ts:25-31 sums all inputTokens/outputTokens and multiplies by a single COST_*_PER_MTOK. A request can span plan(fast) + answer(fast|smart) + verify(smart). When smart != fast pricing (the whole point of routing), the cost metric misattributes and cannot show the savings routing is supposed to deliver. No per-route token/cost breakdown is emitted. Direction: accumulate tokens per route label.

### OBS2-004 (P3) — the OBS-001 fix has no regression test; can silently revert to 0
Grep of tests/*.test.ts for inputTokens shows only mock provider usages; none asserts the logged metric's inputTokens > 0 after the answer path (the exact regression OBS-001 fixed). The line-200 estimate is uncovered — a refactor dropping it reproduces the original blind-cost bug with green tests.

### OBS2-005 (P3) — cache-hit metric omits intent (and often product)
orchestrator.ts:79-88 returns via record('cache') before `intent` is assigned (line 94). Cached-answer traffic is logged with intent absent and product usually undefined, so FAQ-cache hits are uncategorizable in monitoring/aggregation. Set intent before the cache-hit return.

## Cleared
- Secret redaction: log.ts replacer strips secret-named keys at every depth; message body never logged (only `chars`). Not broken. Residual: a secret pasted into an error `.message` could pass through chat_failed logging.
- Raw IP / session leak: attacked via triggering chats + reading log; only hashes present.
- Diag PII in prod: 404 confirmed.
