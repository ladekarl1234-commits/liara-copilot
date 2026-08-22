# Deployment

Two supported targets. **Vercel** is the live deployment; **Docker/Liara** is
the original target and still builds.

---

## Target A — Vercel (live)

### What makes this deployable at all

The app was written for one long-lived container and took four dependencies
Vercel does not provide. Each is now closed:

| Assumption | Why it breaks on Vercel | Fix |
|---|---|---|
| A 25 MB search index at `data/index/`, gitignored and built by the Dockerfile | A Vercel build is a git checkout; `next build` never ran the indexer, and the tracer cannot see a runtime-computed path. `loadIndex()` threw on every request, `/api/health` → 503 | The index is **committed** (`.gitignore`), and `next.config.mjs` lists its files under `outputFileTracingIncludes['/*']` |
| A 52 MB embedding model fetched from huggingface.co inside the request | Read-only filesystem, no image build stage to bake a cache into, ~10 s per cold isolate — and a truncated cache **aborts the Node process** (exit 127, uncatchable) | Query embeddings come from the provider (`AI_EMBEDDINGS_MODEL=baai/bge-m3`). The WASM stack is excluded from the function bundle |
| `mkdir` + `appendFile` under a relative `data/runtime` | Read-only outside `/tmp`; `/api/feedback` returned **HTTP 500** for every thumbs-up | Feedback is written to stdout (captured by the log drain) and the file append is best-effort |
| Conversation state in a module-level `Map` | With N isolates, ~(N−1)/N of follow-up turns silently start a new conversation | State is carried by the client, **HMAC-signed** (`src/lib/state/portable.ts`). Requires `SESSION_SECRET` |

Two more platform limits are respected rather than discovered at runtime:

- `maxDuration = 60` on `/api/chat` (the Hobby ceiling), with the app's own
  `TURN_BUDGET_MS = 50_000` **inside** it so the app always fails first and can
  report why. The model budgets (`MODEL_CALL_BUDGET_MS = 18_000`,
  `MODEL_STREAM_TIMEOUT_MS = 35_000`) compose to fit.
- `VOICE_MAX_BYTES` defaults to 4 MB on Vercel, under the 4.5 MB the platform
  rejects at the edge — otherwise the app's own "recording too long" message is
  unreachable and the user gets an opaque platform 413.

`TRUST_PROXY` defaults to `on` when `process.env.VERCEL` is set. This is not a
convenience: with it `off`, `clientIp()` returns the literal string `direct` for
every visitor on earth and the whole deployment shares a single
`RATE_LIMIT_RPM` bucket.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | Without it the app still serves sources, but generates no answers |
| `SESSION_SECRET` | **yes** | ≥16 chars. Absent = multi-turn context breaks across isolates. A value shorter than 16 chars is treated as absent, not as weak protection |
| `AI_EMBEDDINGS_MODEL` | no | Defaults to `baai/bge-m3`. **Must** match the model recorded in `data/index/vectors.json` or `loadIndex()` refuses to mix vector spaces |
| `SONIOX_API_KEY` | no | Voice input is disabled without it |
| `DIAG_ENABLED` | no | Leave unset — `/internal` and `/api/diag` are off in production by default |

### Deploy

```bash
vercel link --project liara-copilot
vercel env add OPENROUTER_API_KEY production
vercel env add SESSION_SECRET production      # openssl rand -base64 32
vercel --prod
```

### Verifying a deployment

```bash
curl -s https://<app>.vercel.app/api/health | jq
# expect: status ok, index.loaded true, index.chunkCount 3750, index.hasVectors true
```

A 503 from `/api/health` means the index did not reach the function — check
that `data/index/` is committed and that `outputFileTracingIncludes` still
names the five files `loadIndex()` opens (`chunks.json`, `lexical.json`,
`meta.json`, `vectors.json`, `vectors.bin`).

### Rebuilding the index

```bash
npm run sync-docs                    # pulls liara-cloud/docs
npm run build-index                  # ~14 min, ~$0.01 of embeddings
git add data/index && git commit     # the artifact IS the deployment input
```

