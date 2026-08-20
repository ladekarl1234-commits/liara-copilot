# Voice

Liara Copilot supports **voice input** (speak your question) and an optional
**spoken answer** (read aloud). Speech is decoupled into STT, conversation, and
TTS behind provider abstractions (see ADR 0006).

## Architecture

```
Browser                              Server                    Provider
──────────────────────────────       ──────────────────        ──────────────
MediaRecorder (opus/webm)
  press mic → speak → stop
  POST audio bytes  ───────────────▶ /api/voice/transcribe ──▶ Soniox async STT
                                     (SONIOX_API_KEY, server)   stt-async-v5
  transcript ◀───────────────────── { text, language }         fa/en hints
  (appended to the composer)

Answer text ──────────────────────▶ useTts (SpeechSynthesis)   browser TTS
  🔊 Listen (opt-in)                 fa-IR voice, no autoplay
```

- **STT contract:** `SpeechToTextProvider.transcribe(audio, opts)` →
  `{ text, language? }`. Implementation: `SonioxSttProvider` (`src/lib/speech/`).
- **TTS contract:** `TextToSpeechProvider` (`src/components/useTts.ts`),
  browser `SpeechSynthesis`.
- The `SONIOX_API_KEY` is **server-side only**; the browser sends audio bytes and
  receives text — the key is never exposed.

## Why Soniox (not the browser)

The browser `SpeechRecognition` API is Chrome-only and has unreliable-to-absent
Persian support, routed to Google servers we cannot control. Persian is the
primary language, so STT quality on Persian is the deciding factor. Soniox
provides native Persian STT (`language_hints:["fa","en"]` + language
identification). A GPU-hosted Whisper would also work but stands up a service the
amendment warns against for Phase I. Full rationale + alternatives: ADR 0006.

## Mic UX states

The mic button surfaces explicit states, each with a Persian label and an
`aria-label`:

| State | Meaning |
|---|---|
| `idle` | ready — tap to speak |
| `requesting` | asking for microphone permission |
| `listening` | recording (tap again to stop) — animated pulse |
| `processing` | uploading + transcribing |
| `transcribed` | text inserted into the composer |
| `error` | a failure occurred (message shown, typed text preserved) |

## Graceful failure (never lose typed text)

The transcript is **appended** to whatever is already in the composer, so a mic
failure can never discard typed content (AC-VOICE-002). Each failure maps to a
clear Persian message:

| Failure | Handling |
|---|---|
| Permission denied | message + stays typeable (`NotAllowedError`) |
| Unsupported browser | mic button hidden (`MediaRecorder` absent) |
| Empty recording | "no audio captured, try again" (client + server 400) |
| No speech detected | server 422 → "no speech detected" |
| Transcription failure | server 502 → "try again or type" |
| Network failure | "connection failed, check your connection" |
| Server not configured | 503 → mic still usable, message explains |

## Optional spoken answer

Completed answers show a `🔊 شنیدن` (Listen) control using the browser's built-in
`SpeechSynthesis` — zero cost, no vendor, **no autoplay**, user-controlled, and
it never blocks answer generation. Code fences and citation markers are stripped
before reading. The button is hidden when the browser has no `speechSynthesis`.

## Configuration

```env
SONIOX_API_KEY=...            # required for voice input; server-side only
SONIOX_MODEL=stt-async-v5     # default
SONIOX_BASE_URL=https://api.soniox.com
VOICE_MAX_BYTES=8000000       # reject larger uploads (413)
```

Without `SONIOX_API_KEY`, `/api/voice/transcribe` returns **503
`voice_unavailable`** and the UI keeps working as a text app.

## Tests

`tests/voice-route.test.ts` covers: 503 unconfigured · 200 + transcript ·
400 empty · 422 no-speech · 502 failure · 400 non-multipart. The client hook
(`useVoice`) centralizes state transitions and append-not-replace semantics.

## Observability / privacy

The transcribe route logs bytes, latency, detected language, and transcript
**length** — never the transcript text (user speech content) and never the key.

## Benchmark note

Voice latency depends on the Soniox round-trip and network; it is not part of the
mock load test (which deliberately avoids external calls). With a real
`SONIOX_API_KEY`, transcription latency is observable in the server logs
(`voice_transcribed` `ms`). No Persian WER number is claimed here because none was
measured in-repo — see ADR 0006 for the qualitative basis of the choice.
