import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { loadIndex } from '@/lib/retrieval/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  let index: { loaded: boolean; chunkCount?: number; builtAt?: string } = { loaded: false };
  try {
    const idx = loadIndex();
    index = { loaded: true, chunkCount: idx.meta.chunkCount, builtAt: idx.meta.builtAt };
  } catch {
    // IndexMissingError (or unreadable index) -> degraded, still alive
  }
  // The index is REQUIRED to answer anything — if it failed to load the app is
  // genuinely broken, so return 503 to fail an LB/orchestrator healthcheck
  // (DEPLOY-005/REL-005). Keyless mode (index ok, no AI key) is still a healthy
  // 200: it degrades to grounded source listings, which is intentional.
  return NextResponse.json(
    {
      status: index.loaded ? 'ok' : 'degraded',
      index,
      aiConfigured: config().aiConfigured,
      version: '0.1.0',
    },
    { status: index.loaded ? 200 : 503 },
  );
}