`data/index/embeddings.json` is the **incremental build cache**, keyed by chunk
hash so an unchanged chunk is never re-embedded. It is gitignored and never
shipped; the server reads `vectors.bin` instead — 4.1 ms to adopt versus 69.6 ms
to parse the JSON, and 5.2 MB of heap instead of 45.6 MB.

`.gitattributes` marks `*.bin` as binary. Without it a line-ending conversion
would corrupt the matrix on a Windows checkout.

### Known ceilings on this target

- **Rate limiting is per-isolate.** In-memory buckets are not shared, so the
  effective global limit is `RATE_LIMIT_RPM × isolates`. It still stops one
  client hammering one instance; it is not a global spend cap.
- The FAQ answer cache and the single-flight map are also per-isolate, so a
  burst of identical questions can cost more than one pipeline run.
- Both are honest consequences of having no durable shared store on this
  target. The conversation state — the one that was silently corrupting
  user-visible behaviour — is fixed rather than documented.

---

## Target B — Docker on Liara (original target)


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
scripts/build-index.ts` with no `AI_*` build args declared. Since ADR 0008 that
is no longer the same thing as a lexical-only image: `AI_EMBEDDINGS_MODEL`
defaults to `local:Xenova/multilingual-e5-small`, which needs no key, so the
build stage embeds the corpus **provided the build has network access to
`github.com` (docs clone) and `huggingface.co` (model weights, ~90 MB)**.

**The build FAILS on a no-network builder; it does not silently fall back.**
`scripts/build-index.ts` calls `embedPassagesInBatches` unguarded, so a hub
fetch error propagates and `docker build` exits non-zero. That is deliberate —
a lexical-only image is a 16-point hit@1 regression that must not ship by
accident — but it means an air-gapped or restricted builder needs an explicit
opt-out: set `AI_EMBEDDINGS_MODEL=` (empty) for a lexical-only image, or build
`data/index` out-of-band and `COPY` it. On Liara, `liara deploy -b germany`
picks a build location with unrestricted access to both hosts.

**The model cache ships in the image.** The build stage writes it to
`TRANSFORMERS_CACHE=/app/.cache/transformers` and the runner stage copies it.
Without that copy the weights are absent at runtime and Transformers.js fetches
them **inside the first chat request**: measured against the real standalone
artifact, the request sat in the `searching` stage for 100s+, streamed no
answer, and ended only when the client gave up — 5 KB of the model had arrived.
With the cache present the same load measures **766ms once, then 5ms per
embed**. `EMBED_TIMEOUT_MS` (default 10s) is the belt-and-braces bound: past it
the query embed rejects and retrieval degrades to lexical-only for that turn
rather than holding the request open.

Verify after any build: `embeddedCount` in `data/index/meta.json` inside the
image (expected 3744), and that `/app/.cache/transformers` is non-empty.
**Not verified in this repo:** no containerised build has been run —
`embeddedCount: 3744` and the timings above come from host runs.

There is still no build-arg/secret plumbing for
`AI_EMBEDDINGS_MODEL`/`AI_BASE_URL`/`AI_API_KEY`, so a **provider-hosted**
embedding model cannot be used at image-build time. For that, build `data/index`
out-of-band (`npm run index` locally or in CI with those vars set) and `COPY` it
into the runner stage in place of the build step — a small Dockerfile edit that
is not wired up today.

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

## Amendment additions — environment (voice + OpenRouter)

Add to the Liara app environment (server-side; never in the client bundle):

```env
# LLM — OpenRouter Free Router (default)
OPENROUTER_API_KEY=...          # required for generation; server-side only
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
# or a generic OpenAI-compatible provider (overrides OpenRouter):
# AI_BASE_URL=... / AI_API_KEY=...

# Voice — Soniox STT (optional; app runs as text-only without it)
SONIOX_API_KEY=...              # server-side only

# Diagnostics off in production unless explicitly enabled
DIAG_ENABLED=off
```

- Health `/api/health` returns **503** until the index loads; wire it as the
  container health check.
- Load testing uses a mock LLM (`LLM_MOCK=on`) and must never point at real
  OpenRouter — keep quality eval separate and bounded.
- The index (`data/index/`) is built out of band (`npm run index`) and shipped in
  the image or a volume; each app instance loads its own read-only copy.
