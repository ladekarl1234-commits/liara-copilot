# Pre-remediation artifacts (audit trail)

These are the **exact measurement artifacts the 15-agent expert panel read** when
it produced [`EXPERT-PANEL-2026-08.md`](../EXPERT-PANEL-2026-08.md). They are kept
so every "before" number in that review — and in
[`EXPERT-PANEL-STATUS.md`](../EXPERT-PANEL-STATUS.md) — can still be checked
against its source after remediation changed the live numbers.

| File | What it pins |
|---|---|
| `retrieval-2026-08-20.json` | the pre-fix retrieval eval: hit@1 0.4375, hit@5 0.8125, MRR 0.592, false-refusal 6.3% (measured post-evidence-selection, the definition `EP-DATA-05` corrected) |
| `modes-2026-08-20.json` | the pre-fix mode comparison, run at `RRF_K = 60` before `EP-RET-01` |

They live **here rather than in `evals/results/`** on purpose: that directory now
carries a machine-checked invariant (`tests/evals-harness.test.ts`) that every
artifact stamps `runId`, commit, index provenance and metric definitions —
introduced by `EP-DATA-04`. These predate that format, and loosening the check to
accommodate them would have destroyed the very guarantee the panel asked for.
Historical evidence is archived; the live directory stays strictly well-formed.
