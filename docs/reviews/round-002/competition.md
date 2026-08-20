# Round 2 — Competition Judge (Holistic 300)

Commit judged: `1c35583` (WORKING TREE DIRTY — see COMP-DIRTY). Keyless mode (aiConfigured:false), 3746-chunk v3 index, live server localhost:3000. Model prose not testable → prose marked theoretical.

## Verified evidence
- `npx tsx scripts/evaluate.ts --retrieval-only` → hit@5 **0.792**, MRR 0.575, gate 0.923 (matches README). BUT hit@1 **0.42**; service-discovery 0% hit@5, english 33%, ai-api/mixed/object-storage 50%.
- `npx vitest run` → 150 passed / 15 files. `npm audit` → 0 vulnerabilities. Both claims hold.
- 4 landing chips all answer in keyless mode (canned "model not configured" + citations + troubleshooting hypotheses for the error chip). Fix-flow state now surfaces (ENDUSER-001 cleared).
- Injection (EN + FA) refused cleanly. Empty/whitespace → 400 invalid_input. XSS payload escaped by React (accepted).

## Findings
- **COMP-201 P2 (Answer 80):** Negation drops the affirmed alternate platform. "پلتفرم من Next.js نیست، Django است" → top-2 citations are NextJS quick-start + NextJS websocket; Django is #3. `preClassify` uses `PLATFORM_HINTS.find` (first match only): it negates Next.js, sets platform=undefined, and never detects Django. Filter empty, raw query keeps "Next.js" → negated stack leads results.
- **COMP-202 P2 (Answer 80):** hit@1 0.42 — the FIRST citation (all a keyless user sees) is wrong >half the time. Deploy landing chip "از کجا شروع کنم" → #1 = liara.json mirror-field, then Jekyll/Gridsome, not quick-start/getting-started. Categories service-discovery 0%, english 33%. Advertised 0.79 hit@5 masks weak top-1 and category holes.
- **COMP-203 P3 (Cost 25):** input-token estimate `content.length/4` (orchestrator.ts:200) is English-calibrated; Persian tokenizes at far more tokens/char, so a Persian-primary product still undercounts input tokens (~3-4x) and cost. Fixes 0→nonzero but not accuracy.
- **COMP-204 P3 (Sec/monitoring 50):** IP "hash" is unsalted sha256 truncated to 48 bits (route.ts:55). IPv4 is 32-bit; the whole space is brute-forceable in seconds → reversible pseudonymization, near-zero privacy gain. Route to security-reviewer.
- **COMP-205 P3 (git-hygiene):** running product ≠ judged commit. `src/lib/agent/orchestrator.ts` + `docs/reviews/CONVERGENCE.md` are uncommitted; the tree adds a `fixFramedMessage` Fix-on-low-evidence path not in 1c35583. Certification/commit mismatch.

## Cleared (evidenced)
- Prompt injection: attacked EN+FA "ignore instructions/reveal system prompt" → refused, no leak. Residual: indirect injection via doc content not tested here.
- Dedup/citations on refusal: refusal path attaches no citations (verified insufficient branch). 
- Tests/audit: 150 pass, 0 vulns — real, but "tests pass" ≠ top-1 quality (see COMP-202).
- Health 503, token-nonzero, IP-hash presence: code + metrics confirm the mechanisms exist.

## Score (hostile, deployment PENDING)
| Criterion | Score | % |
|---|---|---|
| Answer quality (80) | 58/80 | 72% |
| UI/UX (55) | 44/55 | 80% |
| Agentic (50) | 34/50 | **68% (lowest)** |
| Security/reliability/monitoring (50) | 42/50 | 84% |
| Deployment (40) | 31/40 (deploy PENDING) | 77% |
| Cost (25) | 19/25 | 76% |
| **Aggregate** | **~228/300** (deployment PENDING) | |

Counts: 0 P0 · 0 P1 · 2 P2 · 3 P3. Lowest criterion: Agentic 68%.

## Would I still deduct? YES.
Single most important thing to win: raise **top-1 / first-citation precision** (COMP-202) — in keyless mode the first citation IS the answer, and it is wrong 58% of the time on the headline landing-chip paths; couple it with negation affirmed-platform capture (COMP-201). Both hit the largest criterion (Answer 80) and Agentic. Do NOT award 300; no P0/P1 but real answer-quality and agentic gaps remain, and deployment is unproven.
