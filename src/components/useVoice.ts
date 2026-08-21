'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Mic states, surfaced to the UI so the user always knows what's happening.
export type VoiceState = 'idle' | 'unsupported' | 'requesting' | 'listening' | 'processing' | 'error';

export interface VoiceError {
  kind: 'permission' | 'unsupported' | 'empty' | 'transcription' | 'network';
  message: string; // Persian, user-facing
}

const MSG: Record<VoiceError['kind'], string> = {
  permission: 'دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه دهید یا متن را تایپ کنید.',
  unsupported: 'مرورگر شما ضبط صدا را پشتیبانی نمی‌کند؛ لطفاً سوال را تایپ کنید.',
  empty: 'صدایی ضبط نشد؛ دوباره امتحان کنید یا متن را تایپ کنید.',
  transcription: 'تبدیل گفتار به متن ناموفق بود؛ دوباره امتحان کنید یا تایپ کنید.',
  network: 'ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید یا تایپ کنید.',
};

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* older impls throw */
    }
  }
  return '';
}

/**
 * Push-to-talk recording. `onTranscript` receives the recognized text; the
 * caller decides how to insert it (we never touch already-typed content, so a
 * mic failure can never lose what the user wrote — AC-VOICE-002).
 */
export function useVoice(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<VoiceError | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<string>('');
  const mountedRef = useRef(true);
  const cancelRef = useRef(false); // stop() pressed while still 'requesting'

  // Declared BEFORE the mount effect that uses them: both are stable (refs +
  // setState setters only) so every callback below can declare them honestly
  // instead of closing over a value re-created each render — the stale-closure
  // hazard `react-hooks/exhaustive-deps` flagged once a linter finally existed
  // to flag it (EP-MAINT-01).
  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const fail = useCallback(
    (kind: VoiceError['kind']) => {
      setError({ kind, message: MSG[kind] });
      setState('error');
      stopTracks();
    },
    [stopTracks],
  );

  useEffect(() => {
    mountedRef.current = true;
    const supported =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined';
    if (!supported) setState('unsupported');
    return () => {
      // unmount: stop the recorder WITHOUT transcribing, and release the mic.
      mountedRef.current = false;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      stopTracks();
    };
  }, [stopTracks]);

  const send = useCallback(
    async (blob: Blob) => {
      if (!mountedRef.current) return; // component gone — don't POST or setState
      if (blob.size === 0) return fail('empty');
      setState('processing');
      try {
        const form = new FormData();
        form.append('audio', blob, 'speech.webm');
        const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form });
        if (!res.ok) {
          const code = res.status === 422 ? 'empty' : 'transcription';
          return fail(code);
        }
        const data = (await res.json()) as { text?: string };
        const text = (data.text ?? '').trim();
        if (!text) return fail('empty');
        setState('idle');
        setError(null);
        onTranscript(text);
      } catch {
        fail('network');
      }
    },
    [onTranscript, fail],
  );

  const start = useCallback(async () => {
    if (state === 'unsupported') return fail('unsupported');
    setError(null);
    cancelRef.current = false;
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // user hit stop/cancel (or unmounted) while the permission prompt was open:
      // release the mic immediately instead of starting to record.
      if (cancelRef.current || !mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        cancelRef.current = false;
        if (mountedRef.current) setState('idle');
        return;
      }
      streamRef.current = stream;
      mimeRef.current = pickMimeType();
      const rec = mimeRef.current
        ? new MediaRecorder(stream, { mimeType: mimeRef.current })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTracks();
        void send(new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' }));
      };
      rec.onerror = () => fail('transcription');
      recorderRef.current = rec;
      rec.start();
      setState('listening');
    } catch (e) {
      // NotAllowedError / SecurityError = permission denied; anything else = unsupported/hardware
      const name = (e as DOMException)?.name;
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'unsupported');
    }
  }, [state, send, fail, stopTracks]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // triggers onstop -> send()
    } else if (state === 'requesting') {
      // permission prompt still open / recorder not created yet — cancel the
      // pending start so the mic doesn't go live after the user pressed stop.
      cancelRef.current = true;
    }
  }, [state]);

  const reset = useCallback(() => {
    setError(null);
    if (state !== 'unsupported') setState('idle');
  }, [state]);

  return { state, error, start, stop, reset, supported: state !== 'unsupported' };
}
