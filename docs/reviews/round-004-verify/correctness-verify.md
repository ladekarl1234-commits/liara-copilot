# Round-004 Correctness/RAG Verification (hostile)

Diff verified: 77eb3ff..b1d8604. Tests 163/163 pass. Eval hit@5=0.813, MRR=0.592,
gate=0.923 (12/13) — matches claimed numbers.

## Gate demotion (medium→low on !topTitleMatch && ratio<0.5) — CLEARED for over-refusal
Only ONE eval case flipped medium→low: `adversarial-system-prompt` (a case that
SHOULD refuse — gate stayed 6/6 adversarial). No legit answerable query demoted.
how-to conf 1h/5m/0l, deployment 0l, domain-dns 0l. Well-targeted. Residual risk:
a Persian query whose answering page has a title sharing no query token AND thin
coverage would refuse — none observed in 61 cases.

## Full-body dedup — CLEARED
Change makes dedup STRICTER-to-trigger (full body vs 400-char prefix) → keeps MORE
chunks, cannot drop needed evidence. Opposite failure (near-dup passthrough)
bounded by MAX_EVIDENCE_CHUNKS. No evidence loss.

## FINDING P1 — detectAbsentFeature false-refuses a REAL documented feature (K8S mirror)
`src/lib/security/injection.ts` ABSENT_FEATURE_PATTERNS: `/\bkubernetes\b|\bk8s\b|کوبرنتیز|کوبرنتس/i`.
The fix comment claims "Verified absent in the corpus." FALSE. The corpus contains
`public/llms/mirrors/k8s.md` → page "تنظیم میرورهای K8S", url docs.liara.ir/mirrors/k8s/
(Container Registry Mirror for Kubernetes — a genuinely offered Liara capability).
Probe (detectAbsentFeature):
  "چطور میرور Kubernetes لیارا را تنظیم کنم؟" → true (refused)
  "how do I configure the Liara k8s mirror?" → true (refused)
  "میرور k8s چیست" → true (refused)
detectAbsentFeature fires in orchestrator BEFORE FAQ cache and retrieval, emitting
CANNED.notOffered ("this isn't an offered capability"). So a user with a documented,
indexed, retrievable question is told the feature does not exist — a fabricated
false-negative capability claim, unrecoverable (short-circuits before retrieval).
This is a NEW regression introduced by round-3; the eval set has no k8s case so it
slipped through. FIX: drop the kubernetes/k8s pattern (mirror IS offered), or gate
it so it doesn't fire on "mirror". Secondary: SMS pattern `(ارسال|سرویس)…پیامک` also
matches corpus content ("ارسال پیامک به کاربران" worker example, "سامانه‌های پیامکی…
آی‌پی ثابت") — refuses documented worker/static-IP questions; weaker but same class.

## FINDING P2 — negation rewrite silently dropped "استفاده نمی" coverage
`plan.ts` NEG_AFTER_RE=`/^\s*(نیست|نبود|نمیخوام|رو عوض)/i`. Round-2 NEGATION_RE
explicitly covered "از nextjs استفاده نمی‌کنم" (I no longer use nextjs). Probe:
  "دیگه nextjs استفاده نمی‌کنم" → platform:nextjs, negatedPlatform:FALSE (regression)
Old code cleared this context; new code retains a stack the user abandoned. The
primary fix goal (stop false-fire on "my nextjs app is not working" → confirmed
negP:false ✓; "django instead of nextjs" → django,negP:true ✓) is met, and
under-firing is less harmful than over-firing, so P2 not P1. FIX: add
`استفاده\s*نمی|دیگه\s*…\s*نیست` to NEG_AFTER window.

## Deploy-intent workflow — CLEARED for RAG
DEPLOY_INTENT_RE flips intent→workflow but does NOT alter retrievalQueries or
filters (query still =[message]); workflow branch only runs on gateFailed, else
normal answer. `راه اندازی` over-matches common how-tos but only adds a workflow
chip alongside a normal answer — no retrieval/answer regression.

## Verdict
converged=false. 1 new P1 (K8S false-refusal fabricating a "not offered" claim for a
documented feature), 1 P2 (negation narrowing). Core RAG metrics and gate demotion
are sound and did not over-refuse the tested set.
