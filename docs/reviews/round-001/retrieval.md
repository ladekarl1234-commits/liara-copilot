# Retrieval Judge — Round 001

Owned criterion: **Answer quality / correctness 80 (RAG)**. Environment: keyless
degraded mode (aiConfigured:false, embeddedCount:0 → **pure lexical**, no vectors).
All findings below are reproduced against the built index (3746 chunks,
lexicalVersion 2) and the shipped eval harness.

## Score: 58 / 80

| Subcriterion | Assessment |
|---|---|
| Retrieval precision (hit@1) | **Weak** — 33% hit@1, MRR 0.495 (eval, 39 sourced cases). Top chunk (drives fast-model answer + primary citation) is right only 1/3 of the time. |
| Retrieval recall (hit@5) | Adequate — 71% hit@5, but ai-api 0%, object-storage/mixed 50%, canonical pages lose to how-to pages. |
| Evidence-gate calibration | **Defect** — 'high' confidence fires on a top-6 retrieval MISS (RAG-001); routes to cheap model + caches answer. |
| Evidence quality/dedup | **Defect** — 8-chunk budget filled with 6/8 byte-identical duplicates (RAG-002); 491 dup chunks in index. |
| Persian lexical coverage | **Gap** — synonym وصل vs اتصال unbridged: colloquial phrasing → 'low' refusal (RAG-003). |
| Citation deep-linking | Anchor coverage 36.6% — 63% of citations lack section anchors (RAG-005). |

## Findings

### RAG-001 (P1) Gate returns 'high' on a top-6 retrieval miss → cheap model + cached wrong answer
Query "How do I install the Liara CLI?" → confidence **high**
(coverage 1, scorePerToken 78, margin 1.094), but the canonical page
`/references/cli/install` (present in index, 2 chunks) is **not in the top 6**;
results are create-liara-json / create-app pages. `informativeTokens` drops
"liara" (stopword), leaving install+cli, both of which appear verbatim in the
wrong pages → coverage=1. `pickAnswerRoute` (router.ts:15) sends 'high' to the
FAST model, and orchestrator.ts:193 **caches** the answer for all future
identical questions. 1 of 3 'high' verdicts in the full eval is a retrieval miss.

### RAG-002 (P1) Evidence budget consumed by byte-identical duplicate chunks (no text dedup)
Query "اتصال به مدل با OpenAI SDK چطور است" → 8 selected chunks, **only 2 unique
texts**; chunks 4-8 are byte-identical "## اتصال به مدل" copies from 5 different
model pages. Index has 491 duplicate chunks / 136 cross-URL dup groups (one text
appears on 16 URLs). Evidence selection (index.ts:184-190) dedups nothing; the
model receives ~2 facts padded to 8 redundant citations, crowding out
complementary evidence and the char budget.

### RAG-003 (P2) Persian synonym gap: وصل vs اتصال
"چطور دیتابیس رو وصل کنم" → confidence **low** (would refuse), top result an
unrelated CLI page. Same intent as "اتصال به دیتابیس" → **medium** + correct
`/dbaas/details/connection-links`. EN_FA bridges English connect→اتصال but no
Persian-internal synonym normalization; colloquial Persian phrasing is penalized.

### RAG-004 (P2) Overall retrieval precision is mediocre for an answer-quality criterion
Full eval: hit@1 33%, hit@3 67%, hit@5 71%, MRR 0.495. Zero-hit categories:
ai-api (0% hit@5). Canonical/quick-start pages routinely lose to how-to pages:
cli-install, health-check-liara-json, wordpress-one-click, discover-analytics
(matomo), nextjs-create-next-app-only all miss top-5. Root cause: BM25 term
frequency over a Persian corpus favors repetitive how-to pages; no exact
page-title / identifier boost toward the canonical reference page.

### RAG-005 (P2) Deep-link anchor coverage only 36.6%
meta.anchorCoverage 0.366 — 63% of citations link to the page, not the section.
Root cause (ingest.ts:96-107): anchors are recovered only when the sibling MDX
`<Section title>` (normalized) exactly equals the llms.md h2/h3 heading and the
MDX file exists; any wording drift drops the anchor silently.

### RAG-006 (informational) Vector path is dead weight in this deployment
embeddedCount:0 → `idx.vectors` null, `deps.embedQuery` unused. "RRF fusion" is
fusing a single lexical list (RRF over one ranker = identity re-rank). Not wrong,
but the fusion/vector complexity buys nothing here and should be labeled as such.

## Reasoning
The pipeline is competently built (shared normalize/tokenize, structural
chunking, char-bounded evidence, a gate with a real eval floor). The defects are
where the reasoning skipped a step: (1) the gate's own comment argues "the answer
model is the real defense" for false positives — but 'high' confidence
specifically *downgrades* to the fast model and *caches*, so the defense is
weakest exactly when the gate is most wrong (RAG-001); (2) citations are deduped
by URL but evidence is never deduped by text, so a corpus with 13% duplicate
chunks poisons the evidence budget (RAG-002). Model-written prose could not be
tested (no key); RAG-001's cache-poisoning *consequence* is theoretical-with-key,
but the gate misfire and cheap-model routing are structural and reproduced above.
