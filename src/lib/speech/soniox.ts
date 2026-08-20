// Soniox Speech-to-Text (async file API), server-side only. The SONIOX_API_KEY
// never leaves the server — the browser records audio and POSTs bytes to
// /api/voice/transcribe, which calls this. Persian is a first-class Soniox
// language (language_hints:["fa","en"] + language identification).
//
// Flow (https://soniox.com/docs/stt/async/async-transcription):
//   1. POST /v1/files                          -> { id }
//   2. POST /v1/transcriptions {file_id,...}   -> { id }
//   3. GET  /v1/transcriptions/{id}   (poll until status completed|error)
//   4. GET  /v1/transcriptions/{id}/transcript -> { tokens:[{text}] }
//   5. DELETE transcription + file             (best-effort cleanup)

import type { SpeechToTextProvider, Transcript, TranscribeOptions } from '@/types';
import { config } from '@/lib/config';

export class SttError extends Error {
  constructor(
    public code: 'stt_unconfigured' | 'stt_failed' | 'stt_empty' | 'stt_timeout',
    message: string,
  ) {
    super(message);
    this.name = 'SttError';
  }
}

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

export class SonioxSttProvider implements SpeechToTextProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    const cfg = config();
    this.baseUrl = cfg.SONIOX_BASE_URL.replace(/\/$/, '');
    this.apiKey = cfg.SONIOX_API_KEY ?? '';
    this.model = cfg.SONIOX_MODEL;
    if (!this.apiKey) throw new SttError('stt_unconfigured', 'SONIOX_API_KEY is not set');
  }

  private auth() {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  async transcribe(audio: Uint8Array, opts: TranscribeOptions = {}): Promise<Transcript> {
    const signal = opts.signal;
    let fileId: string | undefined;
    let transcriptionId: string | undefined;
    try {
      // 1. upload the audio file
      const form = new FormData();
      const blob = new Blob([audio as BlobPart], { type: opts.mimeType || 'application/octet-stream' });
      form.append('file', blob, 'audio');
      const up = await fetch(`${this.baseUrl}/v1/files`, { method: 'POST', headers: this.auth(), body: form, signal });
      if (!up.ok) throw new SttError('stt_failed', `soniox files ${up.status}: ${(await up.text()).slice(0, 200)}`);
      fileId = (await up.json())?.id;
      if (!fileId) throw new SttError('stt_failed', 'soniox: no file id');

      // 2. create the transcription
      const create = await fetch(`${this.baseUrl}/v1/transcriptions`, {
        method: 'POST',
        headers: { ...this.auth(), 'content-type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          model: this.model,
          language_hints: opts.languageHints ?? ['fa', 'en'],
          enable_language_identification: true,
        }),
        signal,
      });
      if (!create.ok) throw new SttError('stt_failed', `soniox transcriptions ${create.status}: ${(await create.text()).slice(0, 200)}`);
      transcriptionId = (await create.json())?.id;
      if (!transcriptionId) throw new SttError('stt_failed', 'soniox: no transcription id');

      // 3. poll until done
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        const st = await fetch(`${this.baseUrl}/v1/transcriptions/${transcriptionId}`, { headers: this.auth(), signal });
        if (!st.ok) throw new SttError('stt_failed', `soniox status ${st.status}`);
        const body = await st.json();
        if (body.status === 'completed') break;
        if (body.status === 'error') throw new SttError('stt_failed', `soniox error: ${body.error_message ?? 'unknown'}`);
        if (Date.now() > deadline) throw new SttError('stt_timeout', 'soniox transcription timed out');
        await sleep(POLL_INTERVAL_MS, signal);
      }

      // 4. fetch the transcript and concatenate tokens
      const tr = await fetch(`${this.baseUrl}/v1/transcriptions/${transcriptionId}/transcript`, { headers: this.auth(), signal });
      if (!tr.ok) throw new SttError('stt_failed', `soniox transcript ${tr.status}`);
      const data = await tr.json();
      const tokens: { text?: string; language?: string }[] = Array.isArray(data.tokens) ? data.tokens : [];
      const text = tokens.map((t) => t.text ?? '').join('').trim();
      if (!text) throw new SttError('stt_empty', 'soniox returned no speech');
      const language = tokens.find((t) => t.language)?.language;
      return { text, language };
    } finally {
      // 5. best-effort cleanup — never block or fail the request on this
      if (transcriptionId) void fetch(`${this.baseUrl}/v1/transcriptions/${transcriptionId}`, { method: 'DELETE', headers: this.auth() }).catch(() => {});
      if (fileId) void fetch(`${this.baseUrl}/v1/files/${fileId}`, { method: 'DELETE', headers: this.auth() }).catch(() => {});
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SttError('stt_timeout', 'aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new SttError('stt_timeout', 'aborted')); }, { once: true });
  });
}
