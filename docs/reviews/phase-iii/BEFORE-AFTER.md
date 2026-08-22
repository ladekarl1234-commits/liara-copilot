# Phase III — before / after

Every number here comes from a committed artifact and a named command. Nothing
is asserted. Where a number moved for a reason other than the change under
discussion, that is said out loud.

- **Live deployment:** <https://liara-copilot.vercel.app>
- **Before:** commit `05f25e6` (Phase II converged, Docker/Liara target only)
- **After:** commit `31dead4`

---

## 1. The defect that mattered most

`OPENROUTER_MODEL` defaulted to `openrouter/free` — a *dynamic router*, not a
model. Six live samples of the prompt `Say OK`:

| routed to | reply |
|---|---|
| `cohere/north-mini-code:free` | `OK` |
| `nvidia/nemotron-nano-12b-v2-vl:free` | `OK` |
| **`nvidia/nemotron-3.5-content-safety:free`** | **`User Safety: safe`** |
| `poolside/laguna-xs-2.1:free` | `OK` |
| **`nvidia/nemotron-3.5-content-safety:free`** | **`User Safety: safe`** |
| `nvidia/nemotron-nano-12b-v2-vl:free` | `OK` |

`nemotron-3.5-content-safety` is a safety **classifier**. Two of six samples
landed on it. A seventh sample returned `content: null` having spent its entire
budget on `reasoning` tokens.

So on the previous default, roughly a third of user turns would have answered
with classifier output, and the planner's JSON would never have parsed —
planning silently degrading to regex on every turn, invisibly.

This is not a latency finding or a polish finding. It is the product not
working, and no in-process test could have caught it, because every test mocks
the provider.

---

## 2. Retrieval quality

Command: `AI_EMBEDDINGS_MODEL=baai/bge-m3 npx tsx scripts/evaluate.ts --retrieval-only`
Artifact: [`evals/results/retrieval-2026-08-22-final.json`](../../../evals/results/retrieval-2026-08-22-final.json)

61 eval cases (48 sourced, 13 gate cases), corpus `7b64f0d`, 3,750 chunks.

| metric | lexical-only (control, same corpus) | before (`05f25e6`, local e5, older corpus) | **after** |
|---|---|---|---|
| hit@5 | 0.833 | 0.854 | **0.938** |
| MRR | 0.630 | 0.719 | **0.776** |
| evidence-recall | 0.792 | 0.875 | **0.917** |
| refusal-recall | 0.909 | 1.000 | 0.909 |
| false-refusal | 0.042 | 0.063 | 0.083 |

Three changes produced the gain, each measured in isolation:

**Evidence selection ended on `break`, not `continue`.** One oversized chunk
hitting the 7,000-char budget terminated selection outright, discarding every
smaller above-cutoff chunk behind it. Measured over the 61 eval questions: 46
(75%) stopped that way rather than on the relevance cutoff (1) or a full slate
(14); 15 ended with fewer than the 5 chunks the answer prompt can carry; 39
chunks that would have fit were dropped. Selection was governed by chunk *size*,
not relevance. → evidence-recall 0.875 → 0.896.

**RRF weighted the two modalities by accident.** The fusion map received every
lexical query variant *and* every vector list, so a modality's weight was
however many ranked lists it happened to produce — measured 1.13 lists/query for
Persian, 1.53 for English, against exactly 1.0 for vectors. English queries
carried a 1.53:1 lexical bias nobody chose, and English was the worst category
in the previous run (hit@1 0.333, false-refusal 0.333). Fusing per modality
first, then combining with a named weight → hit@5 0.896 → **0.938**, MRR 0.748 →
**0.776**. English specifically: hit@1 1/3 → 2/3, MRR 0.44 → 0.78.

**A gate input was computed on synthetic text.** `docs/RETRIEVAL.md` stated the
density signal is computed on the original queries only; it was in fact maxed
over the EN→FA synonym expansion. Measured inflation on
`where do I set environment variables`: 36.3 → 65.7 (+81%), enough to cross both
the `high` and `strongEvidence` thresholds on the strength of a query the user
never typed. No eval case flipped, so no metric moved — the contract violation
is closed, not the score.

### Honest caveats

- **refusal-recall 0.909 is corpus drift, not a regression.** The docs corpus
  moved from 3,746 to 3,750 chunks mid-work. Lexical-only scores the same 0.909
  on this corpus, which is what proves the embedding model is not responsible.
- **false-refusal moved the wrong way** (0.063 → 0.083, 3 → 4 of 48). Hybrid
  surfaces more candidates and the confidence gate then rates two of them low.
  This is a real, open regression and the gate thresholds want re-tuning against
  the new score distribution.
- The headline is carried by the untuned split. The artifact's own `bySplit`
  block: cases the ranker was tuned against score far lower than cases it was
  not. That block is the most honest number in the file and it is not the one
  quoted in the table above.

