import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/voice/transcribe/route';
import { setSttProviderForTests, SttError } from '@/lib/speech';
import { resetForTests as resetRateLimit } from '@/lib/security/ratelimit';
import { resetConfigForTests } from '@/lib/config';
import type { SpeechToTextProvider } from '@/types';

function req(fd: FormData): NextRequest {
  return new NextRequest('http://localhost/api/voice/transcribe', { method: 'POST', body: fd });
}
/** A minimal but REAL webm/EBML header — the route now sniffs the container. */
function webmBytes(size = 16): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return b;
}
function audioForm(bytes: Uint8Array = webmBytes(), type = 'audio/webm'): FormData {
  const fd = new FormData();
  fd.append('audio', new File([bytes as BlobPart], 'speech.webm', { type }));
  return fd;
}

describe('POST /api/voice/transcribe', () => {
  beforeEach(() => {
    resetRateLimit();
    resetConfigForTests();
    process.env.RATE_LIMIT_RPM = '100';
  });
  afterEach(() => {
    setSttProviderForTests(null);
    delete process.env.SONIOX_API_KEY;
    delete process.env.RATE_LIMIT_RPM;
    resetConfigForTests();
  });

  it('returns 503 voice_unavailable when STT is not configured', async () => {
    delete process.env.SONIOX_API_KEY;
    resetConfigForTests();
    const res = await POST(req(audioForm()));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('voice_unavailable');
  });

  it('transcribes and returns text when configured', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    const fake: SpeechToTextProvider = { transcribe: async () => ({ text: 'سلام دنیا', language: 'fa' }) };
    setSttProviderForTests(fake);
    const res = await POST(req(audioForm()));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.text).toBe('سلام دنیا');
    expect(j.language).toBe('fa');
  });

  it('rejects an empty recording with 400', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    setSttProviderForTests({ transcribe: async () => ({ text: 'x' }) });
    const res = await POST(req(audioForm(new Uint8Array())));
    expect(res.status).toBe(400);
  });

  it('maps stt_empty to 422 (no speech)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    setSttProviderForTests({
      transcribe: async () => {
        throw new SttError('stt_empty', 'no speech');
      },
    });
    const res = await POST(req(audioForm()));
    expect(res.status).toBe(422);
  });

  it('maps a transcription failure to 502', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    setSttProviderForTests({
      transcribe: async () => {
        throw new SttError('stt_failed', 'boom');
      },
    });
    const res = await POST(req(audioForm()));
    expect(res.status).toBe(502);
  });

  it('rejects an oversize body with 413 (capped on the stream, before parsing)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    process.env.VOICE_MAX_BYTES = '1000';
    resetConfigForTests();
    let transcribed = false;
    setSttProviderForTests({ transcribe: async () => { transcribed = true; return { text: 'x' }; } });
    const res = await POST(req(audioForm(webmBytes(5000)))); // 5 KB > 1 KB cap
    expect(res.status).toBe(413);
    expect(transcribed).toBe(false); // never reached the provider
    delete process.env.VOICE_MAX_BYTES;
  });

  // --- EP-SEC-04 / -08 / -10: the route is the most expensive one in the app ---

  it('rejects a cross-site upload with 403 before touching the provider (EP-SEC-04)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    let transcribed = false;
    setSttProviderForTests({ transcribe: async () => { transcribed = true; return { text: 'x' }; } });
    const fd = audioForm();
    const res = await POST(
      new NextRequest('http://localhost/api/voice/transcribe', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: fd,
      }),
    );
    expect(res.status).toBe(403);
    expect(transcribed).toBe(false);
  });

  it('rejects a non-audio payload with 415, even when it claims an audio MIME type (EP-SEC-10)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    let transcribed = false;
    setSttProviderForTests({ transcribe: async () => { transcribed = true; return { text: 'x' }; } });

    const notAudio = new Uint8Array(64).fill(0x41); // 'AAAA…'
    expect((await POST(req(audioForm(notAudio, 'audio/webm')))).status).toBe(415);
    expect((await POST(req(audioForm(webmBytes(), 'application/zip')))).status).toBe(415);
    expect(transcribed).toBe(false);
  });

  it('accepts the codec parameter Chrome sends (audio/webm;codecs=opus)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    setSttProviderForTests({ transcribe: async () => ({ text: 'ok' }) });
    expect((await POST(req(audioForm(webmBytes(), 'audio/webm;codecs=opus')))).status).toBe(200);
  });

  it('costs more than one rate-limit token per transcription (EP-SEC-08)', async () => {
    process.env.SONIOX_API_KEY = 'k';
    process.env.RATE_LIMIT_RPM = '8';
    resetConfigForTests();
    resetRateLimit();
    setSttProviderForTests({ transcribe: async () => ({ text: 'x' }) });
    // 8 rpm / cost 4 = 2 transcriptions, not 8
    expect((await POST(req(audioForm()))).status).toBe(200);
    expect((await POST(req(audioForm()))).status).toBe(200);
    expect((await POST(req(audioForm()))).status).toBe(429);
  });

  it('rejects a non-multipart body with 400', async () => {
    process.env.SONIOX_API_KEY = 'k';
    resetConfigForTests();
    setSttProviderForTests({ transcribe: async () => ({ text: 'x' }) });
    const bad = new NextRequest('http://localhost/api/voice/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"not":"multipart"}',
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
