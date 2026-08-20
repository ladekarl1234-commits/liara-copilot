# Round-002 Deployment Review (commit 1c35583)

Judge: Deployment (Deployment 40). Docker CLI unavailable in this env — no real
`docker build` run; real Liara deploy is **PENDING**. Findings below are from
source + live server (:3000, 3746-chunk index) inspection.

## Verified round-1 fixes (hold)
- **DEPLOY-004** `outputFileTracingRoot: import.meta.dirname` → `.next/standalone/server.js`
  present on disk. Dockerfile `CMD ["node","server.js"]` resolves. PASS.
- **DEPLOY-005** `/api/health` returns **503** when index missing, **200** keyless.
  Code (route.ts:26) + tests/health.test.ts:20 assert it. Live: `200 status:ok`. PASS.
- `public/` exists (`.gitkeep`), Dockerfile `COPY ... public` works. PASS.
- `liara.json` sets `TRUST_PROXY=on`; matches config.ts default-off fail-closed. PASS.
- `.dockerignore` excludes `data`; index is built in-stage (Dockerfile:16) and
  inter-stage `COPY --from=build /app/data/index` is unaffected by dockerignore. PASS.

## Findings

### DEPLOY-201 (P2) — DEPLOYMENT.md health contract contradicts shipped code
`docs/DEPLOYMENT.md:58-82,148-152` still documents the PRE-fix behavior:
"**always returns HTTP 200**", "the HTTP status code never changes", "container-level
health checks can't currently detect a missing index". The code (route.ts:26) and
liara.json/Dockerfile healthchecks now DO fail (503) on missing index (DEPLOY-005).
An operator following this doc would build an unnecessary body-parsing healthcheck
workaround and would distrust a health signal that is actually correct — the exact
opposite of the shipped behavior. Stale doc on the deployment-readiness surface.
Fix: rewrite the "Health endpoint contract" + "What we did NOT do" health items to
state 503-on-missing-index.

### DEPLOY-202 (P2) — Image build hard-depends on external GitHub repo, no fallback/pin
`Dockerfile:16` runs `npm run sync-docs` which `git clone --depth 1
https://github.com/liara-cloud/docs` (sync-docs.mjs:6,17, `stdio:'inherit'`, throws
on failure). Every image build requires build-time network AND that repo being
reachable at that exact path & unauthenticated. If the repo is renamed/moved/rate-
limited or the Liara build network restricts egress, the ENTIRE deploy aborts at
build with no committed-docs fallback and no pinned commit (non-reproducible corpus).
DEPLOYMENT.md never states "build needs internet + git". Fix: document the build-time
network/git requirement; consider pinning a commit or vendoring a docs snapshot as
fallback.

### DEPLOY-203 (P3) — RUNTIME_DIR is ephemeral; feedback/gaps lost every redeploy
`data/runtime` is created in the image (Dockerfile:28); feedback (feedback/route.ts)
and gaps (gaps.ts:24-31) append JSONL there. liara.json declares **no disk**, so all
feedback/gap telemetry is wiped on every restart/redeploy. This IS documented
(DEPLOYMENT.md:14-16,35,144) as a known ceiling, so severity is low — but for a
product whose "documentation-gap" learning loop is a scored feature, ephemeral storage
means that signal never accumulates in prod. Writers fail-open (catch+warn once), so
a read-only FS won't crash. Fix: declare a Liara disk mounted at RUNTIME_DIR, or state
the telemetry-loss consequence explicitly in the checklist.

### DEPLOY-204 (P3) — LIARA_DOCS_REPO undocumented
sync-docs.mjs:6 reads `LIARA_DOCS_REPO` to override the docs source, but it is absent
from `.env.example` and `src/lib/config.ts`. An operator wanting a fork/mirror (the
mitigation for DEPLOY-202) cannot discover the knob. Fix: add to .env.example.

## What breaks when the real Liara deploy begins
1. Nothing in the tested code paths blocks a build; the highest risk is DEPLOY-202
   (external clone failure aborts build).
2. Operators trusting DEPLOYMENT.md's health section (DEPLOY-201) will misconfigure
   or mis-trust the healthcheck.
3. First real deploy: feedback/gaps telemetry will silently not persist (DEPLOY-203).

## Not verified (needs docker)
Real `docker build -t liara-copilot .` end-to-end (multi-stage, in-image index build,
runner user perms, busybox wget healthcheck). Docker CLI absent here. Deploy = PENDING.
