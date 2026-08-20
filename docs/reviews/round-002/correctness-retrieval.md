# Round 2 — Correctness / Retrieval judge (Answer quality 80)

Commit reviewed: 1c35583 (tree). Retrieval mechanisms (synonym fold, niche
down-rank) landed in a6de9e8; reviewed as-is in the running tree.
Re-measured eval: **hit@5 0.792, MRR 0.575, gate 0.923** (held vs round-1).
Round-1 fixes verified holding: evidence dedup, cli-install now #1 on
/references/cli/install and correctly NOT `high` (generic-title exclusion),
landing chips no longer refuse (وصل→اتصال fold works, domain query = medium).

## Findings

### RETR-001 (P2) Niche down-rank hides the correct product on paraphrased queries
`src/lib/retrieval/index.ts:204` applies `score *= 0.55` to every chunk of a
niche product unless the query contains one of a short curated trigger-token
list (`NICHE_PRODUCT_TRIGGERS`, lines 19-26). The SYNONYM_CANON fold does NOT
cover the storage/service paraphrases, so a natural rewording evades the
trigger and buries the right product.

Trace (`search([q],{},{})` on the live v3 index):
- `برای نگهداری فایل‌های آپلودی کاربرانم کدوم سرویس لیارا مناسبه` → top-8 has
  **zero** object-storage chunks; #0 is overview/about.md. object-storage
  triggers are `[باکت,bucket,storage,آبجکت,ذخیره,s3]` — the user wrote
  `نگهداری` (a synonym of ذخیره), so the ×0.55 penalty fires.
- Same query with `ذخیره` substituted → object-storage/about.md at #2-3 and
  dominates the list.

This is the eval case `discover-file-storage` (expects object-storage/about):
scores **hit@5 = 0%**; the whole `service-discovery` category is 0/0/0 hit@1/3/5.
Recommendation-style questions describe a need without the product's keyword,
which is exactly when the down-rank suppresses the answer.

Direction: soften the penalty (e.g. ×0.8, or only apply when a *different*
product is strongly named), or route the trigger list through the same
tokenizer/synonym fold so paraphrases (نگهداری→ذخیره) still reference the product.

### RETR-002 (P2) Dead ZWNJ keys in trigger/synonym lists → product suppressed under its own Persian name
Curated keys containing a ZWNJ can never match `tokenizeFa` output, because the
tokenizer splits on ZWNJ (`TOKEN_RE`/parts split, persian.ts:61,74).
- `NICHE_PRODUCT_TRIGGERS.iaas` has `'وی‌پی‌اس'`; `tokenizeFa('وی‌پی‌اس')` =
  `['وی','پی','اس']`. Trigger never fires. Query
  `وی‌پی‌اس چطور بسازم` → iaas pages down-ranked ×0.55; top hits are
  paas/static-ip, **conf=low**, no iaas answer. The user named the product
  (VPS = iaas) in its natural Persian spelling and got it hidden.
- `dns-management-system` has `'نیم‌سرور'`; `tokenizeFa('نیم‌سرور')` =
  `['نیم','سرور']`. Dead. `نیم‌سرور ... تنظیم کنم` → conf=low, dns pages
  down-ranked; answer resolves to iaas/about.md.
- Same class in `SYNONYM_CANON` (persian.ts:41,45): keys `پایگاهداده` /
  `راهاندازی` only fold the *unnatural* no-ZWNJ spelling; the natural
  `پایگاه‌داده` / `راه‌اندازی` tokenize to parts and never reach the joined
  key, so the intended synonym bridge (راه‌اندازی→ساخت, پایگاه‌داده→دیتابیس) is
  a no-op for how users actually type.

Direction: store trigger/synonym keys post-`tokenizeFa` (i.e. as the split
parts, or without ZWNJ variants), or fold each token before the `.has()` check.

### RETR-003 (P3) Down-rank harm is untested (asymmetric coverage)
`tests/integration-realindex.test.ts:88` only asserts niche products do NOT
over-surface on a general "deploy my project" query (the false-positive
direction). No test asserts a niche product DOES surface when legitimately
requested, and none exercises the ZWNJ trigger spellings — so RETR-001/002
regressions pass CI silently.

## Cleared (attacked, not broken)
- Fold false-match: وصل/متصل/connect→اتصال and database/db→دیتابیس produced
  correct pages (domain-connect, db-setup traces); no cross-topic false match found.
- High-gate/FAQ: generic-title exclusion keeps cli-install at medium on the
  right page; gate-accuracy 0.923, only 3/61 reach high (conservative, no
  observed legit-high wrongly dropped).
- Evidence dedup: seenBodies key dedups the byte-identical `## اتصال به مدل`
  boilerplate; ai-model trace shows distinct headings selected.
