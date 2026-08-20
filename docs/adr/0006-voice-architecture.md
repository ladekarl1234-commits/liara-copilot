# ADR 0006 — Voice: Soniox STT (server-side) + browser TTS

**Status:** Accepted (Phase I)

## Context

Users must be able to speak a question in Persian and hear answers, with a very
simple mic UX. Persian is the hard part: the browser `SpeechRecognition` API has
inconsistent-to-absent Persian support and is Chrome-only (routed to Google
servers, not controllable). Speech must decouple STT, conversation, and TTS
behind provider abstractions, and any provider key must stay server-side.

## Decision

- **STT: Soniox** (`SpeechToTextProvider` → `SonioxSttProvider`), server-side.
  The browser records with `MediaRecorder` (opus/webm) and POSTs bytes to
  `/api/voice/transcribe`; the server calls Soniox's async file API
  (`stt-async-v5`, `language_hints:["fa","en"]`, language identification) and
  returns the transcript. `SONIOX_API_KEY` never reaches the browser.
- **TTS: browser `SpeechSynthesis`** (`TextToSpeechProvider`, `useTts`) behind a
  `🔊 Listen` opt-in — zero cost, no vendor, no autoplay, prefers a `fa-IR` voice.
- Mic UX exposes explicit states `idle · requesting · listening · processing ·
  transcribed · error` and never discards typed text on failure.

## Alternatives considered

- **Browser `SpeechRecognition` for STT.** Simplest, but unreliable/absent for
  Persian and Chrome-only — fails the primary language. Rejected as the STT path
  (kept conceptually behind the same interface if ever adequate).
- **Self-hosted Whisper/GPU STT.** Strong Persian, but stands up a GPU service
  the amendment warns against for Phase I ("do not introduce an entire GPU
  service merely to show that voice exists"). Deferred; the interface allows it.
- **Paid cloud TTS.** Better voices, but cost + a second key for a feature that
  must not block answering. Browser TTS is sufficient for an opt-in read-aloud.

## Evidence

- Soniox advertises native Persian STT accuracy (soniox.com/speech-to-text/
  persian); chosen for that reason over browser STT.
- `/api/voice/transcribe` verified: 503 when unconfigured, 200 + transcript with
  a provider, 400 empty, 422 no-speech, 502 failure (`tests/voice-route.test.ts`).
- Key stays server-side (route reads `SONIOX_API_KEY`; browser only sends audio).

## Consequences

Voice works in any browser with `MediaRecorder`; TTS degrades gracefully (button
hidden if unsupported). STT is one provider swap away from Whisper/other.

## Trade-offs

A round-trip to Soniox adds latency vs on-device recognition; acceptable for
push-to-talk and worth it for Persian accuracy. Browser TTS voice quality varies
by OS.

## Revisit when

Real-time streaming STT is needed (Soniox WebSocket + temporary keys), or a
self-hosted model is justified by volume/cost, or a better Persian TTS is wanted.
