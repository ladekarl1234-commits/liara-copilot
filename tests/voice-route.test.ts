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
function audioForm(bytes = new Uint8Array([1, 2, 3, 4]), type = 'audio/webm'): FormData {
  const fd = new FormData();
  fd.append('audio', new File([bytes], 'speech.webm', { type }));
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
    const res = await POST(req(audioForm(new Uint8Array(5000)))); // 5 KB > 1 KB cap
    expect(res.status).toBe(413);
    expect(transcribed).toBe(false); // never reached the provider
    delete process.env.VOICE_MAX_BYTES;
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
