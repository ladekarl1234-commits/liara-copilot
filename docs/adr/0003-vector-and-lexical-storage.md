# ADR 0003 — Index storage: in-process JSON, not a database

**Status:** Accepted (Phase I)

## Context

Both lexical and (optional) vector representations need storage that is fast to
query, cheap to operate, incrementally rebuildable, and trivially deployable in
one container.

## Decision

Persist the built index as **JSON files under `data/index/`** (chunks + metadata
+ MiniSearch document store + optional vectors) with a `meta.json` recording
`docsCommit`, `chunkCount`, `fileCount`, `builtAt`, `lexicalVersion`,
`embeddedCount`. Load once into memory at process start. Incremental builds key
on per-chunk content hashes; embeddings (when enabled) are cached by chunk-hash +
model so unchanged docs are never re-embedded.

## Alternatives considered

- **PostgreSQL + pgvector.** Durable and scalable, but adds a required service,
  connection management, and a migration surface for a corpus that fits in
  memory. No measured retrieval gain over the in-process index here.
- **MeiliSearch** (used by the upstream docs repo). Strong lexical engine, but a
  second process to run/deploy and tune; the amendment explicitly says existing
  infra is evidence, not a mandate.
- **Qdrant / dedicated vector DB.** Only justified once vectors are the primary
  signal at scale — not the case in Phase I (embeddings optional).

## Evidence

- `data/index/meta.json`: 3,746 chunks / 1,142 files, `docsCommit` recorded →
  the internal page answers "which docs version is live?".
- Health endpoint returns 503 when the index fails to load — storage liveness is
  observable.

## Consequences

No database to provision; deploy = copy files + start; index build is a pure
function of the docs commit (reproducible).

## Trade-offs

Memory-resident (bounded by corpus size); a horizontal fleet loads its own copy
(fine — read-only, rebuilt out of band).

## Revisit when

Corpus no longer fits comfortably in memory, or multi-writer/near-real-time index
updates are needed → move to Postgres+pgvector or a search engine behind the same
`search()` contract.
