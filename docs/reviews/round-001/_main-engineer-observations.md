# Round 1 — main engineer independent observations (UI + reproduced defects)

These are findings I reproduced directly while the judge panel ran. They feed
the same triage.

## ME-001 — P1 — 3 of 4 landing chips produce a refusal (Answer 80 / UX 55)

**Repro** (exact keyless pipeline, `preClassify`→`fallbackPlan`→`search`):

| Chip | gate | keyless result | top hit (relevant!) |
|---|---|---|---|
| استقرار پروژه‌ی من | medium | sources | overview/dbaas |
| رفع یک خطا | **low** | **refusal** | paas/*/fix-common-errors/502 |
| اتصال دیتابیس | **low** | **refusal** | dbaas/about |
| تنظیم دامنه | **low** | **refusal** | paas/domains/about |

**Observed:** clicking 3/4 featured example chips returns "در مستندات رسمی لیارا
پاسخ قابل‌اتکایی برای این سوال پیدا نکردم" — a refusal — even though the correct
doc is the #1 retrieval hit. Screenshot: `screenshots/desktop-sources.png`.
**Expected:** a broad, answerable question ("how do I connect a database")
should retrieve the overview/how-to and answer, not refuse.
**Root cause (class, not the 3 examples):** Persian synonym/morphology gap —
متصل / اتصال / وصل (all "connect"), استقرار / دیپلوی / مستقر (all "deploy") do
not exact-match, so `exactCoverage` under-counts and the gate returns `low`.
Compounded by conversational function-word padding diluting the ratio, and (for
the DB chip) the `dbaas` product filter narrowing to the overview page.
**Fix direction:** light Persian stemming + a small high-value synonym map
(connect/deploy/domain/database/error families) applied identically at index +
query time — improves retrieval recall (hit@k) AND the gate. Do NOT reword the
chips (that hardcodes the examples). Add regression eval cases for the chip
queries + the synonym pairs.
**Confidence:** high (reproduced against data/index).
