# Retrieval

## Source

`public/llms/**/*.md` inside the cloned `liara-cloud/docs` repo
(`scripts/sync-docs.mjs` clones/pulls into `DOCS_DIR`, default
`data/liara-docs`). 1,142 generated Persian markdown files. Line 1 of every
file is `Original link: https://docs.liara.ir/<path>/` — the deterministic
citation source (`src/lib/docs/ingest.ts:parseLlmsFile`). Each file ends with
a boilerplate `## all links` section, stripped on ingest. Files without an
`Original link:` header are skipped and counted in `IngestStats.skipped`.
See `docs/DECISIONS.md` D1 for why this source was chosen over scraping the
live site.

## Ingestion & structural chunking (`src/lib/docs/ingest.ts`)

- **Product/platform metadata from the path**: first path segment is
  `product` (`paas`, `dbaas`, `ai`, `iaas`, `dns-management-system`,
  `email-server`, `object-storage`, `one-click-apps`, `overview`,
  `references`); for `paas`/`dbaas`/`one-click-apps`, the second segment is
  `platform` when it's a recognized PaaS runtime (`nextjs`, `django`, `docker`,
  `dotnet`, `flask`, `go`, `laravel`, `nodejs`, `php`, `python`, `react`,
  `static`, `vue`).
- **Structural chunking**: split at `##`/`###` heading boundaries; code
  fences (` ``` `) are tracked so a heading regex never matches inside one,
  and a fenced code block is never split away from the paragraph before it —
  the paragraph-boundary splitter (`splitLong`) only cuts on a blank line
  *outside* an open fence.
- **Size**: target 1,600 chars, hard cap 2,200 (with a 1.5× safety valve at
  3,300 to guarantee termination on pathological input).
- **Heading breadcrumbs**: each chunk carries `headingPath` — `[title]`, or
  `[title, h2]` for an h3 chunk, or `[title, heading]` for an h2 chunk.
- **Content typing**: `text | procedure | code | mixed`, classified by fence
  count and code-character ratio (`classify()`).
- **Stable IDs and hashes**: `id = sourcePath#chunkIndex`;
  `hash = sha256(url|anchor|text).slice(0,16)` — the incremental-indexing key
  (FR2): unchanged text ⇒ unchanged hash ⇒ no re-embedding.

## MDX anchor recovery (`loadAnchors`, D3)

Anchors on docs.liara.ir are authored ids (`<Section id="..."
title="...">` in the sibling `src/pages/**/*.mdx`), not slugified headings —
the generated `.md` files don't carry them. `loadAnchors()` parses the
sibling MDX, matches `normalizeFa(title)` → `id`, and `chunkMarkdown()`
attaches the anchor to any chunk whose heading text matches. When no MDX
sibling exists, or the heading has no authored id, the chunk cites the page
URL without an anchor. Measured coverage from the last build
(`data/index/meta.json`): **36.6%** of chunks carry a deep anchor (1,370 of
3,746, from 1,142 source files).

## Persian normalization + tokenization (`src/lib/text/persian.ts`)

`normalizeFa()` — applied identically to index text and every query, so they
can never drift:

- ي/ئ → ی, ك → ک, ة → ه, أ/إ/ٱ → ا, ؤ → و
- strips diacritics/tatweel (`[ً-ٰٟـ]`)
- Arabic-Indic and Persian digits → ASCII (`٥`/`۵` → `5`)
- lowercases Latin

`tokenizeFa()` — technical-token splitting: a token like `next.js` or
`DATABASE_URL` or `پیش‌فرض` (ZWNJ) emits both its **joined** form (`nextjs`,
`databaseurl`) and its **parts** (`next`, `js`, `database`, `url`) when a
part is longer than one character, so a user typing either form matches. Used
both to build the MiniSearch index and to score query-term coverage for the
evidence gate.

`detectLanguage()` — Persian if Persian-script character count is at least
half the Latin count and non-zero; else English. `normalizedKey()` — the
tokenized, space-joined key used for the FAQ answer cache and the
documentation-gap log, so cosmetically different spellings of the same
question collapse to one key.

## Lexical index (MiniSearch)

`miniOptions()` (`src/lib/retrieval/index.ts`): fields `title`, `heading`,
`text`; `tokenize: tokenizeFa`; `processTerm` is a no-op (normalization
already happened in the tokenizer, not a second time). `LEXICAL_VERSION = 2`
is stamped into `meta.json` at build time and checked at load time — an index
built with an older tokenizer/options shape throws `IndexMissingError`
instead of silently mis-scoring. Search-time options: `boost: {title: 3,
heading: 2}`, `fuzzy: 0.15`, `prefix: true`.

## Optional embeddings + incremental hash cache

Vector search is off unless `AI_EMBEDDINGS_MODEL` and a configured provider
are set (D8: lexical-first, hybrid only when explicitly enabled).
`scripts/build-index.ts` embeds only chunks whose `hash` isn't already in
`data/index/embeddings.json` (loaded from the previous build if the model
name matches), batches of 64, and prunes vectors for hashes no longer present
in the corpus. Vectors are L2-normalized at build time so query-time
similarity is a plain dot product (`vectorTopK` in `src/lib/retrieval/index.ts`).
**As shipped, `embeddedCount: 0`** — the committed index and eval were built
without an embeddings model configured; hybrid retrieval is implemented but
unmeasured (see `docs/EVALUATION.md`).

## EN→FA bounded query expansion (`expandQueries`)

A small hand-built dictionary (~30 entries: `deploy`→`استقرار`,
`environment`/`env`→`متغیر محیطی`, `database`→`دیتابیس`, etc.) adds **one**
extra query per input query containing the Persian translations plus any
kept technical identifiers (`keepTechTerms` — Latin tokens ≥3 chars that
aren't in the dictionary or an English stop-word list, e.g. `Next.js`,
`DATABASE_URL`), capped at 5 total queries. This is how an English question
still reaches the Persian-dominant corpus without a model call.

## RRF fusion + deterministic boosts

Every expanded lexical query list, and every vector-search list (when
enabled), contributes ranks combined by Reciprocal Rank Fusion
(`RRF_K = 60`, `score += 1/(60+rank)`), up to 40 candidates per query. Fused
scores then get deterministic multiplicative boosts:

| Boost | Factor | When |
|---|---|---|
| Platform filter match | ×1.25 | `filters.platform` set and chunk matches |
| Product filter match | ×1.10 | `filters.product` set and chunk matches |
| Platform named in query text | ×1.20 | chunk's platform token appears in the query itself |
| Heading/title overlap | ×(1 + min(0.2, 0.05·overlap)) | query tokens present in chunk title/heading |
| Related-links page | ×0.60 | `sourcePath` ends `related-links.md` — link-hub pages cite everything, answer nothing |

**Filter fallback**: if a metadata filter leaves fewer than 5 lexical results
(the plan's guessed product/platform was wrong, or the evidence lives
cross-product), the unfiltered result list is concatenated in — filters bias
ranking, they don't hard-exclude.

## Evidence selection budget

`MAX_EVIDENCE_CHUNKS = 8`, `MAX_EVIDENCE_CHARS = 7000`. Selection walks the
fused, sorted list and stops at whichever limit hits first, plus a **relative
score cutoff**: any chunk scoring below 35% of the top chunk's score is
excluded even if the budget isn't full — this is what keeps a single strong
match from being padded out with irrelevant filler.

## Gate thresholds (coverage / score-per-token / margin)

`gateConfidence(resultCount, coverage, scorePerToken, margin)`
(`src/lib/retrieval/index.ts`), where `coverage = exactCoverage(...)`:

```
low    : no results, or coverage.ratio < 0.34 (with informative>0)
high   : coverage.ratio >= 0.7 AND coverage.informative >= 2
         AND scorePerToken >= 25 AND margin >= 1.05
medium : everything else (incl. informative == 0 — a pure-stopword
         follow-up, which the planner resolves)
```

- **coverage** (`exactCoverage`) — the fraction of a query's **informative**
  tokens (stopwords removed: fa/en function words + domain-ubiquitous terms
  like *liara*, *app*) that appear **verbatim** in the top-3 selected chunks.
  Computed on the **original** queries only — never the synthetic EN→FA
  expansion, whose short query would otherwise inflate the signal. Fuzzy and
  prefix matches deliberately do **not** count: they are exactly what let an
  off-topic query (a cake recipe) reach `medium` before the round-2 rebuild.
  `informative` is that query's informative-token count (a 1-token match is
  never enough for `high`).
