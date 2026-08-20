# ADR 0001 — Application stack: TypeScript + Next.js modular monolith

**Status:** Accepted (Phase I)

## Context

One team, one product surface (a chat website), a background index build, and a
requirement to stay deployable on Liara as a single container. The stack must
serve SSR/streaming UI and API routes, be Persian/RTL-capable, and keep clear
module boundaries for future growth without operational sprawl.

## Decision

A **TypeScript modular monolith on Next.js 15 (App Router, `output: standalone`)**
with React 19 + Tailwind v4. Server logic lives in `src/lib/*` modules
(retrieval, ai, speech, agent, security, state, obs) behind typed contracts in
`src/types.ts`; API routes are thin. zod validates all external inputs and
model outputs.

## Alternatives considered

- **Separate SPA + standalone API server.** Two deploy units, CORS, duplicated
  types — no benefit at this size.
- **Remix / SvelteKit / plain Node+Express.** Comparable capability; Next gives
  streaming SSE, file routing, and a first-class standalone build that maps
  cleanly to one Liara app. No measured retrieval/UX advantage to switching.
- **Microservices / event bus.** Explicitly rejected as stack theater (amendment
  §Avoid stack theater) — no scale requirement justifies the operational cost.

## Evidence

- `npm run build` → standalone bundle, first-load JS ~103 kB shared; `/` 202 kB.
- 183 unit/integration tests run in ~3.3 s; typecheck clean.
- Module boundaries are real: swapping the LLM provider (ADR 0005) and adding
  voice (ADR 0006) touched only their modules + config, not the pipeline.

## Consequences

Single build/deploy; shared types eliminate a class of integration bugs;
in-process state is a documented single-instance ceiling (ADR 0007).

## Trade-offs

A monolith couples release cadence of UI and indexing; acceptable now, and the
index build is already a separable script (can become a worker — ADR 0002).

## Revisit when

Indexing or retrieval needs its own scaling profile, or a second product surface
(e.g. a Liara-account API service) appears.
