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
  return NextResponse.json({
    status: index.loaded ? 'ok' : 'degraded',
    index,
    aiConfigured: config().aiConfigured,
    version: '0.1.0',
  });
}