- **scorePerToken** — the top result's raw MiniSearch score ÷ unique
  query-token count (density, not raw magnitude).
- **margin** — top fused score ÷ second fused score.

`low` blocks answering entirely (the orchestrator emits the honest "couldn't
find this" message and records a documentation gap). `high` additionally
routes to the fast model and makes the answer FAQ-cache-eligible —
deliberately the strictest tier. Thresholds were tuned against `evals/cases`
via `npm run evaluate:retrieval`; the runner **fails** (`exit 1`) if hit@5
drops below 0.6 or gate-accuracy below 0.75, and requires
`unsupported`/`adversarial` cases to gate `low` (not merely "not high" — that
earlier definition was satisfied by a gate that never fired). Current gate
accuracy: **7/9**, with the two vocabulary-carrying misses defended
downstream — see `docs/EVALUATION.md` for the full analysis.

> **Round-2 note.** The first gate counted fuzzy/prefix stopword matches and
> thresholded on a corpus-scale-dependent raw BM25 score; adversarial review
> proved it returned `medium` for every input on the real 3,663-chunk index,
> including gibberish. The exact-coverage rebuild above is the fix.

## Citation mapping

`citationUrl(chunk)` (`src/lib/retrieval/index.ts`): appends `#anchor` with a
guaranteed trailing slash before it when the chunk has one; returns the bare
page URL otherwise. The orchestrator maps only the `[n]` reference numbers
the model actually used in its answer text back to citations
(`citationsFromAnswer`); if the model cited nothing explicitly, the top 3
evidence chunks are shown as a fallback. Citations are deduplicated by URL.
