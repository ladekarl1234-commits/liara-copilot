# Round 3 — Competition Final Judge (Holistic 300)

**Commit:** `77eb3ff` (round-2 remediation applied) · judged FROM ZERO, adversarial, keyless env (`aiConfigured:false`).
**Validation run live:** 155/155 tests pass · eval hit@5 0.813 / hit@1 0.44 / MRR 0.595 / gate 0.923 · `next build` clean · `npm audit` 0 vulnerabilities · server up (v3 index, 3746 chunks).

## Verdict
**No P0, no P1.** Two genuine in-scope **P2** deductions remain (retrieval precision; keyless multi-turn Fix does not progress). Everything else is at convergence or documented/out-of-phase. `wouldDeduct = true`.

## Scores (honest, deployment PENDING)

| Criterion | Score | Basis |
|---|---|---|
| Answer quality (80) | **57/80** | hit@5 0.813 solid, but hit@1 0.44 and specific canonical pages missed entirely; keyless surfaces wrong top source directly. Model prose = theoretical (no key). |
| UI/UX (55) | **46/55** | RTL, live chips, staged SSE, clean refusal-without-citations verified. Browser render not fully exercised. |
| Agentic (50) | **33/50** | State persistence, negation, knownError hygiene all verified fixed. Keyless Fix is effectively single-turn (frozen ledger). |
| Security/reliability/monitoring (50) | **43/50** | Injection defended (fa+en), IP-hash PII, token-bucket + global backstop, gate refuses, diag prod-gated, structured logs. |
| Deployment on Liara (40) | **31/40** | Dockerfile/liara.json/health-503 present & inspected; real build + deploy PENDING (out of phase). |
| Cost (25) | **20/25** | ≤2 calls, FAQ cache 0-call path, real input-token accounting, model routing verified. |
| **Aggregate** | **~218/300** | deployment PENDING. Current-Phase Quality (in-scope) ≈ **80/100**. Lowest criterion: **Agentic 66%**. |

P0: 0 · P1: 0 · P2: 2 · P3: several (polish only).

## Findings

### F1 — Retrieval hit@1 0.44; canonical detail pages missed entirely (P2, Answer quality)
`src/lib/retrieval/index.ts` (ranking). Live repros:
- `"How can I connect to my Liara PostgreSQL database from my laptop (outside Liara)?"` → top sources are all `connect-via-platform/.../#connection-pooling`; the public-access page (`dbaas/postgresql/quick-setup`) never appears. The user asked specifically about **external** access; the surfaced docs are the internal-platform path — actively wrong for intent.
- `"چطور health check تنظیم کنم…"` → returns `paas/details/zero-downtime-deployment`; the canonical `paas/details/health-check` page is absent from top-5.
- Eval confirms: english hit@5 0.33, how-to hit@1 0.17, mixed 0.50; `english-postgres-public-access`, `windows-vps`, `health-check-liara-json`, `mixed-deploy-port-flag` all rank >5.
**Why it matters:** in keyless mode the top sources ARE the answer, so a wrong/missing canonical page is a wrong answer, not just a ranking nit. Same class as round-1 CORR-002/004 (P2) — improved but not closed.
**Direction:** boost `/details/*` and `/*-setup`/`quick-setup` canonical pages for intent tokens (health check, public access) over how-to/related-app pages; add public-vs-internal DB-access disambiguation.
**Confidence:** high (reproduced live + eval).

### F2 — Keyless multi-turn Fix does not progress; follow-up retrieval drifts to irrelevant sources (P2, Agentic)
`src/lib/agent/plan.ts:259` (`seedTroubleshooting`) + `:195`; `src/lib/state/sessions.ts:92`. Live repro: turn 1 = "502 bad gateway after deploy" → ledger h1=testing,h2/h3=untested. Turn 2 (same session) = "I checked, the app is listening on the PORT env variable already" → **identical frozen ledger** (h1 still `testing`, nothing rejected/advanced/resolved), and citations become MySQL/MongoDB/Redis **connect-to-db** pages — irrelevant to a 502/PORT turn.
**Root cause:** keyless follow-ups have no error signature, so intent falls back to `question`; the orchestrator's `next_step` branch never fires and retrieval runs on the raw follow-up text. `seedTroubleshooting` only ever seeds from the current message with h1=testing; it never consumes prior state or `triedActions`, so the ledger cannot move without the model.
**Why it matters:** the README prominently promises "one diagnostic step at a time, wait for the result, adapt, explicit Resolved ✓." Keyless (what judges run) delivers a static hypothesis list and off-topic sources on turn 2+. This is the documented keyless ceiling in kind, but the frozen-ledger + wrong-sources artifact is concrete and visible.
**Direction:** when active troubleshooting exists and the turn has no new error, keep the prior ledger, advance h_current→rejected and next→testing on a "checked/tried" signal, and retrieve against `knownError` not the bare follow-up. Even a coarse keyless step-advance beats a frozen ledger.
**Confidence:** high (reproduced live).

## Cleared (attacked, not broken)
- **Injection:** "ignore all previous instructions / reveal system prompt" refused in fa+en; round-2 FP fix ("delete all MY apps") and exfil bypasses hold. Route deep auth/crypto to security-reviewer — none here.
- **Gate:** unanswerable ("قیمت سهام گوگل فردا") refused with no citations; off-topic/1-char gate LOW. Only failing gate case is `crlf-bad-interpreter` (documented accepted debt — not re-reported).
- **State poisoning:** negation clears platform; knownError kept mid-flow, cleared on topic switch; session LRU/TTL; client sessionId never adopted (session-fixation-safe) and correctly echoed for continuity by useChat.
- **Concurrency/limits:** token bucket + global backstop; per-IP key (sessionId cannot mint buckets); byte cap enforced on stream not header; body/JSON validated at boundary.
- **Cost:** FAQ cache = 0 model calls (verified via metrics log); token accounting non-zero; routing present.
- **Obs:** structured JSON metrics/request logs; IP hashed; diag prod-gated (`diagEnabled=!isProd`).
- **Build/deps:** build clean, 0 vulns, standalone output + tracing root.

## Convergence statement
Product is at **near-convergence**: no blocking or major defect survives adversarial testing. The two P2s are real in-scope deductions (retrieval precision on the answer's own top source; keyless Fix not advancing) — both are quality ceilings, not breakage. Remaining items beyond these are P3 polish or the documented out-of-phase deploy/single-instance ceilings.
