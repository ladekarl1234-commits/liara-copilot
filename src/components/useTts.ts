'use client';

import { useCallback, useEffect, useState } from 'react';

// Optional "🔊 Listen" — reads an answer aloud with the browser's built-in
// SpeechSynthesis (zero cost, no vendor). Never autoplays; the user toggles it.
// Implements the TextToSpeechProvider contract so a future server/vendor TTS is
// a drop-in swap.

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

export function useTts() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    setSupported(ok);
    return () => {
      if (ok) window.speechSynthesis.cancel();
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
      const u = new SpeechSynthesisUtterance(stripMarkdown(text));
      const want = lang === 'fa' ? 'fa' : 'en';
      const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(want));
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (lang === 'fa' ? 'fa-IR' : 'en-US');
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
      setSpeakingId(id);
      synth.speak(u);
    },
    [speakingId],
  );

  return { supported, speakingId, toggle, stop };
}
