import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { consume } from '@/lib/security/ratelimit';
import {
  parseFeedback,
  readJsonCapped,
  clientIp,
  isCrossSiteRequest,
  ValidationError,
  PayloadTooLargeError,
} from '@/lib/security/validate';
import { redactSecrets } from '@/lib/security/redact';
import { hashId } from '@/lib/security/hash';
import { recordGap } from '@/lib/obs/gaps';
import { findTraceMessage } from '@/lib/obs/trace';
import { log } from '@/lib/obs/log';

export const dynamic = 'force-dynamic';

// Rotate past 5MB, same cap and same one-previous-generation policy as the
// sibling gap log (obs/gaps.ts). Without it feedback.jsonl grew without limit
// on a long-lived instance (EP-ARCH-07).
const MAX_FEEDBACK_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    if (isCrossSiteRequest(req)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    // rate limit BEFORE parsing — the parse itself must be protected,
    // and the key must not include anything the client can mint freely
    const rl = consume(ip);
    if (!rl.allowed) {
      // 429s returned before any other log line left throttling invisible to
      // operators, including the global spend backstop (EP-OBS-05).
      log('warn', 'rate_limited', {
        route: 'feedback',
        ipHash: hashId(ip),
        scope: rl.scope,
        retryAfterSec: rl.retryAfterSec,
      });
      return NextResponse.json(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } },
      );
    }
    const fb = parseFeedback(await readJsonCapped(req, config().MAX_BODY_BYTES));

    // The comment is free text: a user explaining why an answer missed will
    // paste the connection string or token they were debugging. Redact BEFORE
    // it reaches disk or the gap log — /api/diag serves gap questions back
    // verbatim, so an un-redacted sink here is a published secret (EP-SEC-01).
    const comment = fb.comment ? redactSecrets(fb.comment).trim() : '';

    const row = {
      ts: new Date().toISOString(),
      // hashed: the raw session id is a session credential — anyone who can
      // read this row could otherwise resume the conversation (EP-SEC-02).
      // 12-char prefix matches request_metrics, so rows still join.
      session: hashId(fb.sessionId),
      messageId: fb.messageId,
      verdict: fb.verdict,
      ...(comment ? { comment: comment.slice(0, 2000) } : {}),
    };

    // stdout is the ONLY sink that exists on every target. On Vercel the
    // filesystem is read-only outside /tmp, and this route used to let the
    // resulting EROFS fall through to the generic catch — so every thumbs-up
    // and thumbs-down answered HTTP 500 while the user watched. The log drain
    // captures this line on Vercel; on the Docker/Liara image the JSONL below
    // is still the durable copy.
    log('info', 'feedback', row);

    // Best-effort durable append. A read-only or full filesystem must degrade
    // to "logged but not persisted", never to a failed user action.
    try {
      const dir = config().RUNTIME_DIR;
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'feedback.jsonl');
      const size = await fs.promises.stat(file).then((s) => s.size).catch(() => 0);
      if (size > MAX_FEEDBACK_BYTES) await fs.promises.rename(file, file + '.1').catch(() => {});
      await fs.promises.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
    } catch (e) {
      log('warn', 'feedback_persist_skipped', {
        reason: e instanceof Error ? e.message : String(e),
      });
    }

    if (fb.verdict === 'not_helpful' || fb.verdict === 'not_solved') {
      // Resolve messageId back to the question it answered (EP-PRD-04): without
      // this every thumbs-down gap row was an opaque `message:<uuid>` with no
      // way to see WHAT failed. messageId is the requestId (EP-OBS-01), so the
      // pipeline trace ring buffer — which already redacts and stores the
      // question — is the join; a comment, when the user left one, still wins.
      recordGap({
        normalizedQuestion: comment || findTraceMessage(fb.messageId) || `message:${fb.messageId}`,
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
