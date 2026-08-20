// POST /api/chat — SSE stream of ChatEvent objects.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import type { ChatEvent } from '@/types';
import { handleChatMessage } from '@/lib/agent/orchestrator';
import { parseChatRequest, ValidationError } from '@/lib/security/validate';
import { consume } from '@/lib/security/ratelimit';
import { config } from '@/lib/config';
import { log } from '@/lib/obs/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();

  // request-size guard before reading the body
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > config().MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: { code: 'invalid_input', message: 'request too large' } },
      { status: 413 },
    );
  }

  let body: { sessionId?: string; message: string };
  try {
    body = parseChatRequest(await req.json());
  } catch (e) {
    const msg = e instanceof ValidationError ? e.message : 'invalid JSON body';
    return NextResponse.json({ error: { code: 'invalid_input', message: msg } }, { status: 400 });
  }

  const rl = consume(`${ip}|${body.sessionId ?? 'anon'}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'rate limit exceeded' } },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 30) } },
    );
  }

  log('info', 'chat_request', { requestId, ip, sessionId: body.sessionId, chars: body.message.length });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true; // client went away mid-stream
        }
      };
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
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-request-id': requestId,
    },
  });
}
