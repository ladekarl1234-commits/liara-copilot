# Architecture Decision Records

Numbered, immutable-ish records of the significant engineering decisions. Each
states Context, Decision, Alternatives, Evidence, Consequences, Trade-offs, and
Revisit conditions. Supersede rather than silently edit.

| ADR | Decision |
|---|---|
| [0001](0001-application-stack.md) | TypeScript + Next.js modular monolith |
| [0002](0002-retrieval-architecture.md) | In-process hybrid retrieval + evidence gate |
| [0003](0003-vector-and-lexical-storage.md) | In-process JSON index (not a database) |
| [0004](0004-embedding-model.md) | ~~Optional, provider-agnostic embeddings (lexical default)~~ — **superseded by 0008** |
| [0005](0005-llm-provider.md) | OpenRouter Free Router behind a `ModelProvider` abstraction |
| [0006](0006-voice-architecture.md) | Soniox STT (server-side) + browser TTS |
| [0007](0007-cache-and-state.md) | In-memory state/cache/limits, Keyv-compatible upgrade path |
| [0008](0008-hybrid-by-default-local-embeddings.md) | Hybrid retrieval by default, local `multilingual-e5-small` |

See also `docs/STACK-EVALUATION.md` for the cross-cutting decision matrix.
