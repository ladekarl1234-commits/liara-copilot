# Design

## Why the UI stays a single conversation

`src/components/Chat.tsx` has exactly one input and one message list — no
Ask/Fix/Guide tabs, no mode switch. Intent (`question | troubleshooting |
workflow | ...`) is inferred server-side per message by the plan call and
carried as data on each assistant message (`workflow`/`troubleshooting`
fields on `UIMessage`, `src/components/useChat.ts`); the client renders
whatever the server says is present, it never asks the user to declare a
mode up front. This mirrors the product framing directly: a user has a
problem, not a menu choice.

## Landing state

`Chat.tsx`: when `messages.length === 0`, the page renders a centered,
vertically-offset (`-mt-20`) large composer, a Persian headline ("چطور
می‌تونم در لیارا کمک‌تون کنم؟"), 4 example chips (`CHIPS` const — deploy a
project, fix an error, connect a database, set up a domain — each a full
Persian sentence, not a keyword, so clicking one behaves exactly like typing
it), and a small disclaimer that answers are grounded in docs.liara.ir. Once
the first message is sent, the layout switches to a header + scrollable
message log + fixed composer — the landing state never reappears for that
session.

## Progressive disclosure

- **Sources** (`src/components/Sources.tsx`): a `<details>` element, closed
  by default once there are more than 2 citations, open automatically for 1–2
  — a single grounding source doesn't need a click to see, five do.