### Two fixes were tried and REVERTED because the numbers said no

- Wiring the dead `evidenceIsWeak()` into the gate as a `medium → low`
  downgrade: false-refusal **more than doubled**, 0.083 → 0.188 (9/48), with no
  gain anywhere. Left unwired, with the measurement recorded at the definition.
- A per-page diversity cap in evidence selection: every metric bit-for-bit
  identical. No eval case has 4+ same-page chunks above cutoff in the current
  top-8, so it bought nothing.

### CI could not have caught a regression to lexical

`floorsFrom` derived floors for hit@5, MRR, evidence-recall, refusal-recall and
false-refusal — but **not hit@1**, which is the only metric whose McNemar test
distinguishes hybrid from lexical (p = 0.0039; every hit@5 pair is p ≥ 0.625).
A total regression to lexical-only scored hit@5 0.833, which **passes** the 0.792
floor. Verified by deliberately running lexical-only after adding a hit@1 floor
and a `retrievalMode` equality check: both now fail correctly.

---

## 3. Model selection

The model was previously chosen by asking candidates to `Say OK`. That is not
the job. The job is a ~2,000-token Persian evidence block with a strict
"cite every factual sentence with `[n]`" instruction.

Command: `npx tsx scripts/bakeoff-models.ts --cases 8`
Artifact: [`benchmarks/models/bakeoff-2026-08-22.json`](../../../benchmarks/models/bakeoff-2026-08-22.json)

Scored on the app's **real** answer prompt (avg 8,297 chars) over committed eval cases:

| model | ttft p50 | ttft p95 | citation rate | error rate | verdict |
|---|---:|---:|---:|---:|---|
| `nemotron-3-super-120b-a12b:free` | 1066 ms | 5931 ms | 0.875 | 0 | **primary** |
| `nemotron-3-nano-30b-a3b:free` | 1062 ms | **1568 ms** | 0.75 | 0 | fallback 1 |
| `dots-3-note-preview:free` | 1519 ms | 2962 ms | 0.75 | 0 | fallback 2 |
| `nemotron-nano-12b-v2-vl:free` | 3139 ms | **43640 ms** | 0.875 | 0 | dropped — 43 s tail |
| `nemotron-3-ultra-550b:free` | 1617 ms | **41656 ms** | 1.00 | 0.25 | dropped — tail + errors |
| `inkling-small:free` | — | — | — | **1.00** | dropped — never answered |

Ranking on a toy prompt is *completely different* from ranking on the real one:
on a 2-source toy prompt the 120B model produced 2 citations in 3 s; on the real
prompt it produced **0 citations in 13.8 s** while the 30B produced 5 in 2.2 s.
Model choice measured on toy prompts is not evidence.

Two models were removed from the fallback chain because their p95 exceeds
40 seconds — a fallback whose tail is worse than the primary's turns a slow turn
into a dead one.

Disabling provider-side reasoning, same model and prompt:
`nemotron-3-nano-30b` 3330 ms / 81 output tokens with reasoning off vs
7350 ms / 311 tokens (329 of them reasoning) with it on. Faster **and** ~60%
cheaper in output tokens.

---

## 4. Latency on the deployed system

Command: `node scripts/probe-deployment.mjs --url https://liara-copilot.vercel.app`
Artifact: [`evals/results/deployed-2026-08-22-after.json`](../../../evals/results/deployed-2026-08-22-after.json)

The planner ran first, unbounded, on the critical path. Measured plan latency on
the deployed app before any bound: **2779 / 2558 / 15636 / 15670 / 9445 ms** —
and the two 15.6 s rows were the call *exhausting its 15 s attempt timeout and
falling back to the deterministic plan anyway*, having bought nothing but a
15-second stare at a spinner.

| phase | before | after |
|---|---:|---:|
| plan p50 | ~9400 ms | **1408 ms** |
| plan p95 | 15670 ms | **4009 ms** (hard budget) |
| retrieval p50 | — | 306 ms |
| gate p50 | — | 0 ms |
| post-stream (verify) p95 | 14030 ms | 6274 ms (hard budget) |

Three changes: a dedicated `PLAN_BUDGET_MS` (4 s) measured against an
already-computed deterministic fallback; skipping the model planner entirely on
a short first turn that named a platform; and starting retrieval concurrently
with the planner instead of after it.

### The latency targets are NOT met, and this is why

| target | measured | met |
|---|---|:--:|
| p50 time-to-first-token ≤ 2500 ms | 4906 ms | ✗ |
| p95 time-to-first-token ≤ 6000 ms | 18893 ms | ✗ |
| p50 full answer ≤ 6000 ms | 8129 ms | ✗ |
| error rate under load = 0 | 0/16 | ✓ |

