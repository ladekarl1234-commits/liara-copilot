// The ONE place a text becomes a vector — index build and query time alike.
//
// Why this file exists: the benchmarked hybrid gain was unreachable in the
// shipped artifact because the two sides embedded differently. The build side
// sent `title\nheadingPath\ntext` with no prefix through the HTTP provider; the
// query side called `provider.embed` which cannot apply a prefix at all. e5
// models are ASYMMETRIC — documents must be "passage: …" and queries "query: …"
// — and getting that wrong silently halves recall (EP-RET-01). Both sides now
// route through `embedPassages` / `embedQueries` here, so they cannot drift.
//
// Model selection follows AI_EMBEDDINGS_MODEL:
//   local:<hf-model>  → in-process Transformers.js (no API key, no network at
//                       query time once cached). `local:` alone = the default.
//   anything else     → the configured OpenAI-compatible provider.

import { config } from '@/lib/config';
import { embedTexts, embedInBatches, DEFAULT_LOCAL_EMBED_MODEL, type EmbedKind } from '@/lib/ai/local-embeddings';
import type { DocChunk } from '@/types';

const LOCAL_PREFIX = 'local:';

/** The model id for the local path, or null when the provider should be used. */
export function localModelId(model: string | undefined): string | null {
  if (!model?.startsWith(LOCAL_PREFIX)) return null;
  return model.slice(LOCAL_PREFIX.length).trim() || DEFAULT_LOCAL_EMBED_MODEL;
}

/**
 * The passage template. Identical at build and (conceptually) at query time —
 * the benchmark that produced the +14.6pt hit@1 number used exactly this, so a
 * change here invalidates the benchmark.
 */
export function passageText(c: DocChunk): string {
  return [c.title, c.headingPath.join(' › '), c.text].join('\n').slice(0, 6000);
}

async function viaProvider(texts: string[], model: string): Promise<number[][]> {
  // dynamic import: keeps the HTTP provider (and its config assertions) out of
  // the local-only path, which must work with no API key at all.
  const { OpenAICompatibleProvider } = await import('@/lib/ai/provider');
  return new OpenAICompatibleProvider().embed(texts, model);
}

async function embed(texts: string[], kind: EmbedKind, model?: string): Promise<number[][]> {
  const m = model ?? config().AI_EMBEDDINGS_MODEL;
  if (!m) throw new Error('AI_EMBEDDINGS_MODEL is not set');
  const local = localModelId(m);
  return local ? embedTexts(texts, kind, local) : viaProvider(texts, m);
}

/** Embed search queries (e5 `query:` side). */
export function embedQueries(texts: string[], model?: string): Promise<number[][]> {
  return embed(texts, 'query', model);
}

/** Embed documents (e5 `passage:` side). */
export function embedPassages(texts: string[], model?: string): Promise<number[][]> {
  return embed(texts, 'passage', model);
}

/**
 * Batched passage embedding for the index build: bounded memory, progress
 * callback, and the same routing as the query side.
 */
export function embedPassagesInBatches(
  texts: string[],
  model: string,
  batchSize: number,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const local = localModelId(model);
  if (local) return embedInBatches(texts, 'passage', batchSize, local, onProgress);
  return (async () => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      out.push(...(await viaProvider(texts.slice(i, i + batchSize), model)));
      onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
    }
    return out;
  })();
}

/**
 * The `embedQuery` dependency `search()` takes, or undefined when embeddings
 * are not configured. Callers pass this straight into `SearchDeps.embedQuery`.
 */
export function queryEmbedder(): ((texts: string[]) => Promise<number[][]>) | undefined {
  const cfg = config();
  const model = cfg.AI_EMBEDDINGS_MODEL;
  if (!model) return undefined;
  // a provider-hosted model still needs a configured provider; a local: one does not
  if (!localModelId(model) && !cfg.aiConfigured) return undefined;
  return (texts: string[]) => embedQueries(texts, model);
}
