# Round 2 — summary & remediation

**Commit judged:** `1c35583` (round-1 fixes applied) · **Judges:** 8 fresh specialists, from zero.
**Findings:** 0 P0 · **0 P1** · 17 P2 · 13 P3 — a large improvement over round 1 (7 P1s). No majors.

## Scores (round 2, adversarial)

| Area | Round-2 score |
|---|---|
| Answer/retrieval | 70/100 |
| Agentic | 67/100 |
| Security | 76/100 |
| Reliability | 78/100 |
| Observability | 79/100 |
| Cost | 77/100 |
| Deployment readiness | 33/100 (Docker not built here; real deploy PENDING) |
| Competition aggregate | ~205/300 (deployment PENDING) |

## Remediated this round (root causes)

- **Injection detector precision (SEC2-001/002):** fixed a false positive (legit
  "delete all MY old apps" was refused — scoped destructive patterns to
  *another/others'* resources only) AND closed exfil bypasses ("what are your
  instructions", "repeat the text above", "developer mode"). +tests.
- **Agentic regression (AG2-004, self-inflicted in round 1):** `knownError` is
  no longer cleared while an unresolved troubleshooting flow is active — a
  follow-up mid-Fix keeps the error context. +test.
- **Troubleshooting on weak evidence (caught by me pre-round):** an error paste
  that gates `low` now runs the Fix flow (ranked hypotheses + one diagnostic
  step + troubleshooting state) instead of a flat refusal. +test.
- **Hypothesis mis-bucketing (AG2-002):** SSL/DNS errors matched the generic
  port bucket; buckets now match most-specific-first. +test.
- **Niche down-rank over-fire (RETR-001/002):** trigger terms now run through
  the same tokenizer+synonym fold (ZWNJ `وی‌پی‌اس` matched), penalty softened
  0.55→0.72, terms broadened with paraphrases. **Eval improved: hit@5
  0.792→0.813, hit@1 0.42→0.44, MRR 0.575→0.595**; service-discovery unblocked. +test.
- **Persian token estimate (OBS2-001/COST-R2-03):** language-aware
  `estimateTokens` (Persian ≈ 2.2 chars/tok) replaces the flat chars/4 that
  under-counted Persian input ~40%.
- **Deploy doc (DEPLOY-201):** DEPLOYMENT.md corrected — health is 503 on a
  missing index, 200 in keyless mode (was documented as "always 200").
- **Gap file (OBS2-002):** `gaps.jsonl` now rotates past 5MB (bounded).

## Deferred / accepted (documented)

- **AG2-001** (keyless "use django instead of nextjs" captures the cleared old
  platform but not always the new one): the stale platform IS cleared (no
  poisoning); capturing the new one on an "instead of X" construction is left to
  the model plan (with a key). Deterministic keyless NLP of "instead of" is
  low-value complexity; noted.
- **REL-201 concurrent same-session race:** the documented single-instance
  in-memory ceiling (DECISIONS D5) — a shared store is the phase-2 upgrade.
- **DEPLOY-202 build-time git clone of docs:** inherent to baking the index in
  the image; noted with the pin recommendation. Real Docker build + Liara
  deploy remain **PENDING (out of current phase)**.
- **Docker image build** could not be run (Docker CLI unavailable here) — the
  Dockerfile was verified by inspection + a local standalone build.

155 tests pass; eval hit@5 0.813 / gate 0.923 (floors hold); build clean; 0 npm vulns.