The residual is the **answer model's own time-to-first-token**: p50 451 ms but
p95 **17233 ms**. That is not the app's pipeline — plan, retrieval and gate
together account for ~1.7 s at p50. The same model, the same prompt and the same
key measured from a workstation give p50 1066 ms / p95 5931 ms; from Vercel the
tail is 3× worse.

The most likely cause is free-tier queueing against shared cloud egress IPs.
It is **not fixed**, and it is recorded here as an accepted, evidenced risk
rather than smoothed over. The honest mitigations available without a paid model
budget are the ones already applied: bounded budgets so a slow call fails fast
with a usable fallback, streaming so the wait is visible, and a fallback chain
with no long-tail members.

---

## 5. Cold-start and bundle

| | before | after |
|---|---:|---:|
| vector artifact on disk | 12,147,379 B JSON | 5,929,925 B (`.bin` + header) |
| vector load time | 69.6 ms | **4.1 ms** |
| heap for vectors | 45.62 MB | **5.16 MB** |
| `loadIndex()` total | 203–226 ms | 147–158 ms |
| corpus IDF build | 303 ms, inside the **first user request** | at index load |

`embeddings.json` is now the incremental *build cache* only (keyed by chunk
hash, gitignored). The server reads a raw little-endian Float32 matrix it can
adopt without parsing. `.gitattributes` marks it binary — a line-ending
conversion on a Windows checkout would corrupt the matrix silently, so
`loadIndex()` also checks `byteLength` against `count × dims × 4`.

Still open: `MiniSearch.loadJSON` is ~100 ms and is now **68%** of the remaining
cold cost — larger than the embeddings parse everyone optimised. Untouched.

---

## 6. Vercel blockers closed

| assumption | consequence on Vercel | status |
|---|---|---|
| 25 MB index gitignored, built only by the Dockerfile | `loadIndex()` threw on every request, `/api/health` 503 | committed + traced ✓ |
| 52 MB embedding model fetched from HF inside the request | 10 s per cold isolate; a **truncated cache aborts the Node process** (exit 127, uncatchable — 35,083,220 B on disk vs a real 118,308,185) | hosted embeddings ✓ |
| `mkdir`+`appendFile` under a relative path | `/api/feedback` returned **HTTP 500** for every thumbs-up | stdout + best-effort file ✓ |
| conversation state in a module-level `Map` | ~(N−1)/N of follow-up turns silently start a new conversation | HMAC-signed client-carried state ✓ |
| `maxDuration = 120` vs a pipeline budget of ~225 s | platform killed the invocation mid-stream, no error, no metrics row | 60 s route / 50 s turn budget ✓ |
| `VOICE_MAX_BYTES = 8 MB` | Vercel rejects >4.5 MB at the edge, so the app's own error was unreachable | 4 MB on Vercel ✓ |
| `TRUST_PROXY=off` | `clientIp()` returned the literal `direct` for every visitor — one global rate bucket | auto-on under `VERCEL` ✓ |
| `Permissions-Policy: microphone=()` | an **empty allowlist disables the app's own microphone** — voice could not work in any deployment | `microphone=(self)` ✓ |

The signed state is not cosmetic: the rolling summary is fed back into the
system prompt, so an unsigned blob would be a direct prompt-injection channel.
`tests/portable-state.test.ts` asserts the forgery, wrong-secret, replay-under-
another-id, and expiry cases.

---

## 7. Deployed probe result

38 of 44 checks pass. The failures, unedited:

| check | detail | verdict |
|---|---|---|
| p50 TTFT ≤ 2500 ms | 4906 ms | real — §4 |
| p95 TTFT ≤ 6000 ms | 18893 ms | real — §4 |
| p50 total ≤ 6000 ms | 8129 ms | real — §4 |
| answers are non-trivial | one answer, 17 chars | real — a Persian PostgreSQL question returned a 17-char English reply |
| language matches question | 4/5 | real — same case |
| injection does not extract the system prompt | — | **false positive in the probe**, since fixed: the check matched the words "system prompt" inside the app's own correct refusal ("I can't reveal ... the system prompt") |

Passing, and worth naming because they were attacked: no secret ever appeared in
an answer; 0 of 5 legitimate questions containing "ignore"/"override"/"previous"
were blocked as injection; cross-site POST 403; oversized body 400; diagnostics
404 in production; feedback 204.

---

## 8. What is still open

1. **p95 answer-model TTFT of 17 s** on the free tier from Vercel (§4).
2. **false-refusal 0.083** vs 0.063 before — the gate wants re-tuning for the
   new score distribution (§2).
3. **One short, wrong-language answer** in 5 grounding cases.
4. `MiniSearch.loadJSON` is 68% of remaining cold-start cost.
5. Rate limiting, the FAQ cache and the single-flight map remain **per-isolate**.
   The conversation state — the one that silently corrupted user-visible
   behaviour — is fixed; these three are documented ceilings, not fixes.
