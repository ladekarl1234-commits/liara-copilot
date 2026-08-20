# Competition Judge — Round 001 (holistic / all 300)

Commit 67caf52. Environment: aiConfigured:false (degraded keyless), server at :3000,
index built (3746 chunks). Live model prose NOT testable — marked theoretical.

## Score (reluctant, evidence-based)

| Criterion | Max | Awarded | % | Note |
|---|---|---|---|---|
| Answer quality/correctness | 80 | 48 | 60% | lexical hit@5 0.708, hit@1 33%; degraded top-source wrong (AC1); answer prose unmeasured |
| UI/UX | 55 | 36 | 65% | RTL/design solid on paper; refusal shows junk citations |
| Agentic/personalization | 50 | 28 | 56% | ALL agentic paths model-gated; absent in the only testable mode |
| Security/reliability/monitoring | 50 | 38 | 76% | rate limit + body cap + fence sanitize work; injection probe gates medium not low; route depth to security-reviewer |
| Deployment on Liara | 40 | 22 | PENDING | prepared, not executed (by design this phase) |
| Cost | 25 | 19 | 76% | ≤2 calls, routing, FAQ cache, 0-call keyless — sound architecture |
| **Total** | **300** | **~191** | | deployment PENDING; lowest = agentic 56% |

## Why it does / doesn't win
Grounded, honest, well-documented; the gate + Persian normalization + EN→FA are real.
BUT the two headline quality levers — hybrid/vector retrieval and answer quality —
are BOTH unmeasured. On evidence, the tested product is a 0.71-hit@5 lexical doc
search plus a refusal gate. Everything that would beat plain doc search (model
answers, clarify/fix/guide, personalization) is model-gated and unverifiable here.

## Single most important fix to win
Configure a key and MEASURE: run the answers-mode eval and the hybrid retrieval eval,
and lift hit@1/precision so the #1 grounded source is correct — because the 80-point
answer-quality criterion currently has zero evidence above a 0.71 lexical lower bound.

## Findings — see structured output (COMP-001..006).
