# Round-005 Re-Verify — Competition (HOSTILE, from zero)
Commit c224ce5. Area: competition end-to-end + convergence.

## Verdict: NOT at genuine convergence. 2 NEW regressions introduced by this very fix commit.
newP0/P1 = 1 (P1 injection over-block) + 1 P2 (negation over-match).

## Confirmed GOOD
- (a) P1 gone: detectAbsentFeature + CANNED.notOffered fully removed (no source refs; only docs). Corpus DOCUMENTS the three: chunks.json k8s=6, gpu=27, refund=1 of 3746 → they now route to retrieval, not a fabricated "not offered". False-absence claim eliminated. CONFIRMED.
- (b) Honest gate refusal for gibberish intact (integration test: "asdkjhasd" / "a" gate LOW). Eval unsupported gate 4/5 refuse via evidence gate.
- (d) 161/161 tests pass; eval hit@5=0.813, gate-accuracy=0.923; npm audit --omit=dev = 0 vulnerabilities. All match claims.

## P1 (NEW, introduced by fix #2 SECV-001) — exfil pattern over-broadened, blocks legit dev questions
src/lib/security/injection.ts:24  /\byour\b[\s\S]{0,20}\b(...|secret|credential|password|access token|token)\b/i
Broadening from `access token`/`secret key`/`credential` to BARE `token`/`secret`/`password` false-blocks legitimate Liara docs questions as "injection". Probed (detectInjection):
  BLOCKED: "How do I authenticate to your API with a token?"
  BLOCKED: "what is your token limit for the AI models?"
  BLOCKED: "how do I use your platform with an access token?"
"your API"/"your platform"/"your model" + "token" (≤20 chars) is the natural shape of real developer questions. FAILS WHEN a user asks about API-token auth or AI-model token limits → gets a canned injection refusal instead of an answer. Ironically re-breaks the exact GPU/AI-model feature the P1 fix restored.
FIX: keep the qualified forms — `(api[\s_-]?key|secret key|secret token|access token|your (own )?token|password|credential)` — require the possessive to bind the noun; do not match bare `token`/`secret` after "your API/platform/model".

## P2 (NEW, introduced by fix #3 CORR-R4-02) — negation abandonment over-matches "dropped"
src/lib/agent/plan.ts:144 NEG_ABANDON_RE bare `dropped` alternative + 30-char afterWide window.
Probed (preClassify): negatedFramework=true for
  "my nextjs app dropped 500 requests after deploy"
  "my nextjs connection dropped"
"dropped" is a ubiquitous troubleshooting word (dropped requests/connections/packets). FAILS WHEN a user reports a live bug on a platform they ACTIVELY use → agent marks it abandoned, corrupting context chips / Fix workflow for that platform. Intended cases ("no longer use", Persian) still correct; "not working" still correctly false.
FIX: drop bare `dropped` from NEG_ABANDON_RE; require a use/abandon verb ("stopped using", "no longer using") — "dropped" needs an object like "dropped nextjs".

## Dual scorecard (honest, not inflated)
Current-Phase: 86/100  (−10 P1 legit-question false-block, −4 P2 agentic state corruption; core flows chips/Persian/Fix/Guide/k8s/gibberish all work).
Full-Challenge: ~180/300  — deployment phase PENDING (real deploy not done), retrieval hit@1 0.44 accepted ceiling, single-instance/keyless-ledger accepted. Not 300; deployment ~1/3 unearned.

Known-accepted (not counted): keyless ledger, CSP unsafe-inline, deploy PENDING, single-instance, hit@1 0.44.
