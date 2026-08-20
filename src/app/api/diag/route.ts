import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { lastTraces } from '@/lib/obs/trace';
import { readGapSummary } from '@/lib/obs/gaps';
import { loadIndex } from '@/lib/retrieval/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!config().diagEnabled) {
    return new NextResponse(null, { status: 404 });
  }
  let index: unknown = null;
  try {
    index = loadIndex().meta;
  } catch (e) {
    index = { error: e instanceof Error ? e.message : 'index unavailable' };
  }
  return NextResponse.json({
    traces: lastTraces(20),
    gaps: readGapSummary(),
    index,
  });
}
