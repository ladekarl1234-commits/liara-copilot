'use client';

import { useCallback, useEffect, useState } from 'react';

// Optional "🔊 Listen" — reads an answer aloud with the browser's built-in
// SpeechSynthesis (zero cost, no vendor). Never autoplays; the user toggles it.
// ARCH-06: this hook does NOT implement types.ts `TextToSpeechProvider`, and the
// comment that said it did was wrong. The surface here is id-based toggle state
// (`speakingId`/`toggle`) driven by the message list, which no speak/stop provider
// satisfies — a server-TTS swap would be a rework of this hook and its call site
// in Chat.tsx, not a drop-in. The unused interface should be deleted with it.

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // code fences — don't read code aloud
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images -> label
    .replace(/\[\d+\]/g, '') // citation markers
    .replace(/[#*_>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True once the voice list is known AND it contains a voice for `want`. */
export function pickVoice(voices: SpeechSynthesisVoice[], want: 'fa' | 'en') {
  return voices.find((v) => v.lang?.toLowerCase().startsWith(want));
}

export function useTts() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  /** Carries the message id so the note renders next to the button that failed. */
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    setSupported(ok);
    if (!ok) return;
    const synth = window.speechSynthesis;
    // Chrome returns [] from getVoices() until `voiceschanged` fires, so reading it
    // once on first click always misses. Subscribe and cache instead (UX-10).
    const read = () => setVoices(synth.getVoices());
    read();
    synth.addEventListener('voiceschanged', read);
    return () => {
      synth.removeEventListener('voiceschanged', read);
      synth.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  const toggle = useCallback(
    (id: string, text: string, lang: 'fa' | 'en' = 'fa') => {
      if (!('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      if (speakingId === id) {
        synth.cancel();
        setSpeakingId(null);
        return;
      }
      synth.cancel();
      setError(null);
      const voice = pickVoice(voices, lang);
      if (!voice) {
        // No matching OS voice: speaking anyway produces silence and the button
        // just flips back, which reads as "the app is broken". Say why instead.
        setError({
          id,
          message:
            lang === 'fa'
              ? 'سیستم شما صدای فارسی نصب‌شده ندارد؛ خواندن پاسخ ممکن نیست.'
              : 'صدای انگلیسی روی سیستم شما نصب نیست.',
        });
        return;
      }
      const u = new SpeechSynthesisUtterance(stripMarkdown(text));
      u.voice = voice;
      u.lang = voice.lang;
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => {
        setError({ id, message: 'خواندن پاسخ با خطا متوقف شد.' });
        setSpeakingId((cur) => (cur === id ? null : cur));
      };
      setSpeakingId(id);
      synth.speak(u);
    },
    [speakingId, voices],
  );

  return { supported, speakingId, toggle, stop, error };
}
