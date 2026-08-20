# Round 1 — summary & remediation plan

**Commit judged:** `67caf52` · **Judges:** 12 parallel specialists + main-engineer visual review.
**Findings:** 0 P0 · **7 P1** · 30 P2 · 27 P3 (+ ME-001 P1, UX-001/002 from visual review).

## Scores (this round, honest, adversarial)

| Criterion | Area score | Full-challenge points |
|---|---|---|
| Answer quality/correctness (80) | 68–72/100 | ~55–58/80 |
| UI/UX (55) | 47/55 (visual) · enduser 42/55 | ~44/55 |
| Agentic/personalization (50) | 60/100 · troubleshooting 66/100 | ~30–33/50 |
| Security/reliability/monitoring (50) | sec 82 · rel 84 · obs 76 | ~41/50 |
| Deployment on Liara (40) | readiness 76/100 | 31/40 (deploy itself PENDING) |
| Cost (25) | 76/100 | ~19/25 |
| **Competition aggregate** | — | **~191/300** (deployment PENDING) |

**Current-Phase Quality (in-scope, 0–100): ~72.** Lowest critical area: **Agentic (~62%)** and **Answer-quality gate precision**.

## Root-cause clusters (fix the class, not the symptom)

### RC1 — Retrieval quality (Answer 80) — biggest lever
- **RAG-002 (P1):** evidence fills with near-duplicate chunks — `## اتصال به مدل` copied byte-identical across anthropic/deepseek/meta-llama provider pages; 8 slots, 2 unique texts. → **dedup evidence by text hash.**
- **CORR-001 / RAG-001 (P1):** gate fires `high` on the WRONG page — "install the CLI" → high but `/references/cli/install` absent from top-5; coverage saturates on corpus-ubiquitous tokens. Cached as high. → **`high` requires the top chunk's title/heading (not body) to carry a query token.**
- **RAG-003 / ME-001 (P1):** Persian synonym gap — وصل/متصل vs اتصال don't exact-match → 3 of 4 landing chips refuse. → **light Persian synonym/stem layer at index+query time.**
- **CORR-002/004, ENDUSER-002, COMP-003 (P2):** hit@1 33%; framework how-tos & `/about` hubs outrank canonical `/details/…`, `/quick-start`. → **reference/quick-start boost + down-rank related-apps/about hubs for platform-less queries.**
- **COMP-002 / UX-002 (P2):** low-gate refusal still attaches 3 unrelated citations. → **drop citations on refusal (or relabel "maybe related").**

### RC2 — Agentic state (Agentic 50)
- **AG-001 / TR-001 (P2):** negation ignored — "it is NOT Next.js" still sets platform=nextjs; poisons filters. → **negation detection in preClassify.**
- **AG-002 (P2):** `knownError` never cleared — persists into unrelated topics. → **clear stale error/context on topic change.**
- **TR-001 (P2):** `ERROR_RE` misses Persian error phrasings (صادر نشد، بالا نمیاد، پر شده، تعریف نشده). → **broaden the error regex.**
- **ENDUSER-001 / TR-003 / COMP-001 (P1/P2):** keyless `fallbackPlan` never builds troubleshooting/workflow state → Fix/Guide are invisible without a key (and judges run keyless). → **deterministically seed hypotheses/steps in fallbackPlan.**
- **AG-003 / TR-006 / ARCH-003 (P3):** `s.workflow = s.workflow` no-op. → **delete.**

### RC3 — Observability & cost token accounting
- **OBS-001 / COST-001 (P1/P2):** answer-call input tokens hardcoded 0 → token + cost metrics blind. → **account real input tokens (provider usage or prompt-length estimate).**
- **OBS-002 (P2):** raw client IP logged (PII). → **hash/drop it.**
- **OBS-003 (P2):** raw user question retained in dev diag ring. → **cap; dev-only already.**

### RC4 — Security / dependencies
- **SEC-004 (P2):** 3 high-severity advisories (postcss, sharp). → **`npm audit fix` / bump.**
- **SEC-001 (P2):** XFF value unvalidated as rate key. → **validate/normalize; combine with OBS-002.**

### RC5 — Deployment readiness (40)
- **DEPLOY-001 (P1):** Dockerfile `COPY … /public` but no `public/` exists → **docker build fails.** → **add `public/`.**
- **DEPLOY-004 (P3):** standalone `server.js` nested under OneDrive path (no `outputFileTracingRoot`). → **set it.**
- **DEPLOY-005 / REL-005 (P3):** `/api/health` 200 even when index failed. → **503 when index missing (keyless stays 200).**

### RC6 — Docs accuracy
- **COMP-005 (P3):** README "81 tests" (actual 133), stale hit@5. **COMP-004:** EVALUATION accepted-debt cases stale. → **sync docs.**

## Rejected / accepted-as-designed (documented, not fixed)
- **SEC-003 (CSP unsafe-inline):** Next.js hydration needs inline scripts without a nonce middleware; no HTML sink exists (no `dangerouslySetInnerHTML`, react-markdown escapes). Adding nonce infra is disproportionate for a backstop. **Accepted.**
- **ARCH-002 (LiaraProvider unused):** deliberate Phase-2 seam (DECISIONS D10). **Kept.**
- **CORR-005 / RAG eval labels:** partly valid — will add alternate acceptable pages rather than loosen the floor.

## Remediation order (correctness → security → broken flows → agent → reliability → retrieval → UX → cost → docs)
Batch 1 retrieval (RC1) · Batch 2 agentic (RC2) · Batch 3 obs/cost/sec (RC3/RC4) · Batch 4 deploy (RC5) · Batch 5 docs (RC6). Test after each; new regression tests/eval cases for every P1/P2 that can be automated.
