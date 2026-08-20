# Deployment (future — not executed in this phase)

Phase 1 is explicitly local-only (NFR10): no real Liara deployment has been
performed. This document describes what a future deployment would look like
given what's already prepared in the repo (`Dockerfile`, `liara.json`,
`.env.example`), and states plainly what has not been done.

## Services needed

One service: a single Docker application running the Next.js standalone
server. No queue, no separate worker, no database service — retrieval is a
local index shipped inside the image, sessions/feedback/gaps are process-
local (`docs/ARCHITECTURE.md` — Persistence). An **optional** Liara disk
could later hold `data/` (index + runtime JSONL) if the "rebuild without a
new image" strategy below is adopted; `liara.json` does not declare one
today.

## Environment variables — production

Same table as [README.md](../README.md#environment-variables), with secrecy
called out:

| Variable | Secret? | Production note |
|---|---|---|
| `AI_BASE_URL` | no | e.g. `https://ai.liara.ir/api/v1/<workspace>` — create the workspace at console.liara.ir → AI |
| `AI_API_KEY` | **yes** | inject via the platform's secret/env manager, never commit it |
| `AI_MODEL_FAST` / `AI_MODEL_SMART` | no | model identifiers, not secrets |
| `AI_EMBEDDINGS_MODEL` | no | set only if shipping a vector-enabled index (see below) |
| `VERIFY_CLAIMS` | no | leave `on` in production — see `docs/COST.md` |
| `MODEL_TIMEOUT_MS` / `MODEL_MAX_RETRIES` | no | tune to the provider's actual latency |
| `COST_INPUT_PER_MTOK` / `COST_OUTPUT_PER_MTOK` | no | set to get `estimated_cost` in metrics |
| `RATE_LIMIT_RPM` | no | tune to expected traffic per instance (single-instance bucket, see below) |
| `TRUST_PROXY` | no | **set to `on` on Liara** — the platform LB overwrites `x-forwarded-for`, so per-client rate limiting needs it. Default `off` is fail-closed: a directly-exposed server would otherwise let a spoofed header mint a fresh bucket per request. |
| `MAX_INPUT_CHARS` / `MAX_BODY_BYTES` | no | leave at defaults unless a specific need arises |
| `DOCS_DIR` / `INDEX_DIR` / `RUNTIME_DIR` | no | filesystem paths; `RUNTIME_DIR` should point at a writable, ideally persistent, location |
| `DIAG_ENABLED` | no | **leave unset** in production — defaults to off (see checklist) |
| `NODE_ENV` | no | `production` — already set by the Dockerfile |

## Build & start commands

```bash
npm run build     # next build
npm start          # next start
```

Or via Docker (`Dockerfile`, multi-stage: `deps` → `build` → `runner`,
`node:24-alpine`):

```bash
docker build -t liara-copilot .
docker run -p 3000:3000 --env-file .env liara-copilot
```

`liara.json` declares `platform: docker`, `port: 3000`, and points at the
same `Dockerfile` — this is the config a real Liara PaaS app deployment would
read; it has not been applied to a real account in this phase.

## Health endpoint contract

`GET /api/health` (`src/app/api/health/route.ts`) returns **200 when the index
is loaded** and **503 when it is not**, with the detail in the body:

```json
{
  "status": "ok" | "degraded",
  "index": { "loaded": true, "chunkCount": 3746, "builtAt": "..." },
  "aiConfigured": true,
  "version": "0.1.0"
}
```

The index is required to answer anything, so a missing/version-mismatched index
is a genuine failure → **HTTP 503**, which fails the Docker `HEALTHCHECK`
(`wget -qO- http://127.0.0.1:3000/api/health || exit 1`, also in `liara.json`)
and triggers an orchestrator restart. **Keyless mode is still healthy (200):**
`aiConfigured:false` only means no AI provider env vars are set — the app
degrades to grounded source listings, which is intentional, not a failure. So
`status:'degraded'` + 503 signals a broken index specifically, never merely a
missing API key.

## Index initialization strategies

**Current (baked at image build)** — the only one actually implemented.
`Dockerfile`'s `build` stage runs `npm run sync-docs && npx tsx
scripts/build-index.ts` with no `AI_*` build args declared, so the image
**always** ships a **lexical-only** index regardless of what's set at
runtime — there is no build-arg/secret plumbing in the Dockerfile for
`AI_EMBEDDINGS_MODEL`/`AI_BASE_URL`/`AI_API_KEY` today. To ship a
vector-enabled image, `data/index` would need to be built out-of-band (`npm
run index` locally or in CI, with those three vars set) and `COPY`'d into
the runner stage in place of the current build step — the Dockerfile would
need a small edit to support this; it is not wired up now.

**Future (disk + rebuild job)** — point `INDEX_DIR` at a mounted persistent
disk and run `npm run index` as a separate scheduled or manually-triggered
job against that disk, independent of image deploys. This avoids rebuilding
the image just to refresh the docs corpus, at the cost of needing a disk and
a job runner. Not implemented; `liara.json` declares no disk today.

## Model key provisioning

Via the Liara AI product: create a workspace at `console.liara.ir` → AI,
then set `AI_BASE_URL=https://ai.liara.ir/api/v1/<workspace-id>` and
`AI_API_KEY` to the workspace's key (documented in `.env.example`). The
`ModelProvider` abstraction (`docs/DECISIONS.md` D4) is not Liara-specific —
the same two variables work against OpenRouter, Ollama, or OpenAI, so a real
deployment isn't locked to Liara AI specifically even though it's the
recommended default.

## Production checklist

- `NODE_ENV=production` (already set in the Docker runner stage).
- `DIAG_ENABLED` left unset (defaults to off in production —
  `config().diagEnabled = !isProd` unless explicitly overridden) so
  `/api/diag` 404s and internal pipeline traces are not publicly exposed.
- `RATE_LIMIT_RPM` tuned to expected per-instance traffic — the limiter is
  in-memory and per-process (`docs/DECISIONS.md` D5-style ceiling; not
  shared across replicas).
- `AI_API_KEY` provisioned via the platform's secret manager, not baked into
  the image or committed to `.env`.
- Log shipping: metrics/logs are structured JSON lines on stdout
  (`src/lib/obs/log.ts`); production needs whatever the deployment target
  provides to capture stdout (Liara's own log viewer, or an external
  shipper) — nothing in this repo writes logs to disk.
- Confirm the index actually built successfully before traffic is routed —
  given the health-check caveat above, this currently means checking
  `/api/health`'s JSON body manually or in a startup script, not just
  trusting container health status.

## What we did NOT do in this phase, and why

- **No real Liara account connection or deployment.** Explicitly out of
  scope for Phase 1 (project brief); `LiaraProvider` is mocked
  (`docs/ARCHITECTURE.md`, `docs/SECURITY.md`) and `liara.json`/`Dockerfile`
  are prepared but unexecuted against a real account.
- **No build-time wiring for a vector-enabled Docker image.** The lexical
  baseline is what's evaluated and what the challenge asks to be measured
  honestly (`docs/EVALUATION.md`); adding embeddings requires a real key at
  build time, which isn't available in this phase, so the Dockerfile wasn't
  extended to plumb it through untested.
- **No persistent disk / multi-instance session or rate-limit store.**
  Single-instance ceilings are documented in code (`docs/DECISIONS.md` D5)
  rather than solved, since nothing in this phase runs more than one
  instance.
- **No healthcheck-driven auto-restart on degraded index.** The `/api/health`
  body distinguishes `ok`/`degraded` but the HTTP status doesn't, so
  container-level health checks can't currently detect a missing index on
  their own — noted above as a concrete gap for whoever wires up real
  orchestration.
