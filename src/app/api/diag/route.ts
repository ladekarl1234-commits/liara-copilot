import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import { diagAuthorized } from '@/lib/security/validate';
import { lastTraces } from '@/lib/obs/trace';
import { readGapSummary } from '@/lib/obs/gaps';
import { loadIndex } from '@/lib/retrieval/index';

export const dynamic = 'force-dynamic';

/**
 * Latest retrieval-eval result JSON (measured metrics), if present.
 *
 * Async: the synchronous readdir/readFile pair stalled the single event loop —
 * and therefore every concurrent chat stream — on each /internal refresh
 * (EP-OBS-10).
 *
 * ponytail: still resolved from `process.cwd()` and still sorted by filename,
 * so a result not named `YYYY-MM-DD…` sorts wrong (EP-ARCH-08). Fixing that
 * properly means an `EVALS_DIR` in the zod Env schema plus a `src/lib/obs/evals.ts`
 * that sorts on mtime — both outside this route.
 */
async function latestEval(): Promise<unknown> {
  try {
    const dir = path.join(process.cwd(), 'evals', 'results');
    const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) return null;
    const name = files[files.length - 1];
    const raw = await fs.promises.readFile(path.join(dir, name), 'utf8');
    return { file: name, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const cfg = config();
  // Same 404 whether diagnostics are off, prod has no DIAG_TOKEN set, or the
  // presented token is wrong — the endpoint stays invisible either way, and a
  // wrong token is not distinguishable from a disabled one (EP-SEC-07).
  if (!diagAuthorized(req)) {
    return new NextResponse(null, { status: 404 });
  }
  let index: unknown = null;
  try {
    index = loadIndex().meta;
  } catch (e) {
    index = { error: e instanceof Error ? e.message : 'index unavailable' };
  }
  return NextResponse.json({
    provider: {
      name: cfg.providerName, // openrouter | custom | mock | none
      configured: cfg.aiConfigured,
      fastModel: cfg.fastModel,
      smartModel: cfg.smartModel,
      embeddings: cfg.AI_EMBEDDINGS_MODEL ?? null,
      voiceConfigured: cfg.voiceConfigured,
    },
    index,
    eval: await latestEval(),
    traces: lastTraces(20),
    gaps: readGapSummary(),
  });
}
