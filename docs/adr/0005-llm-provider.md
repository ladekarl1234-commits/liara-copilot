# ADR 0005 — LLM provider: OpenRouter Free Router behind an abstraction

**Status:** Accepted (Phase I)

## Context

Generation must be server-side, swappable, testable without a key, and cheap.
The user supplies an OpenRouter key and wants the **Free Models Router**
(`openrouter/free`), which is dynamic (the underlying model can change per call).

## Decision

A single **`ModelProvider`** contract (`generate` / `generateStream` / `embed`).
The runtime implementation is **`OpenAICompatibleProvider`** over `fetch`,
configured for OpenRouter by default (`OPENROUTER_API_KEY`,
`OPENROUTER_MODEL=openrouter/free`, base `https://openrouter.ai/api/v1`). A
generic `AI_BASE_URL`/`AI_API_KEY` overrides it (Liara AI, OpenAI, Ollama). A
**`MockLLMProvider`** (deterministic, zero network) backs load tests and offline
dev. Because the router is dynamic, the provider records the **actual returned
model** (`data.model`, and the first streaming chunk's `model`) into request
metrics and the internal trace — never fabricating reproducibility.

## Alternatives considered

- **Vendor SDK (OpenAI/Anthropic client).** Ties us to one vendor; the
  OpenAI-compatible wire format already spans OpenRouter, Liara AI, Ollama.
- **Pin one specific free model.** Kept available via `OPENROUTER_MODEL` but not
  the default — the Free Router spreads load and survives any single model's
  churn. Pin only if evaluation shows a clearly better, still-available free
  model (amendment §Model quality evaluation).

## Evidence

- Keyless path verified (degraded grounded-sources mode, 0 model calls).
- Mock path verified under load: chat 400/400 ok, p50 232 ms / p95 282 ms
  (`benchmarks/load/`), exercising retrieval + streaming without spending quota.
- `tests/ai-provider-config.test.ts` proves provider resolution + actual-model
  reporting via `onMeta`.

## Consequences

At most 2 model calls/message (+1 optional verification); 0 for greeting, cache
hit, keyless, and injection refusal. Provider swap is config-only.

## Trade-offs

Free-router responses are non-deterministic (model varies) — acceptable for a
support assistant; for repeatable *quality* eval we record and, if needed, pin
the model for that run only.

## Revisit when

A specific free (or paid) model is measured clearly better and stable → pin it
and document; or when Liara AI is chosen as primary in deployment.
