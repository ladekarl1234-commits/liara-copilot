# Round 2 — Agentic judge (Agentic 50)

Commit 1c35583 · keyless mode (aiConfigured:false) · fresh adversarial review.

## Round-1 fixes: VERIFIED present and functional
- Negation clears platform: `nextjs نیست` → platform=undefined (preClassify).
- knownError clears on topic switch: applyPatch `topicSwitched` path clears knownError + troubleshooting.
- Keyless troubleshooting seeding: fallbackPlan→seedTroubleshooting emits hypotheses; orchestrator emitState surfaces them in degraded mode.

The fixes work — but the new code introduces three defects where the state now *mis-remembers* or *invents wrong guidance*, which the brief calls worse than none.

## AG2-001 (P2) — Stack switch loses the NEW platform
plan.ts:150-154. `PLATFORM_HINTS.find` returns only the FIRST matching hint; on a switch both old+new appear. Negation clears the first, new never captured.
Repro: `use django instead of nextjs` and `من nextjs رو عوض کردم به django` → platform=undefined (evidence: probe). Should be django. The switch cues (`instead of`,`عوض کرد`,`به جای`) live IN NEGATION_RE, so the code KNOWS it's a switch yet only clears. Retrieval then runs with NO platform filter → wrong/unfiltered docs.

## AG2-002 (P2) — SSL/DNS errors emit PORT/502 hypotheses (wrong bucket)
plan.ts:211-243. ERROR_HYPOTHESES `.find` is first-match by array order; the 502/port bucket (`بالا نمی|اجرا نمی|پورت`) precedes the SSL bucket.
Repro: `خطای گواهی SSL دامنه‌ام، اپ بالا نمیاد` → hypotheses = "app not binding to PORT/0.0.0.0", "process crashing", "wrong start command" — zero mention of DNS/certificate (evidence: probe). A user with an SSL/DNS problem is confidently told to fix port binding.

## AG2-003 (P2) — ECONNREFUSED to ANY host assumes the Liara database
plan.ts:213-218. Bucket-1 regex matches bare `econnrefused` and hard-codes database guidance.
Repro: `connect ECONNREFUSED to my external payment API` → hypotheses hard-code "هاست داخلی سرویس دیتابیس لیارا" and "DATABASE_URL" (evidence: probe). Any refused connection (external API, cache, SMTP) is diagnosed as a Liara DB misconfig. Confidently wrong ledger shown to the user in the exact keyless path judges exercise.

## AG2-004 (P2, regression) — Follow-up question during an ACTIVE Fix clears knownError
sessions.ts:64. Clear condition is `(intent==='question'||'workflow'||topicSwitched) && !patch.context.knownError` — fires with NO topic switch.
Repro: T1 `اتصال ... ECONNREFUSED` seeds knownError+troubleshooting; T2 `متغیر محیطی رو کجای پنل ست کنم؟` (legit follow-up, no error keyword) → keyless intent=question → knownError cleared while troubleshooting still unresolved (evidence: probe, `AFTER T2 knownError=undefined trb=true`). Keyless never produces intent `followup`, so EVERY non-error follow-up mid-debug wipes the error context fed to the answer prompt (prompts.ts:118). Mitigation: troubleshooting.problem survives, so not total loss — hence P2 not P1. Guard should skip the clear while `s.troubleshooting && !resolved`.

## AG2-005 (P3) — ERROR_RE misses split "مشکل … دارم"
`مشکل SSL روی پورت 443 دارم` → hasError=false → NO Fix state seeded at all (Fix/Guide invisible). ERROR_RE requires contiguous `مشکل دار`; the common "مشکل … دارم" split escapes it.

## Cleared
- Negation over-fire on legit intent: `nextjs نیست مشکلم، دیتابیسه` correctly negates nextjs AND sets product=dbaas. Not broken.
- knownError on genuine topic change: cleared correctly.
- triedActions growth: bounded slice(-20).

## Score
Agentic quality ~67/100. Keyless visibility fixed (real gain) but seeded ledger now emits actively-wrong hypotheses (002/003) on plausible inputs, and a switch loses the target platform (001). A mis-remembering state model.
