# Convergence history — Phase II adversarial judge loop

Repo: https://github.com/ladekarl1234-commits/liara-copilot
Two scorecards are tracked: **Current-Phase Quality** (0–100, in-scope only) and
**Full Challenge** (X/300; deployment + real-API points remain PENDING by design).

| Round | Commit | Phase score | P0 | P1 | P2 | P3 | Main discoveries | Remaining blockers |
|---|---|---|---|---|---|---|---|---|
| baseline | `67caf52` | — | — | — | — | — | Phase I complete: 133 tests, gate/security/RTL hardened over 3 internal rounds | judge loop pending |
| 001 | `67caf52` | ~72/100 · 191/300 | 0 | 7 | 30 | 27 | retrieval dedup+synonym gap, gate-high fires on wrong page, agentic negation/knownError, keyless Fix/Guide inert, docker public/ missing, token accounting | retrieval precision, agentic state |
| 001-fixed | `1c35583` | — | 0 | 0 | 0 | — | Batch 1-5 applied: retrieval hit@5 0.708→0.792, injection detector (adversarial 6/6), agentic negation/knownError/keyless Fix-Guide, npm 0 vulns, deploy (public/, tracing root, health 503), token accounting, docs synced | Round 2 pending |
| 002 | `1c35583` | ~78/100 · ~205/300 | 0 | 0 | 17 | 13 | injection precision (FP+bypass), agentic knownError regression + Fix-on-weak-evidence + SSL bucket, niche over-fire (hit@5 0.792→0.813), Persian token estimate, deploy doc, gap cap | none blocking; AG2-001 keyless "instead of" + single-instance ceiling deferred |
| 003 (final acceptance) | `77eb3ff` | ~80/100 · ~215/300 | 0 | 1 | 10 | 13 | P1 Guide-workflow keyless, exfil FP regression, absent-feature refusal, gate medium→low demotion, negation adjacency (captures switch target) | remediated in b1d8604; residuals P3/accepted/out-of-phase |
| 003-fixed | `b1d8604` | pending verify | 0 | 0 | 0 | ~9 P3 | all round-3 P1/P2 fixed + regression-locked (163 tests) | final verification pending |
