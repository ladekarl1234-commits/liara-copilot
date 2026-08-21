// POST /api/voice/transcribe — multipart form with an `audio` file.
// Returns { text, language } from the server-side STT provider (Soniox).
// The provider key stays server-side; the browser only sends recorded bytes.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { clientIp, isCrossSiteRequest, readBytesCapped, PayloadTooLargeError } from '@/lib/security/validate';
import { consume } from '@/lib/security/ratelimit';
import { hashId } from '@/lib/security/hash';
import { getSttProvider, isSttError } from '@/lib/speech';
import { config } from '@/lib/config';
import { log } from '@/lib/obs/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TRANSCRIBE_TIMEOUT_MS = 40_000;

// A transcription is the most expensive request the app serves: megabytes of
// upload, a paid third-party job, and a server slot held for up to 40 s. It
// must not debit the limiter the same single token a 2-character chat message
// does (EP-SEC-08). At the default RATE_LIMIT_RPM=20 this is 5 recordings/min
// per client, well above real use (the UI records ~60 s clips).
const VOICE_RATE_COST = 4;

// Containers a browser MediaRecorder actually produces, plus the common
// hand-uploaded formats. file.type is client-controlled, so the sniff below is
// the check that matters; the allowlist just gives a clear 415.
const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/m4a', 'audio/x-m4a']);

/**
 * Container magic bytes. Rejecting non-audio here stops the route being an
 * unauthenticated relay of arbitrary 8 MB payloads to a paid API (EP-SEC-10).
 * ponytail: container sniff only — the MPEG frame-sync branch (0xFF 0xEx) is a
 * heuristic that a crafted file can satisfy. Full decode/probe is the upgrade
 * path if garbage ever gets through; the point here is cost, not parsing.
 */
function looksLikeAudio(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const ascii = (o: number, s: string) => s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true; // EBML (webm/mkv)
  if (ascii(0, 'OggS')) return true; // ogg / opus
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return true; // wav
  if (ascii(4, 'ftyp')) return true; // mp4 / m4a (Safari)
  if (ascii(0, 'ID3')) return true; // mp3 with tags
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true; // raw MPEG frame sync
  return false;
}

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const cfg = config();
  const ip = clientIp(req);

  // multipart/form-data is CORS-simple: without this, a third-party page can
  // spend the operator's STT quota through its own visitors, each with a
  // different IP so the per-IP limiter never fires (EP-SEC-04).
  if (isCrossSiteRequest(req)) return err('forbidden', 'cross-site request rejected', 403);

  const rl = consume(ip, VOICE_RATE_COST);
  if (!rl.allowed) {
    // the most expensive route to be throttled on, and it was the quietest:
    // a 429 here produced no log line at all (EP-OBS-05)
    log('warn', 'rate_limited', {
      requestId,
      route: 'voice',
      ipHash: hashId(ip),
      scope: rl.scope,
      retryAfterSec: rl.retryAfterSec,
    });
    return err('rate_limited', 'rate limit exceeded', 429);
  }

  const stt = getSttProvider();
  if (!stt) return err('voice_unavailable', 'voice input is not configured on the server', 503);

  // Cap the raw body ON THE STREAM before formData() buffers it — an unbounded
  // multipart upload must not be parsed into memory first. Small multipart
  // overhead margin over the audio cap.
  let raw: Uint8Array;
  try {
    raw = await readBytesCapped(req, cfg.VOICE_MAX_BYTES + 8_192);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) return err('invalid_input', 'audio too large', 413);
    return err('invalid_input', 'could not read request body', 400);
  }

  let file: File | null = null;
  try {
    const parsed = new Request('http://local/voice', {
      method: 'POST',
      headers: { 'content-type': req.headers.get('content-type') ?? '' },
      body: new Blob([raw as BlobPart]),
    });
    const form = await parsed.formData();
    const f = form.get('audio');
    if (f instanceof File) file = f;
  } catch {
    return err('invalid_input', 'expected multipart/form-data with an audio field', 400);
  }
  if (!file) return err('invalid_input', 'missing audio file', 400);
  if (file.size === 0) return err('invalid_input', 'empty recording', 400);
  if (file.size > cfg.VOICE_MAX_BYTES) return err('invalid_input', 'audio too large', 413);

  // strip codec parameters: `audio/webm;codecs=opus` is what Chrome sends
  const declaredType = file.type.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(declaredType)) {
    return err('invalid_input', 'unsupported audio format', 415);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeAudio(bytes)) return err('invalid_input', 'file is not a recognised audio recording', 415);
  const t0 = Date.now();
  try {
    // hard timeout so a hung Soniox upload/poll cannot hold the connection to maxDuration
    const result = await stt.transcribe(bytes, { mimeType: file.type, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
    log('info', 'voice_transcribed', {
      requestId,
      ipHash: hashId(ip),
      bytes: file.size,
      ms: Date.now() - t0,
      language: result.language,
      // never log the transcript itself (it is user speech content)
      chars: result.text.length,
    });
    return NextResponse.json({ text: result.text, language: result.language });
  } catch (e) {
    if (isSttError(e)) {
      log('warn', 'voice_failed', { requestId, code: e.code });
      if (e.code === 'stt_empty') return err('invalid_input', 'no speech detected', 422);
      if (e.code === 'stt_timeout') return err('voice_unavailable', 'transcription timed out', 504);
      return err('voice_unavailable', 'transcription failed', 502);
    }
    // AbortSignal.timeout firing surfaces as a DOMException (not an SttError)
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      log('warn', 'voice_timeout', { requestId });
      return err('voice_unavailable', 'transcription timed out', 504);
    }
    log('error', 'voice_error', { requestId, message: (e as Error).message });
    return err('internal', 'transcription error', 500);
  }
}
