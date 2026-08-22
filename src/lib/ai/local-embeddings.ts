// Local multilingual embeddings via Transformers.js (ONNX/WASM) — no API key,
// no network at query time once the model is cached. Used by the retrieval-mode
// benchmark (scripts/benchmark-retrieval-modes.ts) to measure vector/hybrid
// retrieval, and available to the runtime as a zero-cost embeddings option.
//
// Model: intfloat/multilingual-e5-small (384-dim) — strong multilingual
// retrieval incl. Persian. e5 REQUIRES asymmetric prefixes: documents are
// embedded as "passage: <text>" and queries as "query: <text>". Getting this
// wrong silently halves recall, so the prefix is part of the contract here.

// One pipeline per model — keying by model prevents a second call with a
// different model from silently reusing the first model's pipeline (mixing
// vector spaces with no error).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipes = new Map<string, Promise<any>>();

export const DEFAULT_LOCAL_EMBED_MODEL = 'Xenova/multilingual-e5-small';

/**
 * The default value of AI_EMBEDDINGS_MODEL — i.e. hybrid retrieval, on, with no
 * API key required. It lives HERE (a module with no config dependency) because
 * two independent readers need the same answer and must not drift:
 *   - `config()`'s zod schema, for everything that goes through Config;
 *   - `loadIndex()`, which deliberately reads process.env directly so that
 *     loading an index never materializes/freezes the config singleton.
 * Setting the variable to an empty string opts out to lexical-only.
 */
export const DEFAULT_EMBEDDINGS_MODEL = 'baai/bge-m3';

/**
 * The no-API-key alternative: `local:` runs multilingual-e5-small in-process.
 * It is still supported and still what the Docker image bakes in, but it is no
 * longer the default, for two measured reasons:
 *
 *  1. It is not reachable on a serverless target. onnxruntime-web is 63 MB and
 *     @xenova/transformers another 63 MB of function bundle, and the weights
 *     are a further 52 MB that have to be fetched inside a request.
 *  2. Its failure mode is unrecoverable. A truncated weights file in the cache
 *     (35,083,220 bytes on disk here against a real 118,308,185) makes
 *     `pipeline()` exit the Node process with code 127, no JS error and no
 *     stderr — protobuf parsing fails inside the WASM runtime. Nothing in
 *     `search()`'s try/catch or `embed.ts`'s timeout can catch a process abort,
 *     so a corrupt cache takes down the server rather than degrading to
 *     lexical. `env.allowLocalModels = false` does not help: transformers.js
 *     serves the cached file without revalidating its length.
 *     (Cold load with a good cache is 770-810ms; warm query embed is ~5ms, and
 *     peak RSS for the embedder alone is ~790MB.)
 *
 * bge-m3 through the configured provider beats what the local model scored, on
 * the same corpus and the same eval set — hit@5 0.833 lexical / 0.896 hybrid,
 * MRR 0.630 / 0.748, evidence-recall 0.792 / 0.875 — for ~$0.01 per full index
 * rebuild and roughly nothing per query.
 */
export const LOCAL_EMBEDDINGS_MODEL = 'local:';
export const LOCAL_EMBED_DIM = 384;

async function getPipe(model: string) {
  let p = pipes.get(model);
  if (!p) {
    p = (async () => {
      // dynamic import: keep transformers.js out of the app bundle; it only loads
      // when embeddings are actually requested (benchmark / opt-in runtime).
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false; // fetch from the HF hub, then cache to disk
      if (process.env.TRANSFORMERS_CACHE) env.cacheDir = process.env.TRANSFORMERS_CACHE;
      // single-threaded WASM: multi-thread onnxruntime-web deadlocks under Node on
      // some hosts (the model load never returns). One thread is slower but stable.
      env.backends.onnx.wasm.numThreads = 1;
      return pipeline('feature-extraction', model, { quantized: true });
    })();
    pipes.set(model, p);
  }
  return p;
}

export type EmbedKind = 'query' | 'passage';

/**
 * Embed texts with the local model. `kind` applies the e5 prefix; pass
 * 'passage' for documents/chunks and 'query' for search queries. Returns
 * L2-normalized row vectors (so dot product == cosine).
 */
export async function embedTexts(
  texts: string[],
  kind: EmbedKind,
  model: string = DEFAULT_LOCAL_EMBED_MODEL,
): Promise<number[][]> {
  if (!texts.length) return [];
  const pipe = await getPipe(model);
  const prefixed = texts.map((t) => `${kind}: ${t}`);
  const out = await pipe(prefixed, { pooling: 'mean', normalize: true });
  const rows = out.tolist() as number[][];
  return rows;
}

/** Batch helper: embed a large array in fixed-size chunks (keeps memory bounded). */
export async function embedInBatches(
  texts: string[],
  kind: EmbedKind,
  batchSize = 32,
  model: string = DEFAULT_LOCAL_EMBED_MODEL,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    out.push(...(await embedTexts(batch, kind, model)));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}
