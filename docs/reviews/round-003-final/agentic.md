# Round 3 — Agentic final judge (criterion: Agentic 50)

Commit 77eb3ff · keyless mode (aiConfigured:false) · live curl multi-turn + tsx preClassify probes.
Model-authored prose paths are theoretical (no key); all findings below are keyless-deterministic
(preClassify / fallbackPlan / applyPatch) — i.e. the exact code the judges exercise.

## Verified WORKING (attacked, held)
- Error→hypothesis buckets all correct: ECONNREFUSED→host/port bucket, SSL/DNS→cert bucket,
  disk→storage bucket, 502→port/crash bucket. Most-specific-first ordering holds (SSL not mis-bucketed to port).
- Negation DOES clear the negated platform (no poisoning): "دیگه nextjs نیست" drops Next.js chip.
- Mid-Fix follow-up keeps error context (AG2-004): "پورت را چک کردم" mid-502 keeps troubleshooting active.
- Topic switch DOES clear troubleshooting WHEN the new product regex-matches (postgres→email cleared TS).

## FINDINGS

### AG3-001 (P1) Guide/workflow flow is entirely absent in keyless mode
`src/lib/agent/plan.ts:181-217` `fallbackPlan` seeds `troubleshooting` only; it never builds `workflow`.
Line 194 comment claims "workflow steps from a detected deploy intent" — no such code exists (no seedWorkflow).
Live: "step by step guide to deploy nextjs on liara" and "چطور جنگو را قدم به قدم دیپلوی کنم" → NO workflow event.
Round-1 remediation ENDUSER-001/TR-003 explicitly promised to "deterministically seed hypotheses/steps in
fallbackPlan" — only hypotheses shipped; the Guide half is missing. The workflow only ever comes from the
model plan (PlanSchema.statePatch.workflow), so with no key the headline "Guide" agentic capability is
unobservable in the exact mode judges run. tests/orchestrator.test.ts:244 uses a SCRIPTED provider, so it
proves plumbing, not keyless behavior — no coverage of the gap.

### AG3-002 (P2) Negation over-fires on the most common troubleshooting sentence shape ("X is not working")
`src/lib/agent/plan.ts:127,141-147` `NEGATION_RE` treats verb negation ("is not working/deploying/established")
as platform/db negation because the 25-char proximity window can't tell "not <verb>" from "not <platform>".
Live chips: "my nextjs app is not working" → [] · "my nextjs app has a problem" → [Next.js, PaaS];
"nextjs is not deploying, error 502" → [Troubleshooting] only (Next.js dropped) vs "nextjs deploy error 502"
→ [Next.js, PaaS, Troubleshooting]. "postgres connection is not established" → database cleared (negD=true).
Effect: the platform/db the user is troubleshooting is dropped, so retrieval loses its scope filter and
personalization chips vanish on ordinary English error reports. New (not the deferred "instead of X" case).

### AG3-003 (P2) Stale troubleshooting/knownError survives a genuine topic switch (AG-002 class reintroduced)
`src/lib/state/sessions.ts:64-73` clears stale error only on `topicSwitched`, which needs the new turn's
`product` to regex-match. Common Persian transliteration "آبجکت استوریج" is NOT matched by PRODUCT_HINTS[0]
(`object storage|فضای ذخیره|باکت|bucket|s3`; needs "باکت"/English). Live: turn1 postgres ECONNREFUSED →
turn2 "قیمت آبجکت استوریج چنده؟" still shows chips [DBaaS, PostgreSQL, عیب‌یابی] and TS active with the OLD
problem; knownError (the ECONNREFUSED paste) is retained into an unrelated pricing question. Also, because
keyless troubleshooting never `resolved`, it is sticky: once entered it blocks knownError clearing until a
NEW product happens to be regex-detected.

### AG3-004 (P2) Keyless Fix flow does not adapt — static ledger, panel drops mid-flow
Hypotheses are seeded once on the error turn (`seedTroubleshooting`) and never advance/reject on replies
(no model, no deterministic state machine). Live 502 flow: turn2 "پورت را چک کردم درست بود" leaves the ledger
byte-identical (h1 still `testing`). turn3 "الان باید چیکار کنم؟" (no error signal → intent=question) hits the
plain `insufficient` refusal path (orchestrator.ts:151-165) which does NOT call `emitState`, so the
troubleshooting panel disappears from the current answer while the `عیب‌یابی` context chip still shows active —
chip and panel disagree. So "ranked, one step, adapts" is a one-shot list, not an adaptive loop, keyless.

### AG3-005 (P3) Topic switch leaves stale database/platform chips
`sessions.ts:72` on `topicSwitched` clears `troubleshooting` but not `database`/`platform`. Live: postgres→email
switch shows chips [Email, PostgreSQL] — the PostgreSQL context lingers into an email question.

### AG3-006 (P3, deferred-verified) Negation second-platform adoption is dead code
`plan.ts:156-160` tries to adopt a replacement platform on a switch, but `isNegated`'s 25-char window catches
the negation cue sitting BETWEEN the two terms ("X نیست، از Y"), so Y is also judged negated. tsx probe:
"دیگه nextjs نیست، از django استفاده می‌کنم" and "use django instead of nextjs" both → platform:undefined.
This is the documented deferred AG2-001 — confirmed genuinely non-functional; the in-code comment overstates it.

## Score
Agentic sub-score: 60/100. Fix buckets/negation-clear/mid-fix-retention are solid, but a headline flow (Guide)
is invisible keyless (AG3-001, P1), negation drops context on ordinary "X is not working" reports (AG3-002),
and the AG-002 stale-error class is reproducible via Persian transliteration (AG3-003). wouldDeduct = true.
No P0. One P1 (Guide absent in tested mode). No security/data-loss issues in this area.
