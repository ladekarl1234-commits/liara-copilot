# Correctness Judge — Grounding & Answer Quality (owns: Answer quality 80)

Commit 67caf52. Degraded keyless mode (aiConfigured:false): model prose untestable;
retrieval, gate, evidence selection, caching fully testable. Findings below are
reproduced against the built index (3746 chunks) via `search()` probes and the
retrieval eval (`npx tsx scripts/evaluate.ts --retrieval-only`).

## Score: 55 / 80

| Subcriterion | Weight | Score | Note |
|---|---|---|---|
| Retrieval precision (right page in top-k) | 30 | 19 | hit@5=0.708 meets floor, but hit@1=33% — primary chunk [1] wrong 2/3 of the time; AC1 canonical page ranks 5th; several real questions miss top-5 entirely |
| Evidence gate correctness | 20 | 12 | Refuses unsupported (5/5 low) well, but HIGH tier is NOT conservative: fires on a retrieval MISS (cli-install) and a false-premise query (free-plan cron) |
| Grounding/citation architecture | 20 | 16 | Strong prompt rules (evidence-only, honest refusal, claim-verify stage), fences. Cannot test prose. |
| Adversarial / wrong-assumption handling | 10 | 8 | Gate leaves wrong-premise questions to the (unconfigured) answer model; high-confidence path bypasses scrutiny |

## Findings

### CORR-001 (P1) — Evidence gate returns `high` on a retrieval MISS; wrong grounding gets FAQ-cached
`src/lib/retrieval/index.ts:276` (gate), consumed `src/lib/agent/orchestrator.ts:193`.
Query "How do I install the Liara CLI?" → conf=**high**, coverage=1, scorePerToken=78,
margin=1.094. The actual install page `/references/cli/install` (indexed, title
"نصب و به‌روزرسانی Liara CLI") is **absent from top-5**; top chunks are
create-liara-json / create-app pages. `exactCoverage` saturates on generic
co-occurring tokens ("install", "cli") that appear on many pages, so it cannot
distinguish "a page that mentions install" from "the install page". Per the gate's
own comment the HIGH tier is meant to be conservative and is FAQ-cacheable; per
orchestrator.ts:193 a turn-0 `high` question answer is stored and served with zero
model calls on repeat. Result: a headline reference question is answered
high-confidence from pages lacking the answer, and the wrong grounding is cached.
EVIDENCE: probe output conf=high with top-5 all non-install; install page confirmed
in index.

### CORR-002 (P2) — hit@1 = 33%; AC1 canonical page buried at rank 5
Overall hit@1=0.33 (eval table). Evidence chunk [1] — which the answer prompt cites
first ([1],[2]) — is off-target on 2 of 3 sourced cases. AC1 "چطور متغیر محیطی…اضافه کنم"
returns `/paas/nodejs/related-apps/nuxtjs` at [1]; the canonical `/paas/details/envs`
ranks 5th. Framework-specific set-envs pages crowd out the general reference page, so
the model's first citation is likely a framework page the user isn't using.
EVIDENCE: probe set-env-vars top-5; eval OVERALL hit@1 33%.

### CORR-003 (P2) — Wrong-premise query gates `high`, premise never surfaced by retrieval
"چطور کرون‌جاب رو در پلن رایگان فعال کنم؟" (enable cronjob on the FREE plan) → conf=high.
The false "free plan" premise is not flagged anywhere in retrieval/gate; correction
depends entirely on the answer model, which is unconfigured here. A high gate also
routes to the cheap model and is cacheable — the worst path for a question that needs
careful correction. EVIDENCE: probe conf=high, coverage=0.714.

### CORR-004 (P2) — Real Liara questions miss top-5 (morphology/synonym + page-type gaps)
Eval rank=null (out of top-5) for: `nextjs-create-next-app-only` (Next.js quick-start
absent — AC2-adjacent), `mixed-ai-baseurl` (/ai/quick-start absent), `liara-dns-setup`
(/dns-management-system/quick-setup absent — dominated by /about + an iaas page),
`bucket-keys`, `wordpress-one-click`, `pg-econnrefused`. Lexical-only retrieval with
no vector index loaded (embeddings.json optional) leaves synonym/morphology gaps that
route generic /about hub pages above the answer page. EVIDENCE: eval rank=null list.

### CORR-005 (P3) — Eval labeling not validated; hit metrics are noisy/pessimistic
`pg-econnrefused` (AC4) scores rank=null though returned
`/paas/nodejs/how-tos/connect-to-db/postgresql` is a correct fix page, just not in the
hand-listed `expectedSources`. The floor gate (HIT5_MIN 0.66) rests on labels that
under- and possibly over-count; the measured 0.708 has unquantified label error.
EVIDENCE: case expectedSources vs returned top-5.

## Reasoning
Grounding *architecture* is sound (evidence-only prompt, claim-verify, honest
insufficient message, fences). The defect is in the retrieval/gate coupling: the
exact-token coverage signal treats generic corpus-ubiquitous co-occurrence as
"answer present", so the conservative HIGH tier fires on misses and false premises,
and that HIGH is load-bearing (FAQ cache + cheap-model route). hit@1=33% means the
first cited source is frequently wrong. Prose quality is untestable without a key.

## Residual risk / unverified
Answer prose, claim-verify effectiveness, and cheap-vs-strong routing quality need a
configured model — marked theoretical. Vector search was not exercised (no
embeddings.json loaded); a configured embedder may lift CORR-004 misses.
