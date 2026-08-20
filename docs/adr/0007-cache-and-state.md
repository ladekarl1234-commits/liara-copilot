# ADR 0007 — Cache & conversation state: in-memory now, Keyv-compatible later

**Status:** Accepted (Phase I)

## Context

The app needs conversation state (per session), rate-limit buckets, and answer
caching. Phase I runs as a single instance; the design must not preclude a shared
backend when the app is scaled horizontally.

## Decision

- **Conversation state:** in-memory **LRU** (cap 5,000, TTL 24 h). Server always
  mints the session id; a client-supplied id is never adopted (security).
- **Answer cache:** in-memory FAQ map for stateless, verified, high-confidence
  first-turn answers only (never caches personalized/troubleshooting answers).
- **Rate limit:** in-memory token buckets (per-IP + a global spend backstop).
- All three sit behind narrow functions (`getOrCreateSession`/`applyPatch`,
  `answerCache`, `consume`) so a **Keyv-/Redis-compatible** store is a drop-in
  swap with the same contract — no call-site changes.

## Alternatives considered

- **Redis/Keyv from day one.** Correct for a fleet, premature for a single
  instance — adds a required service and connection handling with no Phase-I
  benefit. The contracts are shaped for it.
- **Cache grounded answers globally without gating.** Rejected — would serve a
  personalized or low-confidence answer to another user. Only verified,
  high-confidence, stateless first-turn Q&A is cached.

## Evidence

- Cache hit path makes **zero** model calls (cost tests + `orchestrator`).
- Rate-limit tests prove per-IP bucketing survives sessionId rotation and the
  global backstop caps spend (`tests/route-chat.test.ts`, `security.test.ts`).

## Consequences

No external dependency to run; correctness (no cross-user leakage) is enforced by
the cache-eligibility rule, not by the store.

## Trade-offs

Single-instance ceiling: state/cache/limits are per-process, so a horizontal
fleet needs the shared store before it is correct across nodes. This is the one
explicit scaling prerequisite (see `docs/ARCHITECTURE.md` §Scaling).

## Revisit when

The app is scaled beyond one instance, or session durability across restarts is
required → move the three stores to Redis/Keyv behind the existing functions.
