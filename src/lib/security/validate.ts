// Input validation at the trust boundary. All messages here are safe to show
// to end users (no echoed input, no internals).

import { z } from 'zod';
import { config } from '@/lib/config';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const sessionIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{8,40}$/, 'invalid session id');

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ValidationError(r.error.issues[0]?.message ?? 'invalid input');
  }
  return r.data;
}

export function parseChatRequest(body: unknown): { sessionId?: string; message: string } {
  const schema = z.object({
    sessionId: sessionIdSchema.optional(),
    message: z
      .string({ required_error: 'message is required', invalid_type_error: 'message must be a string' })
      .transform((s) => s.trim())
      .pipe(
        z
          .string()
          .min(1, 'message must not be empty')
          .max(config().MAX_INPUT_CHARS, `message exceeds ${config().MAX_INPUT_CHARS} characters`),
      ),
  });
  return parse(schema, body);
}

/**
 * Read and JSON-parse a request body while ENFORCING the byte cap on the
 * actual stream — the content-length header is advisory (chunked/HTTP2
 * clients can omit or lie about it).
 */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new ValidationError('request body is required');
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new PayloadTooLargeError(maxBytes);
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      buf.set(p, off);
      off += p.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new ValidationError('invalid JSON body');
  }
}

export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`request exceeds ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Client IP for rate limiting. x-forwarded-for is only meaningful behind a
 * trusted proxy (Liara's LB sets it); with TRUST_PROXY=off every direct
 * client shares one bucket rather than letting a spoofed header mint
 * unlimited fresh buckets.
 */
export function clientIp(req: Request): string {
  if (config().TRUST_PROXY === 'on') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  }
  return 'direct';
}

export function parseFeedback(body: unknown): {
  sessionId: string;
  messageId: string;
  verdict: 'helpful' | 'not_helpful' | 'not_solved';
  comment?: string;
} {
  const schema = z.object({
    sessionId: sessionIdSchema,
    messageId: z.string().min(1, 'messageId is required').max(100, 'messageId too long'),
    verdict: z.enum(['helpful', 'not_helpful', 'not_solved'], {
      errorMap: () => ({ message: 'verdict must be helpful, not_helpful or not_solved' }),
    }),
    comment: z.string().max(2000, 'comment exceeds 2000 characters').optional(),
  });
  return parse(schema, body);
}
