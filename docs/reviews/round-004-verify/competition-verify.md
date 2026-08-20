# Round 4 — Competition Verify (HOSTILE, FROM ZERO)

**Commit judged:** `b1d8604` (round-3 fixes). Diff `77eb3ff..b1d8604`. Keyless env (`aiConfigured:false`), v3 index.
**Live validation:** 163/163 vitest pass · eval hit@5 **0.813** / MRR 0.592 / gate **0.923** · `npm audit` **0 vulnerabilities**. All match the claimed numbers.

## VERDICT: changes required — one NEW P1 introduced by round-3 fix #3.

The round-3 fixes for negation, gate demotion, dedup, context-chip reset, keyless Guide, and
assistant-vs-user secret scoping all hold under probing. But `detectAbsentFeature` (fix #3) is a
hard, pre-retrieval refusal gate whose "verified absent in the corpus" justification is FALSE for
Kubernetes: Liara ships a documented K8S mirror and the gate now refuses questions about it.

---

## P1 (NEW, introduced by fix #3) — detectAbsentFeature refuses a DOCUMENTED feature (K8S mirror)

**Location:** `src/lib/security/injection.ts:51-60` (`ABSENT_FEATURE_PATTERNS` `/\bkubernetes\b|\bk8s\b|.../`) → gated in `src/lib/agent/orchestrator.ts:79-87`.

**Claim in the code:** `// Verified absent in the corpus.`

**Reality (verified against `data/index/chunks.json`):** the corpus contains 6 k8s chunks, including
a dedicated page **"تنظیم میرورهای K8S"** documenting `https://k8s-mirror.liara.ir`, plus
Container-Registry-mirror pages that serve Docker/Kubernetes images. Liara DOES offer a K8S mirror.

**FAILS WHEN:** user asks any K8S-mirror question — verified live via `detectAbsentFeature(...)`:
- `چطور میرور k8s لیارا را تنظیم کنم؟` → **true**
- `تنظیم میرورهای K8S` → **true**
- `k8s-mirror.liara.ir` → **true**
- `Docker و Kubernetes image mirror` → **true**

All four short-circuit at orchestrator:79 with `CANNED.notOffered` ("این قابلیت ارائه نمی‌شود" /
"isn't an offered capability") BEFORE retrieval runs. A documented feature is actively denied — a
worse failure than a weak answer, on the exact competition axis (honest-refusal vs. answer). No
recovery path: the gate fires before retrieval, so the answering page is never consulted.

**COST:** wrong, misleading capability denial on a documented topic; contradicts the fix's own
premise. Not caught by tests (the added tests only probe `آیا لیارا Kubernetes دارد؟`, never the
mirror-config phrasing) nor by the retrieval eval (separate path).

**FIX (smallest):** narrow the k8s pattern to *managed-cluster* intent (e.g. require
`cluster|کلاستر|managed|مدیریت‌شده` adjacency) so mirror/registry questions fall through to
retrieval; or drop the k8s pattern entirely and let the gate + fencing handle it. Correct the
`Verified absent` comment — it is false for k8s, sms (پیامک appears re: static IP), and Docker/K8S mirrors.

---

## Cleared (attacked, not broken)

- **Negation (fix #2)** — `NEG_BEFORE_RE`/`NEG_AFTER_RE` adjacency: "my nextjs app is not working"
  and "django instead of nextjs" both classify correctly (verified via tests + reading). Residual:
  "nextjs رو به django عوض کردم" (post-positioned "عوض کردم" not in NEG_AFTER) misses the switch —
  pre-existing edge, P3, not a regression.
- **Gate demotion (fix #4)** — `!topTitleMatch && ratio<0.5 → low`: eval gate-accuracy still 0.923,
  hit@5 0.813 unchanged. No regression.
- **Dedup full-body (fix #6)** — key is now full normalized body; eval unchanged. No collision-drop.
- **Context-chip reset (fix #5)** — `setContextChips([])` at turn start; server re-emits on context. Sound.
- **Keyless Guide (fix #1)** — `seedWorkflow`+`workflow` branch emits a checklist; `intent==='workflow'`
  with a key falls through to the model answer path (no crash). Verified via orchestrator test.
- **Exfil scoping (fix #3a)** — user self-service credential-viewing no longer refused; assistant's
  own key/prompt still blocked. Verified via injection tests.
- **Injection ordering** — runs before `detectAbsentFeature` (security-first). Sound.

## Dual scorecard (honest, deployment PENDING)

- **Current-Phase Quality (in-scope): ~78/100** — down from round-3's ~80 by the new K8S false-refusal P1.
- **Full-Challenge: ~215/300** — real Docker build + Liara deploy still PENDING/out-of-phase (~40-pt criterion unearned). Not faked.

## Convergence
NOT converged. One in-scope P1 remains (K8S mirror false-refusal). Everything else is P3 or out-of-phase.
