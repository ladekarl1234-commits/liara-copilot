// Build the local search index from the docs clone.
// - lexical index: always
// - embeddings: only when AI_EMBEDDINGS_MODEL + AI_BASE_URL/KEY are configured,
//   incremental by chunk hash (only new/changed chunks are embedded)
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import MiniSearch from 'minisearch';
import { ingestDocs } from '../src/lib/docs/ingest';
import { miniOptions, LEXICAL_VERSION } from '../src/lib/retrieval/index';
import { config } from '../src/lib/config';
import { OpenAICompatibleProvider } from '../src/lib/ai/provider';

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

  // lexical
  const mini = new MiniSearch(miniOptions());
  mini.addAll(chunks as unknown as Record<string, unknown>[]);
  fs.writeFileSync(path.join(indexDir, 'lexical.json'), JSON.stringify(mini));
  fs.writeFileSync(path.join(indexDir, 'chunks.json'), JSON.stringify(chunks));

  // embeddings (optional, incremental)
  let embeddedCount = 0;
  const embPath = path.join(indexDir, 'embeddings.json');
  if (cfg.AI_EMBEDDINGS_MODEL && cfg.aiConfigured) {
    const model = cfg.AI_EMBEDDINGS_MODEL;
    const prev: { model?: string; dims?: number; vectors?: Record<string, number[]> } = fs.existsSync(embPath)
      ? JSON.parse(fs.readFileSync(embPath, 'utf8'))
      : {};
    const vectors: Record<string, number[]> = prev.model === model ? (prev.vectors ?? {}) : {};
    const todo = chunks.filter((c) => !vectors[c.hash]);
    console.log(`[build-index] embedding ${todo.length}/${chunks.length} chunks with ${model} (rest cached)`);
    const provider = new OpenAICompatibleProvider();
    const BATCH = 64;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const embs = await provider.embed(
        batch.map((c) => `${c.title}\n${c.headingPath.join(' › ')}\n${c.text}`.slice(0, 6000)),
        model,
      );
      batch.forEach((c, j) => {
        vectors[c.hash] = normalize(embs[j]);
      });
      embeddedCount += batch.length;
      if (i % (BATCH * 4) === 0) console.log(`[build-index] embedded ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    }
    // prune stale hashes
    const live = new Set(chunks.map((c) => c.hash));
    for (const h of Object.keys(vectors)) if (!live.has(h)) delete vectors[h];
    const dims = Object.values(vectors)[0]?.length ?? 0;
    fs.writeFileSync(embPath, JSON.stringify({ model, dims, vectors }));
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

function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

main().catch((e) => {
  console.error('[build-index] failed:', e.message);
  process.exit(1);
});
