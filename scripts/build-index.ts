// Build the local search index from the docs clone.
// - lexical index: always
// - embeddings: when AI_EMBEDDINGS_MODEL is set. `local:<model>` embeds
//   in-process with Transformers.js and needs NO API key; any other value uses
//   the configured OpenAI-compatible provider. Incremental by chunk hash
//   (only new/changed chunks are embedded).
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import MiniSearch from 'minisearch';
import { ingestDocs } from '../src/lib/docs/ingest';
import { miniOptions, LEXICAL_VERSION } from '../src/lib/retrieval/index';
import { embedPassagesInBatches, localModelId, passageText } from '../src/lib/retrieval/embed';
import { config } from '../src/lib/config';

async function main() {
  const cfg = config();
  const docsDir = cfg.DOCS_DIR;
  const indexDir = cfg.INDEX_DIR;
  fs.mkdirSync(indexDir, { recursive: true });

  console.log(`[build-index] ingesting ${docsDir} ...`);
  const { chunks, stats } = ingestDocs(docsDir);
  const anchorCoverage = stats.chunks ? stats.anchored / stats.chunks : 0;
  console.log(
    `[build-index] ${stats.files} files -> ${stats.chunks} chunks; anchors on ${stats.anchored} (${(anchorCoverage * 100).toFixed(1)}%); skipped ${stats.skipped.length}`,
  );
  // Deep-anchor coverage is the product's verifiability differentiator and the
  // only thing that stops a citation degrading to a bare page link, yet nothing
  // guarded it — it could halve on an upstream docs refactor (a `<Section id=>`
  // rename, an MDX sibling moving) and no artifact would say so (EP-ANS-09 /
  // EP-RET-09). Floor set just under the measured 36.6%, deliberately tight:
  // a floor 15pp below measured passes the regression it exists to catch.
  const ANCHOR_COVERAGE_FLOOR = 0.35;
  if (anchorCoverage < ANCHOR_COVERAGE_FLOOR) {
    throw new Error(
      `deep-anchor coverage ${(anchorCoverage * 100).toFixed(1)}% is below the ${(ANCHOR_COVERAGE_FLOOR * 100).toFixed(0)}% floor — ` +
        'the docs corpus likely changed how <Section id=…> is authored. Investigate src/lib/docs/ingest.ts loadAnchors() before lowering this.',
    );
  }

  // lexical. NOTE: 491 chunks share a byte-identical body with another page
  // (boilerplate sections copied across products) and EP-RET-07 proposed
  // indexing one representative. Measured: it costs hit@5 0.813→0.792, MRR
  // 0.592→0.568 and one extra false refusal, because the surviving
  // representative belongs to the wrong page for half the queries. The
  // evidence-time dedup in retrieval/index.ts is the right layer for this.
  const mini = new MiniSearch(miniOptions());
  mini.addAll(chunks as unknown as Record<string, unknown>[]);
  fs.writeFileSync(path.join(indexDir, 'lexical.json'), JSON.stringify(mini));
  fs.writeFileSync(path.join(indexDir, 'chunks.json'), JSON.stringify(chunks));

  // embeddings (optional, incremental)
  let embeddedCount = 0;
  const embPath = path.join(indexDir, 'embeddings.json');
  const embedModel = cfg.AI_EMBEDDINGS_MODEL;
  if (embedModel && (localModelId(embedModel) || cfg.aiConfigured)) {
    const prev: { model?: string; dims?: number; vectors?: Record<string, number[]> } = fs.existsSync(embPath)
      ? JSON.parse(fs.readFileSync(embPath, 'utf8'))
      : {};
    const vectors: Record<string, number[]> = prev.model === embedModel ? (prev.vectors ?? {}) : {};
    const todo = chunks.filter((c) => !vectors[c.hash]);
    console.log(`[build-index] embedding ${todo.length}/${chunks.length} chunks with ${embedModel} (rest cached)`);
    // local WASM inference is single-threaded; a smaller batch keeps memory flat
    // and makes progress visible. Provider batches stay at 64 (one HTTP call).
    const BATCH = localModelId(embedModel) ? 16 : 64;
    let lastLogged = 0;
    // passageText() + the 'passage:' prefix live in retrieval/embed.ts, shared
    // with the query side, so the two halves cannot drift apart (EP-RET-01)
    const embs = await embedPassagesInBatches(todo.map(passageText), embedModel, BATCH, (done, total) => {
      if (done - lastLogged >= 256 || done === total) {
        lastLogged = done;
        console.log(`[build-index] embedded ${done}/${total}`);
      }
    });
    todo.forEach((c, j) => {
      vectors[c.hash] = normalize(embs[j]);
    });
    // prune stale hashes
    const live = new Set(chunks.map((c) => c.hash));
    for (const h of Object.keys(vectors)) if (!live.has(h)) delete vectors[h];
    embeddedCount = Object.keys(vectors).length; // vectors SHIPPED, not just newly computed
    const dims = Object.values(vectors)[0]?.length ?? 0;
    fs.writeFileSync(embPath, JSON.stringify({ model: embedModel, dims, vectors }));
    console.log(`[build-index] embeddings: ${Object.keys(vectors).length} vectors, ${dims} dims -> ${embPath}`);
  } else {
    console.log('[build-index] embeddings skipped (AI_EMBEDDINGS_MODEL not configured) — lexical-only index');
  }

  let docsCommit: string | undefined;
  try {
    docsCommit = execFileSync('git', ['-C', docsDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    /* docs dir may not be a git repo */
  }

  fs.writeFileSync(
    path.join(indexDir, 'meta.json'),
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        docsCommit,
        chunkCount: chunks.length,
        fileCount: stats.files,
        anchorCoverage,
        embeddedCount,
        lexicalVersion: LEXICAL_VERSION,
      },
      null,
      2,
    ),
  );
  console.log('[build-index] done');
}

// L2-normalize (so dot product == cosine at query time) and round to 5 decimal
// places. Full float64 text is ~20 bytes per component; 5 dp is ~8 and costs
// ~1e-5 of cosine precision, which is three orders of magnitude below the gaps
// that decide a ranking. On this corpus that is 30MB → ~13MB of shipped index.
function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => Math.round((x / n) * 1e5) / 1e5);
}

main().catch((e) => {
  console.error('[build-index] failed:', e.message);
  process.exit(1);
});
