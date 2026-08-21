// POST /api/chat — SSE stream of ChatEvent objects.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import type { ChatEvent } from '@/types';
import { handleChatMessage } from '@/lib/agent/orchestrator';
import {
  parseChatRequest,
  readJsonCapped,
  clientIp,
  isCrossSiteRequest,
  ValidationError,
  PayloadTooLargeError,
} from '@/lib/security/validate';
import { consume } from '@/lib/security/ratelimit';
import { config } from '@/lib/config';
import { log } from '@/lib/obs/log';
import { hashId } from '@/lib/security/hash';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HEARTBEAT_MS = 15_000;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const ip = clientIp(req);

  // A cross-origin fetch with a CORS-simple content type (text/plain) carrying
  // a JSON body reaches this handler with no preflight, so a third-party page
  // can spend the operator's model budget through its own visitors — each with
  // a different IP, so the per-IP limiter never fires. Same guard the voice and
  // feedback routes already carry (EP-SEC-04); chat is the costlier target.
  if (isCrossSiteRequest(req)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'cross-site request rejected' } },
      { status: 403 },
    );
  }

  // Rate limit BEFORE reading the body — the key is the client IP only.
  // (A client-minted sessionId must never grant a fresh bucket.)
  const rl = consume(ip);
  if (!rl.allowed) {
    // Throttling was previously invisible: the 429 returns before the
    // orchestrator runs, so neither chat_request nor request_metrics was ever
    // emitted and an operator saw traffic drop with no server-side evidence
    // (EP-OBS-05). scope distinguishes one noisy client from the global
    // spend backstop, which 429s all traffic.
    log('warn', 'rate_limited', {
      requestId,
      route: 'chat',
      ipHash: hashId(ip),
      scope: rl.scope,
      retryAfterSec: rl.retryAfterSec,
    });
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'rate limit exceeded' } },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 30) } },
    );
  }

  let body: { sessionId?: string; message: string };
  try {
    // byte cap enforced on the actual stream, not the advisory header
    body = parseChatRequest(await readJsonCapped(req, config().MAX_BODY_BYTES));
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: { code: 'invalid_input', message: 'request too large' } },
        { status: 413 },
      );
    }
    const msg = e instanceof ValidationError ? e.message : 'invalid JSON body';
    return NextResponse.json({ error: { code: 'invalid_input', message: msg } }, { status: 400 });
  }

  log('info', 'chat_request', {
    requestId,
    // hash the client IP (PII) — a hash still lets ops correlate/rate-diagnose
    // a single client without storing the raw address (OBS-002)
    ipHash: hashId(ip),
    // never log the raw session id — it is the only session credential;
    // hashId matches the hash length in request_metrics for joins
    session: body.sessionId ? hashId(body.sessionId) : 'new',
    chars: body.message.length,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true; // client went away mid-stream
        }
      };
      const emit = (e: ChatEvent) => write(`data: ${JSON.stringify(e)}\n\n`);
      // SSE comment heartbeat so intermediaries do not cut long model waits
      const heartbeat = setInterval(() => write(': keepalive\n\n'), HEARTBEAT_MS);
      try {
        await handleChatMessage({
          message: body.message,
          sessionId: body.sessionId,
          requestId,
          emit,
          signal: req.signal,
        });
      } catch (e) {
        // orchestrator handles its own errors; this is the last-resort net
        log('error', 'chat_unhandled', { requestId, message: (e as Error).message });
        emit({ type: 'error', code: 'internal', message: 'unexpected failure' });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // reliable disconnect signal even if the platform does not wire req.signal
      log('info', 'chat_stream_cancelled', { requestId });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': requestId,
    },
  });
}
