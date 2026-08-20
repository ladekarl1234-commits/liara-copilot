import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import { lastTraces } from '@/lib/obs/trace';
import { readGapSummary } from '@/lib/obs/gaps';
import { loadIndex } from '@/lib/retrieval/index';

export const dynamic = 'force-dynamic';

/** Latest retrieval-eval result JSON (measured metrics), if present. */
function latestEval(): unknown {
  try {
    const dir = path.join(process.cwd(), 'evals', 'results');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) return null;
    const raw = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
    return { file: files[files.length - 1], ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export async function GET() {
  const cfg = config();
  if (!cfg.diagEnabled) {
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
    eval: latestEval(),
    traces: lastTraces(20),
    gaps: readGapSummary(),
  });
}
