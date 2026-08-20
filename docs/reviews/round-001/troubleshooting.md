# Troubleshooting / Agentic Judge — Round 001 (commit 67caf52)

Owned criteria: Agentic/personalization 50 · Answer quality 80.
Environment: keyless degraded mode (aiConfigured:false). Model prose untestable;
judged deterministic error detection, troubleshooting STATE + prompt design.

## Score (owned)
- Agentic/personalization: ~33/50
- Answer quality (troubleshooting slice): ~62/80
- phaseAreaScore: 66/100

## Findings

| id | sev | criterion | location | confidence |
|----|-----|-----------|----------|------------|
| TR-001 | P2 | Answer/Agentic | plan.ts:117,130 | high |
| TR-002 | P2 | Agentic | orchestrator.ts:121,172 | medium |
| TR-003 | P2 | Agentic | sessions.ts:63 / plan.ts:146 | high(structural)/theoretical(model) |
| TR-004 | P3 | Agentic | orchestrator.ts:24,94 | high(degraded)/theoretical(model) |
| TR-005 | P3 | Tests | tests/agent-units.test.ts:30 | high |
| TR-006 | P3 | Complexity | sessions.ts:64 | high |

### TR-001 — ERROR_RE misses common Persian failure phrasings → not classified as troubleshooting
preClassify's ERROR_RE only catches a fixed token set. Realistic support reports
in Persian using "…نشد / …نمیاد / قطع شد / پر شده / timeout" are classified as
`question`, not `troubleshooting`, in the fallback/keyless path (the only path
where deterministic intent is authoritative).

Probe output:
```
{"msg":"گواهی SSL صادر نشد","hasError":false,"intent":"question"}
{"msg":"اپلیکیشنم بالا نمیاد","hasError":false,"intent":"question"}
{"msg":"دیسک پر شده","hasError":false,"intent":"question"}
{"msg":"متغیر محیطی DATABASE_URL تعریف نشده","hasError":false,"intent":"question"}
{"msg":"gunicorn worker timeout","hasError":false,"intent":"question"}
{"msg":"دیتابیسم قطع شد","hasError":false,"intent":"question"}
{"msg":"entrypoint CRLF","hasError":false,"intent":"question"}
```
Fix: extend ERROR_RE with نشد/نمیاد/قطع شد/پر شد/timeout/gunicorn/worker + a
"deploy failed / won't start" family.

### TR-002 — resolve/next_step actions unhandled; resolution acknowledgment swallowed by the gate and never emitted
`action` values `resolve` and `next_step` are never special-cased in the
orchestrator (grep confirms only `clarify` and `insufficient` branch). A
resolution turn ("درست شد، مرسی") therefore runs retrieval; the query backfill at
plan.ts:208 fires only for `action==='answer'`, so a thin resolve turn gets a
message-slice query, likely fails the evidence gate (line 120), and returns
CANNED.insufficient. Worse, the gate-fail branch (lines 121-135) does NOT call
`emitState`, so the `troubleshooting{resolved:true}` state is saved to the session
but never emitted — the UI's "برطرف شد ✓" (HypothesisList.tsx:31) can never render.
Root-cause acknowledgment is lost.
Fix: handle `action==='resolve'` before the gate — emit troubleshooting state +
a resolution message without requiring fresh evidence.

### TR-003 — No deterministic troubleshooting logic; ledger is model-only and fully replaced each turn
fallbackPlan never constructs a `troubleshooting` object, so in the evaluated
keyless env no hypotheses ever form. Curl proof (DB connection error):
```
data: {"type":"context","chips":["DBaaS","PostgreSQL"]}
data: {"type":"delta","text":"سرویس مدل زبانی هنوز پیکربندی نشده ..."}
```
No `troubleshooting` event, no hypotheses, no ranking. Even with a key, applyPatch
(sessions.ts:63) REPLACES `s.troubleshooting` wholesale each turn with no
server-side merge — a single model turn that omits prior hypotheses wipes the
belief ledger. The "updates beliefs / ranks hypotheses" capability rests entirely
on the model re-emitting the full list every turn.
Fix: merge hypotheses by id server-side (preserve rejected/confirmed history);
optionally seed 2-3 ranked hypotheses deterministically from ERROR_RE class in
keyless mode.

### TR-004 — No loop guard against re-recommending a failed action
`lastAction` only deduplicates repeated `clarify` (orchestrator.ts:94). Nothing
prevents recommending the same failed diagnostic step; `triedActions` is fed to
the prompt but the answer rules never instruct avoiding already-tried actions.
Degraded-mode proof — two "still broken" follow-ups return byte-identical canned
text:
```
=== همون خطا رو هنوز میگیره، تست کردم فایده نداشت ===
delta: در مستندات رسمی لیارا پاسخ قابل‌اتکایی ... پیدا نکردم
=== بازم همون مشکل، هیچ فرقی نکرد ===
delta: در مستندات رسمی لیارا پاسخ قابل‌اتکایی ... پیدا نکردم
```
Fix: add "do not repeat tried actions (see tried=[...])" to answer rule 5; add a
server guard that records recommended-step hashes.

### TR-005 — Troubleshooting tests are a false positive for the regex gap
tests/agent-units.test.ts:30 asserts troubleshooting detection using ONLY
"connect ECONNREFUSED …" — the exact token the regex handles. No Persian-phrasing
negative case, and no end-to-end test of the troubleshooting ledger, belief
update, or resolve path (only a workflow orchestrator test exists). The suite
would stay green while TR-001/TR-002 ship broken.

### TR-006 — Dead no-op
sessions.ts:64 `if (s.troubleshooting.resolved) s.workflow = s.workflow;` — a
self-assignment guarded by a branch. Delete.

## Cross-cutting (route to retrieval judge)
- DB-port detection forces `filters.product='dbaas'`, dropping retrieval
  confidence high→medium for "ECONNREFUSED …:5432" and excluding paas-side
  networking docs. Informational.
- Citation title/URL mismatch observed: title "PostgreSQL … Laravel" with URL
  `dbaas/mongodb/...laravel`. Data/index issue — retrieval judge's area.

## Reasoning
The agentic troubleshooting story is architecturally thin: all hypothesis
formation, ranking, belief update and resolution live in the model prompt, with
the server acting as a pass-through that overwrites its own ledger each turn. That
is defensible as a design, but it means (a) nothing is observable or gradeable in
the shipped keyless environment, and (b) the two places the server DOES own logic
— error detection and resolve handling — both have concrete defects that survive
independent of any key. The prompt itself is well-formed (rank, one next test,
one clarify, update status), so with a key the ceiling is higher than what ships.
