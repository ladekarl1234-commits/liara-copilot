# Round 3 Final — Correctness / Answer Quality (80)

Commit 77eb3ff. Verified live: eval reproduced hit@1 0.44, hit@3 0.75, **hit@5 0.813**, MRR 0.595, **gate 0.923 (12/13)** — matches claims. Floors (hit@5>=0.66, gate>=0.75) hold. Build/index v3, 3746 chunks.

Pipeline is sound: low gate -> canned refusal; medium/high -> grounded answer + `verifyAnswer` grounding check. High gate verified trustworthy (3/3 top chunks reasonable, incl. exact-command "liara deploy --platform" -> /references/cli/deploy-app at high). Prose quality needs a key (theoretical).

**No new P0/P1.** Residual is pre-existing, bounded, already priced into the ~70/100 area score.

## Findings

### CORR-R3-01 (P2) — medium/high answers grounded on wrong page; verify checks grounding, not relevance
- 6 of 48 sourced eval cases (12.5%) gate medium/high yet NONE of the expected canonical page is in top-5: object-storage/bucket-keys, english-postgres-public-access, mixed-deploy-port-flag, ai-openai-connect, build-fail-iran-packages, how-to/health-check-liara-json.
- e.g. "connect to my PostgreSQL from my laptop (public access)" retrieves connect-via-platform/{python,nodejs} (in-app connection), not /quick-setup (enable public network). The answer model, obeying "only from evidence", produces a *grounded* answer to a *different* question. `verifyAnswer` (verify.ts) checks claim⊆evidence, NOT evidence-answers-question — so it passes a confidently-irrelevant answer.
- Confidence: high (measured). Direction: relevance/answerability signal, or lower gate when top page's title carries no query token (extend the existing topTitleMatch idea to medium).

### CORR-R3-02 (P2) — unsupported-topic refusal is phrasing-fragile
- Eval's unsupported-gpu gates low (refused). My rephrase "قیمت پلن GPU برای دیتابیس چنده؟" gates **medium** (coverage 0.4) and returns change-plan/hardware-plans pages. Co-mentioning a supported token ("دیتابیس"/"پلن") lifts a genuinely unsupported topic (GPU) to answerable. Documented "shares one Liara word" limitation, but concretely demonstrated: unsupported refusal depends on phrasing, not topic.
- Confidence: high (measured live). Direction: negative-vocabulary list for known-absent features (GPU/k8s/SMS/refund) or a not-offered check.

### CORR-R3-03 (P3) — weak canonical ranking for English & object-storage/AI queries
- Per-category hit@5: english 33% (n=3), ai-api 50%, mixed 50%, object-storage 50%, service-discovery 50%. MRR 0.595 overall. connect-via-platform/{lang} pages systematically outrank quick-setup/create-key for concept queries. Low n but consistent pattern.
- Confidence: high. Direction: down-rank connect-via-platform/* for non-platform-named queries the way related-links/about are.

### CORR-R3-04 (P3, theoretical) — dedup bodyKey is first 400 normalized chars
- retrieval/index.ts:234 dedups on `normalizeFa(text).slice(0,400)`. Two distinct chunks sharing a long common intro (shared boilerplate then divergent specifics) collide; the second (possibly the relevant one) is dropped as a duplicate. Not observed in eval; theoretical.
- Direction: hash full normalized body, or use chunk.hash if bodies are already deduped at build.

## Honest sub-score
Answer-quality area: **71/100** (full-challenge ~57/80). Solid grounded-RAG architecture with three real defenses; capped below 80 by (a) 12.5% medium/high answers grounded on the wrong page with no relevance gate, (b) phrasing-fragile unsupported refusal, (c) English/object-storage ranking. wouldDeduct = true (P2s remain). Prose quality unverifiable keyless (theoretical).
