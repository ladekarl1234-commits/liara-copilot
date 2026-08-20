import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { consume } from '@/lib/security/ratelimit';
import { parseFeedback, ValidationError } from '@/lib/security/validate';
import { recordGap } from '@/lib/obs/gaps';
import { log } from '@/lib/obs/log';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  try {
    const body: unknown = await req.json().catch(() => {
      throw new ValidationError('request body must be valid JSON');
    });
    const fb = parseFeedback(body);

    const rl = consume(`${ip}|${fb.sessionId}`);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } },
      );
    }

    const dir = config().RUNTIME_DIR;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(
      path.join(dir, 'feedback.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), ...fb }) + '\n',
      'utf8',
    );

    if (fb.verdict === 'not_helpful' || fb.verdict === 'not_solved') {
      recordGap({
        normalizedQuestion: fb.comment?.trim() || `message:${fb.messageId}`,
        reason: 'not_helpful',
        language: 'fa',
      });
    }

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: { code: 'invalid_input', message: e.message } }, { status: 400 });
    }
    log('error', 'feedback_failed', { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
  }
}
