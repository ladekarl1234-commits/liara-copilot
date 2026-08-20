// Speech provider selection. STT is server-side (Soniox); TTS is the browser
// (see src/components/useTts.ts) behind the TextToSpeechProvider contract.
import type { SpeechToTextProvider } from '@/types';
import { config } from '@/lib/config';
import { SonioxSttProvider, SttError } from './soniox';

export { SttError } from './soniox';

let sttSingleton: SpeechToTextProvider | null = null;

/** The configured STT provider, or null when voice is not configured. */
export function getSttProvider(): SpeechToTextProvider | null {
  if (!config().voiceConfigured) return null;
  if (!sttSingleton) sttSingleton = new SonioxSttProvider();
  return sttSingleton;
}

/** test hook */
export function setSttProviderForTests(p: SpeechToTextProvider | null) {
  sttSingleton = p;
}

export function isSttError(e: unknown): e is SttError {
  return e instanceof SttError;
}
