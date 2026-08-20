# Deployment Readiness Review — Round 001

**Judge:** Deployment (owns Deployment 40)
**Commit:** 67caf52
**Verdict:** changes required — one build-breaking defect
**Real Liara deploy:** PENDING by design. Docker NOT available in this env, so
`docker build` was not executed; findings below are proven by source + a real
local `next build` and filesystem inspection.

## Score: 31/40

| Subcriterion | Assessment |
|---|---|
| Dockerfile quality (multi-stage, non-root, healthcheck) | Strong structure, but **runner stage COPY of a nonexistent `public/` breaks the build** (DEPLOY-001) |
| liara.json correctness | port/env/healthCheck correct; **no persistent disk** (DEPLOY-003) |
| Health endpoint contract | 200-always is a defensible LB choice; degraded index never triggers restart — documented (DEPLOY-005) |
| .env.example vs config.ts completeness | Excellent — every env var in config.ts is documented |
| Index bake-in strategy | Regenerates from unpinned `git clone` at build → build-time network dep + evaluated index is not the shipped index (DEPLOY-002) |
| Persistence | Weak — feedback/gaps ephemeral |
| `next build` succeeds | Yes (exit 0, standalone emitted) |
| Secrets hygiene | `.env` git- and docker-ignored; no leak |

## Findings

### DEPLOY-001 (P1, high) — Docker build fails: COPY of nonexistent `public/`
`Dockerfile:26` `COPY --from=build /app/public ./public`. No `public/` dir
exists in the repo, it is not git-tracked, and `next build` does not create one.
Docker `COPY` of a missing source path is a hard error, so the runner stage
fails on the first real `docker build` — i.e. the first Liara deploy.
Evidence:
```
$ find . -maxdepth 1 -name public   -> (nothing)
$ git ls-files public               -> (nothing)
$ find .next/standalone ... -name public -> (nothing)
```
Fix: create a `public/` (even with `.gitkeep`), or drop line 26 / make it
conditional. Docker build not runnable here (docker absent) but COPY-missing is
deterministic.

### DEPLOY-002 (P2, medium) — Shipped index is unevaluated & build depends on network
`.dockerignore` excludes `data`, so the locally-built, evaluated index
(meta.json: chunkCount 3746, docsCommit 31f2ef7) is NOT copied into the image.
`Dockerfile:16` regenerates it via `npm run sync-docs` (`scripts/sync-docs.mjs`:
`git clone --depth 1 https://github.com/liara-cloud/docs`, unpinned HEAD) +
build-index. Consequences: (a) build hard-fails if GitHub is unreachable;
(b) the deployed index tracks docs HEAD at build time, so it can differ from the
artifact the eval numbers were measured against — no docs commit is pinned.
Fix: pin a docs commit (build-arg) or COPY the pre-built `data/index` and drop
the in-image regeneration.

### DEPLOY-003 (P2, medium) — No persistent disk: feedback/gaps lost on every restart
`RUNTIME_DIR=data/runtime` lives on the container's ephemeral fs; `liara.json`
declares no disk. `src/app/api/feedback/route.ts:26` and `src/lib/obs/gaps.ts:24`
append JSONL there. Every redeploy/restart discards all collected feedback and
knowledge-gap signal — the inputs the monitoring/personalization story relies on.
Documented as a known ceiling in DEPLOYMENT.md, which mitigates but does not
resolve it. Fix: declare a Liara disk and point RUNTIME_DIR at it, or accept the
signal loss explicitly.

### DEPLOY-004 (P3, medium) — Standalone layout fragile; CMD assumes /app/server.js
`next.config.mjs` sets `output: 'standalone'` but no `outputFileTracingRoot`.
Local `next build` placed server.js at
`.next/standalone/OneDrive/Desktop/liara/liara-copilot/server.js` because Next
inferred `C:\Users\pro` as the workspace root (stray parent lockfile). Docker's
CMD `node server.js` assumes `/app/server.js`. Clean Docker context (no parent
lockfile) should avoid this, but the layout is context-dependent and unpinned.
Fix: set `outputFileTracingRoot: import.meta.dirname` in next.config.

### DEPLOY-005 (P3, informational) — Healthcheck cannot detect a degraded index
`/api/health` returns HTTP 200 even when `status:"degraded"` (index failed to
load). The Docker/liara healthcheck (`wget ... || exit 1`) only trips on
non-2xx, so a missing index never triggers an orchestrator restart, contradicting
the checklist item "confirm the index actually built". This is thoroughly
documented and is a defensible LB choice (keep a degraded-but-serving instance
up). Left as informational.

## Cleared
- Secrets: `.env`/`.env.local` in `.dockerignore` and gitignored — no image/VCS leak.
- Non-root runtime: `adduser app` + `USER app` + `chown data` present.
- Env docs: `.env.example` covers every var in `config.ts` (diffed by hand).
- `next build`: exit 0, static pages generated, standalone emitted.
- RUNTIME_DIR creation: `mkdir(recursive)` at write time — resilient to missing dir.
- Health path resolution: INDEX_DIR relative to cwd=/app, data/index copied there.

## Reasoning
The submission's DEPLOYMENT.md is unusually honest and pre-discloses DEPLOY-002/
003/005. But honesty about a gap is not readiness: DEPLOY-001 is an undocumented,
deterministic build breakage that the "prepared but unexecuted" framing missed —
the Dockerfile was never actually built. That is the single thing that will break
the real deploy on line one.

## Unverified / PENDING
- Actual `docker build` (docker unavailable here) — DEPLOY-001/002 asserted from
  source + Docker's defined COPY semantics, not an executed build.
- Real Liara platform behavior (disk mount, LB healthcheck semantics, git access
  from the build environment).
