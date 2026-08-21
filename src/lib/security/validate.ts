// Input validation at the trust boundary. All messages here are safe to show
// to end users (no echoed input, no internals).

import crypto from 'node:crypto';
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
    // cancel (not just releaseLock) so an oversize/aborted upload stops
    // arriving instead of streaming into a dropped socket
    await reader.cancel().catch(() => {});
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

/**
 * Read a request body into bytes while ENFORCING the cap on the actual stream
 * (the content-length header is advisory). Use before parsing a multipart
 * upload so a huge/chunked body cannot be buffered into memory first.
 */
export async function readBytesCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
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
    await reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.byteLength;
  }
  return buf;
}

export class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`request exceeds ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Client IP for rate limiting. Forwarding headers are only meaningful behind a
 * trusted proxy (Liara's LB sets them); with TRUST_PROXY=off every direct
 * client shares one bucket rather than letting a spoofed header mint
 * unlimited fresh buckets.
 *
 * ponytail: with TRUST_PROXY=off the key is the literal 'direct' for everyone,
 * so direct-exposed deployments have one shared bucket and no per-client
 * fairness. That is deliberate: a directly-exposed Node server sees no
 * trustworthy client identity at all (Next 15 removed NextRequest.ip, and every
 * header a client sends is forgeable), so any per-client key would be a key the
 * attacker mints. Upgrade path is the deployment, not the code: front it with a
 * proxy and set TRUST_PROXY=on.
 */
export function clientIp(req: Request): string {
  if (config().TRUST_PROXY === 'on') {
    // x-real-ip is REPLACED by the proxy, so the client cannot forge it —
    // prefer it whenever the LB provides one.
    const real = req.headers.get('x-real-ip')?.trim();
    if (real) return real.slice(0, 64);
    // x-forwarded-for is APPENDED to: `<whatever the client sent>, <the address
    // the proxy actually saw>`. Only the RIGHTMOST hop was written by our own
    // proxy; the leftmost is attacker-chosen, and trusting it let one client
    // mint a fresh 20-rpm bucket per request and drain the global backstop
    // (EP-SEC-03).
    // ponytail: assumes exactly ONE trusted proxy in front (Liara's LB). Behind
    // two (e.g. Cloudflare → LB) the right answer is the 2nd-from-right — make
    // the trusted-hop count a config value when such a deployment appears.
    const hops = req.headers.get('x-forwarded-for')?.split(',') ?? [];
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i].trim();
      if (hop) return hop.slice(0, 64);
    }
  }
  return 'direct';
}

/**
 * Cross-site POST guard (CSRF / drive-by cost abuse).
 *
 * There are no cookies to steal here, but there IS a budget: without this, any
 * third-party page can make every one of its visitors POST an 8 MB recording to
 * /api/voice/transcribe on the operator's Soniox key — and because each victim
 * has a different IP, the per-IP limiter never fires. multipart/form-data is a
 * CORS-simple content type, so the browser sends it cross-origin with no
 * preflight to stop it (EP-SEC-04).
 *
 * Non-browser clients (curl, a mobile app, a health check) send neither header
 * and are allowed — they are not the threat model, and there is no ambient
 * authority for them to abuse.
 */
export function isCrossSiteRequest(req: Request): boolean {
  // Sec-Fetch-Site is set by the browser and forbidden to page JS, so when it
  // is present it is authoritative — in BOTH directions. Deciding here also
  // avoids a false 403 on a deployment whose proxy rewrites the Host header,
  // which the Origin/Host comparison below would misread as cross-site.
  // (A non-browser client can of course forge it, but a non-browser client is
  // not the threat: the point is stopping a third-party page from spending the
  // operator's budget through ITS visitors' browsers.)
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'cross-site';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('host') ?? hostOf(req.url);
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // unparseable Origin — treat as hostile
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Diagnostics auth for /api/diag (and /internal).
 *
 * DIAG_ENABLED is an ops flag, not a credential, and the payload is real user
 * content: recent questions, free-text feedback and the last pipeline traces.
 * So in PRODUCTION a shared secret is required — enabling the flag without
 * setting DIAG_TOKEN keeps diagnostics closed rather than publishing user data
 * to the internet (EP-SEC-07). Dev keeps the frictionless flag-only behaviour.
 *
 * ponytail: DIAG_TOKEN is read straight from the env because the zod Env schema
 * lives in config.ts; fold it in there next time that file is touched.
 */
export function diagAuthorized(req: Request): boolean {
  const cfg = config();
  if (!cfg.diagEnabled) return false;
  const expected = process.env.DIAG_TOKEN ?? '';
  if (!expected) return !cfg.isProd;
  const auth = req.headers.get('authorization') ?? '';
  const presented = /^bearer /i.test(auth) ? auth.slice(7).trim() : (req.headers.get('x-diag-token') ?? '');
  // compare digests: constant length, so timingSafeEqual never throws and the
  // comparison leaks neither the token's length nor a prefix match
  const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(digest(presented), digest(expected));
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
