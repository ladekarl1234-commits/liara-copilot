# Round 3 — final acceptance summary & remediation

**Commit judged:** `77eb3ff` · **Panel:** 6 fresh judges told "find every remaining reason to lose points."
**Findings:** 0 P0 · **1 P1** · 10 P2 · 13 P3.

## Remediated (commit `b1d8604`)

- **AG3-001 (P1) — Guide invisible keyless:** `seedWorkflow` now emits a
  deterministic deployment checklist (detected stack → ranked steps) and the
  orchestrator runs the Guide flow on weak evidence, mirroring Fix. Live-verified.
- **SEC3-001 (P2 regression) — exfil false positive:** the round-2 exfil
  broadening refused legit "show my API key in the panel". Scoped to the
  ASSISTANT's own prompt/secrets ("your api key", "system prompt"); user's own
  Liara credentials are answered. Attacks still blocked. +tests.
- **CORR-R3-02 (P2) — unsupported feature phrasing-fragile:** `detectAbsentFeature`
  (GPU, Kubernetes, SMS, refunds) refuses honestly regardless of in-domain
  padding, before retrieval can answer from unrelated pages. +tests.
- **CORR-R3-01 (P2) — confidently-wrong-but-grounded:** gate demotes medium→low
  when the top chunk's title carries no query token and coverage is thin.
- **AG3-002 (P2) — negation over-fire:** rebuilt on adjacency — "my nextjs app
  is not working" keeps nextjs; "use django instead of nextjs" now captures
  django (also fixes the previously-deferred AG2-001/AG3-006). +tests.
- **UX-301 (P2) — stale chips:** context chips reset each turn.
- **CORR-R3-04 (P3):** evidence dedup keys on the full normalized body, not a
  400-char prefix.

## Accepted / deferred (documented, not blocking)

- **AG3-004 / F2 — keyless troubleshooting ledger doesn't advance on user
  feedback:** inherent to keyless mode. The ledger is a deterministic *snapshot*
  from the error signature; advancing it on "I tried X, still broken" requires
  reasoning — the model does this when a key is configured. Not a defect in
  scope; the with-key path handles it.
- **SEC3-002 — CSP `unsafe-inline`:** Next.js hydration needs inline scripts
  without a nonce middleware; there is no HTML sink (no `dangerouslySetInnerHTML`,
  react-markdown escapes). Documented accepted (DECISIONS-adjacent).
- **SEC3-003 — some exfil paraphrases bypass the regex detector:** a regex can
  never enumerate every phrasing; the detector is one layer. The real defenses
  are the `<user_data>` fencing and the answer-prompt refusal rule (both tested).
- **CORR-R3-03 — English/object-storage hit@1 ranking (small-n, P3):**
  connect-via-platform vs quick-setup ordering; marginal, deferred.
- **COST-301/304/305 — verify re-sends evidence, most answers route to smart:**
  quality-risking optimizations; verification is on by default deliberately
  (grounding > cost). Deferred to avoid trading correctness for cost.
- **UX-302/303 — feedback re-clickable, source bdi ordering (P3):** cosmetic.
- **Real Docker build + Liara deploy — PENDING (out of current phase).**

163 tests pass · eval hit@5 0.813 / gate 0.923 · build clean · 0 npm vulns.