- **One diagnostic step at a time**: enforced in the answer prompt itself
  (`answerSystemPrompt` rule 5 in `src/lib/agent/prompts.ts` — "give exactly
  one next diagnostic step and say you'll wait for the result"), not just a
  UI truncation — the model is instructed not to produce a wall of hypotheses
  in prose even though the full ranked hypothesis list is visible in the
  `HypothesisList` panel above the answer text.
- **Workflow steps**: `WorkflowChecklist.tsx` renders every step
  (`done`/`current`/`pending` with ✓/→/○ marks), but the answer prompt (rule
  6) is instructed to fully explain only the current step and just name the
  later ones — the checklist shows the whole plan, the prose stays focused
  on now.

## RTL decisions

- `<html lang="fa" dir="rtl">` at the root (`src/app/layout.tsx`) — Persian
  is the primary language, not a locale variant bolted onto an LTR shell.
- `dir="auto"` on the composer textarea, on user message bubbles, on the
  markdown container, and on individual `<p>`/`<li>` elements
  (`src/components/Markdown.tsx`) — each piece of user- or model-generated
  text picks its own direction from its actual content, so a Persian
  question followed by an English-heavy answer doesn't inherit the wrong
  base direction.
- Code blocks are always `dir="ltr"` (`CodeBlock.tsx`, `.code-block` CSS) —
  code is never direction-inferred, it's always LTR regardless of the
  surrounding RTL page.
- Inline code (`` `code` ``) inside RTL prose gets `direction: ltr;
  unicode-bidi: embed` (`.md :not(pre) > code` in `globals.css`) so a stray
  `DATABASE_URL` inside a Persian sentence doesn't visually reverse.
- URLs and citation lines in `Sources.tsx` are wrapped in `<bdi dir="ltr">` —
  bidi-isolated so a URL never gets its slash-separated segments reordered
  by the surrounding RTL context.
- Context chips (`.ctx-chip` CSS) force `direction: ltr; unicode-bidi:
  isolate` — their content is always an English/technical display name
  (`Next.js`, `PostgreSQL`) even in a Persian UI.

## Typography

**Resolved** (was a known gap; fixed in the D12 redesign). Vazirmatn is now
actually bundled via `next/font/google` (`src/app/layout.tsx`, weights
400/500/700/800, `display: swap`), exposed as `--font-vazir` and consumed by
`--font-sans` in `globals.css`. Because `next/font` self-hosts the files, no
external font host is contacted and the CSP needs no `fonts.googleapis.com`
entry. The fallback stack (`"Segoe UI", Tahoma, ui-sans-serif`) still applies
while the face loads.

## Conversation patterns

- **Stage lines**: while streaming and before the first text delta arrives,
  a single Persian stage line ("در حال درک سوال…" → "جستجو در مستندات
  لیارا…" → "بررسی منابع…" → "آماده‌سازی پاسخ…") shows what the pipeline is
  doing, sourced directly from the server's `stage` SSE events
  (`STAGE_FA` map in `useChat.ts`) — not a generic spinner, and it disappears
  the moment the first delta arrives.
- **Context chips**: a small row above the composer (`contextChips` state,
  populated by the server's `context` event, itself built by
  `contextChips(session)` in `src/lib/state/sessions.ts`) — shows what the
  assistant currently believes about the user's stack (platform, product,
  database, "Troubleshooting" flag) without restating it in prose every
  turn.
- **Workflow checklist / hypothesis ledger**: rendered as dedicated panels
  above the answer text, not folded into markdown — they're structured
  server state (`SessionState.workflow`/`troubleshooting`), not prose the
  model composed, so they can't drift out of sync with what the server
  actually tracks turn to turn.

## Code UX

`CodeBlock.tsx`: a small header bar shows the detected language (from the
fenced-code-block's `language-x` class, via `rehype-highlight`) and a copy
button that swaps to a checkmark for 1.5s on success
(`navigator.clipboard.writeText`, silently no-ops if the clipboard API is
unavailable rather than showing an error for a non-critical convenience
feature). Syntax colors are CSS custom properties (`--hl-*` in
`globals.css`) mapped onto `highlight.js` token classes, defined once for
light and redefined under `prefers-color-scheme: dark` — same mechanism as
the rest of the palette, not a separate theme system for code.

## Mobile behavior

The composer textarea auto-grows up to ~6 rows (`max-height: 10.2rem` in
`.composer textarea`) then scrolls internally; the composer area respects
`env(safe-area-inset-bottom)` (`.composer-area` padding) for iOS home-
indicator clearance. The message column is `max-w-2xl` and centered at all
viewport widths — no separate mobile layout branch, the same single-column
design narrows down naturally. `viewport-fit: cover` is set in
`src/app/layout.tsx`'s `Viewport` export specifically to enable the safe-
area inset variables.

## Accessibility

- Message log: `role="log" aria-live="polite"` (`Chat.tsx`) — new assistant
  text is announced without needing focus to move.
- Every icon-only button carries `aria-label` (send, copy, retry, thumbs
  up/down) — `Composer`, `CodeBlock`, `ErrorBlock`, `Feedback`.
- Feedback buttons use `aria-pressed` to reflect the current verdict state,
  not just a visual `.active` class.
- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`
  — a global, theme-aware focus ring, not suppressed anywhere in the
  stylesheet.
- `@media (prefers-reduced-motion: reduce)` collapses every animation/
  transition duration to 0.01ms globally (`globals.css`) — including the
  streaming-stage pulse dot and all hover transitions.
- Contrast: the light/dark palettes (`--ink`/`--bg`, `--muted`/`--surface`)
  are defined as a small fixed token set reused everywhere rather than
  per-component colors, so a contrast fix in one place applies uniformly;
  `prefers-color-scheme: dark` is the only theme switch (no manual toggle
  exists in this phase).

## Error-state writing

`ErrorBlock` (`Chat.tsx`) renders `role="alert"` with a retry button that
re-sends the last user message (`useChat.retry()` — replaces a trailing
errored assistant message rather than appending a duplicate). Every
`ErrorCode` maps to a specific, actionable Persian/English sentence on both
sides: server-side `errorMessage()` (`orchestrator.ts`, used if the SSE
stream itself carries the error) and client-side `faError()` (`useChat.ts`,
used for network failures the server never got to report, and as the
fallback if a server error code isn't recognized). Neither path ever shows a
raw exception message or stack trace to the user — every user-facing string
is one of the fixed, hand-written copies for its `ErrorCode`.

## Redesign — imported "Liara Chat" design (Claude Design)

The public UI was reskinned from a Claude Design project ("Liara chat interface
design") while keeping the full functional pipeline (SSE, Soniox voice, Sources,
workflow/troubleshooting, TTS, feedback). Ported elements:

- **Palette:** a calmer teal accent (`--accent #149ec4`) with a green→cyan brand
  gradient (`--g1 #7ce3a8` → `--g2 #38c6f4`) used on the send button, stage dot,
  and ambient landing blobs. Full light + dark tokens.
- **Theme:** a light/dark **toggle** (`useTheme`, top-inline-start), persisted to
  `localStorage` and applied as `data-theme` on `<html>`; a no-flash inline
  script in `layout.tsx` sets it before first paint. Default follows the OS.
- **Font:** **Vazirmatn** via `next/font/google` (self-hosted → no external font
  host, so the CSP is unchanged), weights 400/500/700/800.
- **Landing:** brand logo (`public/liara-logo.jpg`) with a glow, headline
  «دیگه لازم نیست، مستندات لیارا رو بخونی!», a rounded composer with a gradient
  send button, four starter chips, and two blurred, slowly-floating gradient
  blobs (motion respects `prefers-reduced-motion`).
- **Chat:** a compact header (logo + brand + a «گفت‌وگوی جدید» reset that starts a
  fresh session via `useChat().reset()`), the message log, and the bottom composer.
- **Voice/mic** states and the **🔊 Listen** control are unchanged in behavior,
  restyled to the new palette (recording mic pulses in the design's red).

The `.dc.html` source was a self-contained mock (browser SpeechRecognition, a
canned answer generator); only its **visual design** was adopted — the real app
keeps Soniox STT, the grounded RAG pipeline, and all Phase-I features.
