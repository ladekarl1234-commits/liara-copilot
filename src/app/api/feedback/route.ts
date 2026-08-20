import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { consume } from '@/lib/security/ratelimit';
import { parseFeedback, readJsonCapped, clientIp, ValidationError, PayloadTooLargeError } from '@/lib/security/validate';
import { recordGap } from '@/lib/obs/gaps';
import { log } from '@/lib/obs/log';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    // rate limit BEFORE parsing — the parse itself must be protected,
    // and the key must not include anything the client can mint freely
    const rl = consume(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } },
      );
    }
    const fb = parseFeedback(await readJsonCapped(req, config().MAX_BODY_BYTES));

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
    if (e instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: { code: 'invalid_input', message: 'request too large' } }, { status: 413 });
    }
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: { code: 'invalid_input', message: e.message } }, { status: 400 });
    }
    log('error', 'feedback_failed', { message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: { code: 'internal' } }, { status: 500 });
  }
}
