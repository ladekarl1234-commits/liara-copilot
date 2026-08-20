# Convergence history — Phase II adversarial judge loop

Repo: https://github.com/ladekarl1234-commits/liara-copilot
Two scorecards are tracked: **Current-Phase Quality** (0–100, in-scope only) and
**Full Challenge** (X/300; deployment + real-API points remain PENDING by design).

| Round | Commit | Phase score | P0 | P1 | P2 | P3 | Main discoveries | Remaining blockers |
|---|---|---|---|---|---|---|---|---|
| baseline | `67caf52` | — | — | — | — | — | Phase I complete: 133 tests, gate/security/RTL hardened over 3 internal rounds | judge loop pending |
| 001 | `67caf52` | ~72/100 · 191/300 | 0 | 7 | 30 | 27 | retrieval dedup+synonym gap, gate-high fires on wrong page, agentic negation/knownError, keyless Fix/Guide inert, docker public/ missing, token accounting | retrieval precision, agentic state |
