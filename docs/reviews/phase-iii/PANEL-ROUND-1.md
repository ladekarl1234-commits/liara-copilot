# Liara Copilot — Final Panel Report

**Verdict up front:** the system is production-shaped but not production-correct. It is well engineered on the axes that do not face the user (security, headers, validation, streaming plumbing, deploy config) and unreliable on the axis the product exists for: giving a correct, grounded answer to a Liara question. A live deployment that fabricates database hostnames, refuses questions whose answer is sitting in its own index, and served the literal string `User Safety: safe` as an answer to ~15% of turns is not shippable.

---

## 1. Scoreboard

| Criterion | Max | Score | % |
|---|---:|---:|---:|
| Answer quality and correctness | 80 | 33.0 | 41.3% |
| UI and user experience | 55 | 31.5 | 57.3% |
| Agentic capabilities and personalization | 50 | 25.0 | 50.0% |
| Security, reliability and monitoring | 50 | 46.0 | 92.0% |
| Deployment (40) + Cost optimization (25) | 65 | 44.0 | 67.7% |
| — Deployment | *40* | *28.0* | *70.0%* |
| — Cost optimization | *25* | *16.0* | *64.0%* |
| **TOTAL** | **300** | **179.5** | **59.8%** |

Three of five criteria are below 60%. The one criterion at 92% is the one whose failures nobody sees.

---

## 2. Findings — merged, de-duplicated, sorted by points lost

Merged IDs are shown as `R-nn (source ids)`. Points are the sum of what the contributing judges deducted.

| # | ID | Sev | Title | Lost |
|---:|---|---|---|---:|
| 1 | R-01 (AQ-02, AQ-05) | critical | False refusal on questions whose answer is in the shipped index | 14.0 |
| 2 | R-02 (AG-01, AG-05, AG-08) | critical | Low-evidence branch ignores persisted workflow / hypothesis ledger | 11.0 |
| 3 | R-03 (AG-02, COST-01) | critical | Safety-classifier text served as an answer, then permanently cached | 10.0 |
| 4 | AQ-01 | critical | Fabricated Postgres host and port — will not connect | 10.0 |
| 5 | R-04 (AQ-03, AG-10) | critical | Extreme non-determinism on identical input | 7.0 |
| 6 | R-05 (AQ-06, UX-CITE-01) | high | Citation markers dangle, go missing, or point at unrelated pages | 6.5 |
| 7 | R-06 (AQ-09, AG-04) | high | Language bleed in both directions, incl. mid-conversation flips | 6.0 |
| 8 | AQ-04 | high | liara.json answer invents fields + harmful .gitignore advice | 5.0 |
| 9 | DEPLOY-01 | high | Docker/Liara target silently builds a lexical-only index | 4.0 |
| 10 | AG-03 | high | Workflow checklist never advances | 4.0 |
| 11 | R-07 (SEC-RL-01, COST-02) | medium | In-memory rate limit + single-flight are per-isolate, so both are inert at scale | 4.0 |
| 12 | AQ-08 | medium | Troubleshooting ignores the pasted error text | 3.0 |
| 13 | AQ-07 | medium | Answering the system's own clarifying question produces a refusal | 3.0 |
| 14 | DEPLOY-02 | high | /api/health cannot detect the one failure worth detecting | 3.0 |
| 15 | UX-RTL-01 | critical | Inline code spans reorder in Persian prose — commands in wrong order | 3.0 |
| 16 | UX-MOB-01 | high | Header brand text overlaps the new-chat button on 360/390px | 2.0 |
| 17 | AQ-10 | medium | Wrong cron field description + RAG plumbing leaked to users | 2.0 |
| 18 | AG-06 | medium | Repeats advice the user completed or explicitly excluded | 2.0 |
| 19 | DEPLOY-03 | medium | No rollback story anywhere in the repo | 2.0 |
| 20 | COST-03 | medium | "Measured cost per turn" is never measured, and unobservable in prod | 2.0 |
| 21 | UX-VOICE-01 | high | Mic offered on a deployment with no STT; 503 reported as "try again" | 1.5 |
| 22 | DEPLOY-04 | medium | DEPLOYMENT.md contradicts itself and the code in four places | 1.5 |
| 23 | AQ-11 | low | Thin stub answer + invented example values in code comments | 1.0 |
| 24 | AG-07 | medium | Raw `<next_step>` prompt scaffolding rendered to the user | 1.0 |
| 25 | AG-09 | low | context.platform overwritten instead of merged | 1.0 |
| 26 | UX-RTL-02 | high | `dir="auto"` on the user bubble is dead — English logs render RTL | 1.0 |
| 27 | UX-SPEED-01 | medium | 6.1s dead tail after the visible answer completes | 1.0 |
| 28 | DEPLOY-05 | medium | Node version unpinned on both targets, no vercel.json | 1.0 |
| 29 | SEC-CSP-01 | low | CSP allows `script-src 'unsafe-inline'` with no nonce | 1.0 |
| 30 | UX-A11Y-01 | medium | reduced-motion leaves composer/chips invisible up to 778ms | 0.75 |
| 31 | UX-INPUT-01 | medium | 8,000-char silent truncation of pasted logs | 0.75 |
| 32 | UX-RTL-03 | medium | Verification note has no dir handling, and is untranslated English | 0.5 |
| 33 | UX-HYDRATE-01 | medium | 5.6s pre-hydration window where the UI silently swallows input | 0.5 |
| 34 | UX-MOB-02 | low | Enter always submits; no multi-line input on mobile | 0.5 |
| 35 | UX-POLISH-01 | low | Latin digits in sources summary; unlabeled retrieval pills | 0.5 |
| 36 | SEC-LOG-01 | low | Provider error response body logged verbatim | 0.5 |
| 37 | COST-04 | low | Evidence block sent twice per turn, budgeted in chars not tokens | 0.5 |
| 38 | SEC-INJ-01 | low | Injection front door is a regex allowlist; encoded attacks rely on the model | 0.0 |

Findings account for **118.5** of the **120.5** points deducted. See §4.

---

### Detail

**1. R-01 (AQ-02 + AQ-05) — critical — False refusal on questions whose answer is in the shipped index — 14.0**
`POST /api/chat` with *"How do I connect a Django app on Liara to a managed Liara PostgreSQL database?"* → `"I couldn't find a reliable answer to this in the official Liara docs…"`; same for the Persian form. `data/index/chunks.json` holds **22 chunks** from `paas/django/how-tos/connect-to-db/postgresql/` containing the exact psycopg2 + DATABASES snippet; retrieval never surfaced it in three attempts (top citations were `dbaas/about`, `dbaas/restore-using-console`). Same pattern language-conditioned: *"What is the default port that Liara PaaS expects my app to listen on?"* → refusal, `CITE: NONE`, reproduced twice — while the Persian equivalent answered correctly with `process.env.PORT` cited to `paas/nodejs/how-tos/deploy-app/`. 170 chunks mention PORT. *"مقدار رم پلن Standard"* → refused, though `paas/details/plans/hardware-plans/` with the RAM table is indexed. *"How do I roll back to a previous deployment?"* → refused.
**Fix:** the corpus is Persian-only and English queries are being lexically matched against Persian text — translate/expand English queries to Persian terms before retrieval, or embed both. Separately, the entity extractor already resolves `platform=django, database=postgresql`; wire that into retrieval as a hard filter/boost on the matching `connect-to-db` URL before lexical scoring. The confidence gate is firing on a language mismatch, not a knowledge gap.

**2. R-02 (AG-01 + AG-05 + AG-08) — critical — Low-evidence branch ignores persisted session state — 11.0**
Turn 1 answers end with *"Next step: … confirm and I'll guide you to the next step."* Turn 2 = *"What is the next step?"* → the canned refusal, byte-identical, **6/6 independent sessions**, len=182, stages `[understanding, searching, checking]` with no `answering`. At that moment state carries `workflow ['w1:current','w3:pending',…]` and `context {platform:'django'}`. Same collapse in troubleshooting: after a genuinely good 3-turn diagnostic loop, *"No. I said I already did that. Next."* → refusal, *"Still nothing. Next hypothesis."* → the identical refusal, while h4/h5 sat `untested` in the persisted ledger. Ambiguity: only 1 of 4 vague inputs got a clarifying question (*"I get an error."*); *"It is broken."* and *"Set it up for me."* got the docs refusal.
**Fix:** `orchestrator.ts:326-346` branches off the *freshly planned* object, so a persisted `session.workflow` / `session.troubleshooting` never reaches the rescue. Test the persisted ledger before emitting `CANNED.insufficient`. Route `plan.intent==='ambiguous'` and any sub-6-token turn with unresolved anaphora to the clarify handler **before** the retrieval confidence gate.

**3. R-03 (AG-02 + COST-01) — critical — Safety-classifier text served as an answer, then permanently cached — 10.0**
Two coupled defects with one visible symptom. (a) Four independent live reproductions plus 1/12 in a batch: the complete assistant answer was the 17-char string `User Safety: safe`. `src/lib/config.ts:47-52` documents exactly this — the `openrouter/free` alias routes to `nvidia/nemotron-3.5-content-safety:free` — and says the default was pinned away from it; the **deployed** instance still exhibits it, so the Vercel env overrides `OPENROUTER_MODEL`. (b) `verify.ts:32-33` returns `{checked:false, unsupportedCount:0}` when `answer.length < 200`, and the cache-write guard at `orchestrator.ts:442` tests only `v.unsupportedCount === 0` — so the shortest, least-trusted answers bypass the only quality gate and are cached with no TTL. Seven consecutive requests to *"What is the liara.json platform field?"* returned `User Safety: safe` across ≥4 distinct `x-vercel-id`s at 598ms/661ms/726ms — sub-second times prove cache service — each with a full citations event attached to four real doc URLs.
**Fix:** correct `OPENROUTER_MODEL`/`AI_MODEL_FALLBACKS` in the Vercel prod env to the pinned benchmarked model. Change the guard to `v.checked && v.unsupportedCount === 0` (one token). Add an output guard: discard and retry any completion matching `/^\s*User Safety:/` or under ~40 chars with no citations, and never cache below a minimum length / citation count.

**4. AQ-01 — critical — Fabricated Postgres host and port — 10.0**
*"اتصال به دیتابیس PostgreSQL در برنامه‌های Django"* returned a settings.py block plus a table asserting `DATABASE_HOST | postgresql.liara.ir`, `DATABASE_PORT | 5432`, with `'OPTIONS': {'sslmode':'require'}` and `CONN_MAX_AGE: 60`. Citations were `dbaas/about` (×2) and `dbaas/restore-using-console` — none contain any of it. The authoritative page (HTTP 200, indexed) uses `POSTGRESQL_DB_HOST/PORT/USER/NAME/PASS` with the worked example `bromo.liara.cloud:30334`. `postgresql.liara.ir` does not exist. A user copy-pasting this gets a connection timeout. Adjacent fabrications from the same question across runs: an invented PostgreSQL "API Key" with `psql -h <your-api-key>`, and the CLI command `liara dbaas show <database-id>` — enumerating every `liara <cmd>` in the whole corpus yields no `dbaas` subcommand.
**Fix:** gate free-text generation on retrieval — if no chunk from the platform×database intersection is in context, refuse. Hard rule: host/port/credential values must be quoted from a chunk, never synthesized.

**5. R-04 (AQ-03 + AG-10) — critical — Extreme non-determinism — 7.0**
Four runs of the same Django/Postgres question produced: a flat refusal; a Persian answer inventing `postgresql.liara.ir:5432`; a Persian answer inventing an "API Key" and `psql -h <api-key>`; an English answer inventing `liara dbaas show`. Twelve fresh sessions with the identical 502 prompt produced answer lengths **17, 68, 68, 103, 138, 233, 435, 644, 691, 699, 1070, 1431** chars, in two languages, latency 3.4s–43.3s; three were a bare "please paste the error" with no hypotheses.
**Fix:** temperature 0 on the answer call, deterministic retrieval ranking (stable tie-break on chunk id), and a fixed model rather than a free-tier fallback list resolving to different providers per request. Until this is fixed no eval suite can certify any answer.

**6. R-05 (AQ-06 + UX-CITE-01) — high — Citation system broken on the majority path — 6.5**
Two failure modes. (a) Dangling/wrong markers: `[4]` cited with 2 citations present; `[2]` cited 5× with 1 present; a bare empty `[1]`; the broken markdown `[منابع](1) [2] [3]`; and for *"برنامه‌ام کار نمی‌کند"* the citations were `one-click-apps/activepieces`, `one-click-apps/about`, `ai/getting-started/svelte` — none about reading logs. Inline links `/paas/disks/create` and `/paas/details/plans/about` both 301. (b) Rendering: across 9 live turns, **5 returned every citation with `n:null`**, which makes `Markdown.tsx:99-101` build an empty map so the marker plugin no-ops and `Sources.tsx:35` drops the badge — zero inline markers, unnumbered list. `Sources.tsx:28` auto-opens only when `citations.length <= 2`, so the common 3–5 source turn ships **collapsed** (verified `{srcOpen:false, srcN:3, markers:0}` three times). 6 of 20 citation URLs carried no `#:~:text=` fragment. Net: on the majority path there is no claim→source mapping and two clicks to any source.
**Fix:** assign `n` server-side to every emitted citation so the plugin can never no-op; strip or renumber any `[n]` exceeding the array length; drop citations that contributed no sentence instead of padding to three; open `<details>` up to ~5 sources; fall back to a heading anchor when no text fragment is computable.

**7. R-06 (AQ-09 + AG-04) — high — Language bleed in both directions — 6.0**
12 identical **English** prompts: indices 0, 2, 3 replied entirely in Persian. `state.language` flipped `en→fa` at turn 4 of two separate all-English threads, and the turn-4 reply was the Persian refusal. A Persian 502 question returned English scaffolding (*"⚠️ This isn't directly covered in the official docs…"*, *"Tell me what you find and I'll narrow down the next step."*) wrapped around Persian hypotheses; *"Does Liara support Kubernetes clusters?"* returned a wholly Persian refusal. Agentic side-channels are hardcoded Persian regardless: the workflow event for an English Django session is `{"goal":"استقرار پروژه روی لیارا",…}`, and English-session hypotheses render as `"برنامه به پورت درست … گوش نمی‌دهد"`. Plus typos `دجنگو`, `اگرFramework`, and RTL-mangled `` After `app--`, you must provide your app ID ``.
**Fix:** pin `state.language` from turn 1 for the session instead of re-detecting per turn (short follow-ups carry no language signal). Key every canned string off it. Localize workflow/hypothesis seed templates by `plan.language`. Normalize `--app` so RTL reordering does not render it as `app--`.

**8. AQ-04 — high — liara.json answer invents fields and gives harmful advice — 5.0**
*"liara.json چیست و چه فیلدهایی دارد؟"* lists `buildpack` and `services` as fields and states *"این فایل حساس است و باید در gitignore قرار گیرد"*. Live fetch of the cited `paas/liarajson/` (HTTP 200): `"platform"`=1, `"port"`=1, `healthCheck`=1, `buildpack`=**0**, `"services"`=**0**. The 67 indexed chunks for that URL carry headings `فیلد app`, `فیلد platform`, `فیلد port` — the real field list was retrieved and ignored. Gitignoring liara.json breaks Git-based deploys, which read platform/port from it.
**Fix:** constrain the answer to headings present in context; add a contradiction check that flags any asserted field name absent from every cited chunk.

**9. DEPLOY-01 — high — Docker/Liara target silently builds a lexical-only index — 4.0**
Proven, not inferred. Running the real modules under the Dockerfile build stage's environment (`env -u OPENROUTER_API_KEY -u AI_API_KEY -u AI_BASE_URL -u AI_EMBEDDINGS_MODEL -u LLM_MOCK npx tsx gate.ts`): `AI_EMBEDDINGS_MODEL default = "baai/bge-m3"`, `localModelId(m) = null`, `cfg.aiConfigured = false`, `build-index embeds? = false`. The Dockerfile declares no ARG/ENV for AI keys and `.dockerignore` excludes `.env`, so the image ships the lexical-only index that DEPLOYMENT.md itself calls "a 16-point hit@1 regression that must not ship by accident" — and it does not fail loudly, contradicting the doc's "The build FAILS on a no-network builder; it does not silently fall back." `COPY --from=build /app/.cache/transformers` copies an empty dir. At runtime `retrieval/index.ts:100` guards the model-mismatch check on `fs.existsSync(embPath)`, so no vectors ⇒ no error ⇒ container reports healthy while serving degraded retrieval.
**Fix:** add `ARG/ENV AI_EMBEDDINGS_MODEL=local:` to the build stage, or COPY the committed `data/index` into the runner and drop the in-image build. Make `build-index.ts` fail loudly when the model names a provider model with no provider configured. Then actually run `docker build .` once.

**10. AG-03 — high — Workflow checklist never advances — 4.0**
`sessionId judge-wf-001`: turn 1 `["w1:current","w3:pending","w4:pending","w6:pending","w7:pending"]`; after two *"What is the next step?"* turns, **identical**; on turn 4 the ids silently change schema to `["1:current","2:pending",…]`. In another thread the user wrote *"Ok I did that. What is the next step?"* and no step was marked done.
**Fix:** mark the current step complete on affirmative progress signals and when the next-step handler fires — `triedActions` already carries that signal. Make step ids stable so the recall path cannot re-mint `1..5`.

**11. R-07 (SEC-RL-01 + COST-02) — medium — Per-isolate state makes both cost controls inert at scale — 4.0**
The rate limiter (`buckets = new Map()`, `globalBucket`) and the single-flight dedup map are module-level. A 26-request probe fired 429 at request 23 *within one instance*, but Vercel fans concurrent load across isolates, each with its own fresh 20-rpm bucket and its own 200-token global backstop — effective cap `20×N` / `200×N`. Measured directly: 4 simultaneous identical novel questions → 4 distinct `x-vercel-id`s, **4 distinct answers**, 4 full plan+answer+verify pipelines and 4 embedding calls paid. 10 sequential health requests hit 10 distinct isolates. DEPLOYMENT.md discloses the ceiling honestly; COST.md's savings table does not.
**Fix:** move both behind a shared store (Vercel KV / Upstash) keeping the existing `consume()` and Map interfaces, or delete the single-flight machinery on this target and stop counting it as a saving. Document that the real spend guard on Vercel is currently the provider account limit.

**12. AQ-08 — medium — Troubleshooting ignores the pasted error text — 3.0**
*"دیپلوی من با این خطا شکست خورد: Error: Cannot find module 'express'"* → *"پیکربندی یا متغیرهای محیطی برنامه نادرست است"*, *"وابستگی یا سرویس موردنیاز در دسترس نیست"*, *"لاگ‌ها علت را نشان می‌دهند"*. `CITE: NONE`. The state event shows `knownError` captured the full string, so it was parsed then discarded. The identical three-hypothesis template appeared verbatim for an unrelated Laravel 502.
**Fix:** match the error string against a small pattern table (MODULE_NOT_FOUND, ECONNREFUSED, 502, worker timeout) and retrieve the matching fix-common-errors page before falling back to the template.

**13. AQ-07 — medium — Answering the system's own clarifying question produces a refusal — 3.0**
Turn 1 asked *"نام برنامه و پلتفرم انتخابی‌تان را بگویید"*; turn 2 (same sessionId + state) *"بله ساختم، اسمش myapp است و پلتفرم Next.js"* → full refusal. The user answered exactly what was asked and hit a dead end.
**Fix:** when the previous turn was a clarification request, retrieve against the merged (original question + clarification) text — the reply has no retrievable content alone. Same root as R-02's anaphora problem.

**14. DEPLOY-02 — high — /api/health cannot detect the one failure worth detecting — 3.0**
DEPLOYMENT.md tells operators to check `index.hasVectors true`. Ten live requests across ten distinct `x-vercel-id`s: the key is **absent** from the JSON in all ten (`"hasVectors" in j.index === false`). `health/route.ts` builds the body from `{loaded, chunkCount, builtAt}` only. So the endpoint returns identical `status:"ok"` / chunkCount 3750 for a hybrid index and for the lexical-only image DEPLOY-01 produces. Cold start measured 10,926ms to parse the 25MB index vs ~640–880ms warm, while `liara.json` sets `healthCheck.timeout=5` and the Dockerfile HEALTHCHECK uses `--timeout=5s` with no `--start-period`.
**Fix:** return `hasVectors: Boolean(idx.vectors)` and `embedModel: idx.vectorModel`; return 503/`degraded` when a vector model is configured but no vectors loaded; add `--start-period=60s`.

**15. UX-RTL-01 — critical — Inline code spans reorder inside Persian prose — 3.0**
`globals.css:505` ships `.md :not(pre) > code { direction: ltr; unicode-bidi: embed; }`. Injecting into the live page and reading geometry RTL: source `` ۱) `npm i`، ۲) `next build`، ۳) `liara deploy`. `` renders as **"۱) liara deploy، ۳) next build، ۲) npm i."** — step numbers attached to the wrong commands. With `isolate` the order is correct. Sweep of 7 realistic shapes: **5 of 7 wrong** (option lists, key pairs, numbered command sequences — exactly how a docs assistant writes). The same file already uses `unicode-bidi: isolate` two rules away on `.ctx-chip` and again on `.cite-marker`.
**Fix:** change `embed` → `isolate`. One word.

**16. UX-MOB-01 — high — Header text overlaps the new-chat button on phones — 2.0**
390×844: `brandSub [102,167]` vs `newChat [16,119]` → 17px overlap; 360×740 → 47px overlap. Parent shrinks to 149px but both children are `white-space: nowrap` needing ~186px. `.shell{overflow:hidden}` clips rather than scrolling (`scrollWidth === clientWidth`). `globals.css` contains **zero** width-based media queries.
**Fix:** hide `.brand-sub` below ~480px or ellipsis-truncate the wrapper. Add at least one width media query.

**17. AQ-10 — medium — Wrong cron format + RAG plumbing leaked to users — 2.0**
*"فرمت زمان‌بندی Cron به صورت `دقیقه ساعت روز ماه سال` است"* — the fifth field is day-of-week; the answer's own example `0 0 * * 0` is then explained as "هر یکشنبه", contradicting its stated format. Separately, user-facing prose includes *"(referenced in [1] but not included in the evidence)"* and *"the provided evidence doesn't mention AWS Lambda"*.
**Fix:** quote the doc's own field description instead of restating from memory. Rewrite refusal/uncertainty templates to speak about Liara's docs, never "the provided evidence" or "[1]".

**18. AG-06 — medium — Repeats advice the user completed or excluded — 2.0**
Turn 1: *"Next step: Install Node.js and npm on your Windows machine… nodejs.org"*. Turn 2: *"Ok I did that. What is the next step?"* → refusal. Turn 3: *"And after that?"* → the **verbatim** repeat of step 1. Separately, a prompt stating *"ALREADY verified the app binds 0.0.0.0:$PORT. Do not repeat any of those."* was answered with *"Confirm your app reads $PORT and binds to it."*
**Fix:** diff the candidate next step against `context.triedActions` and the last emitted `next_step`; on match, take the following pending workflow step or next untested hypothesis.

**19. DEPLOY-03 — medium — No rollback story — 2.0**
`grep -i "rollback\|vercel alias\|promote\|revert" docs/DEPLOYMENT.md README.md specs/phase-iii-vercel.md` → **zero matches across all three files**. The Deploy section is four lines ending at `vercel --prod`. No `vercel.json`. This matters more than usual: `data/index/` is committed, so a code rollback also rolls the index back — a desirable property that is never stated, so an operator has no idea whether reverting a commit is safe.
**Fix:** add a Rollback section covering `vercel rollback`/promote-previous, state the code+index coupling, and pin an image tag for the Docker target.

**20. COST-03 — medium — "Measured cost per turn" is never measured — 2.0**
`estimatedCostUsd` is only computed when `COST_INPUT_PER_MTOK`/`COST_OUTPUT_PER_MTOK` are set; nothing in the repo sets them and `.env.example` leaves both commented. `benchmarks/models/bakeoff-2026-08-22.json` rows carry ttftMs/totalMs/citationRate/score — **zero token or cost fields**. `/api/diag`, `/internal`, `/api/internal`, `/api/metrics`, `/api/version` all 404 in prod (correct for security, but it means COST.md's "recorded … never assumed" cannot be checked). The only cost statement in the repo is "per-answer LLM cost is $0 on the free tier" — a consequence of a `:free` slug, not a measurement.
**Fix:** set the per-MTok env vars in prod, run the eval suite once against a paid model, commit the real per-turn token/cost table. Cheapest: extend the bakeoff harness to record usage alongside latency.

**21. UX-VOICE-01 — high — Mic offered with no STT backend, and the error tells users to retry — 1.5**
`POST /api/voice/transcribe` → 503 `{"code":"voice_unavailable"}`. `/api/health` says nothing about voice. `Chat.tsx:150` gates the mic only on `voice.supported`, which is pure browser MediaRecorder capability. Driving the live page with a fake mic device and permission granted: recording completes, network log shows the 503, and `useVoice.ts:96` (`const code = res.status === 422 ? 'empty' : 'transcription'`) discards the server code, so the user sees *"تبدیل گفتار به متن ناموفق بود؛ دوباره امتحان کنید"* — an invitation to retry something that can never succeed, after granting mic access. The correct string already exists at `useChat.ts:49` and is unreachable from this path.
**Fix:** report voice availability from `/api/health` and hide the mic; map `voice_unavailable` to the existing copy.

**22. DEPLOY-04 — medium — DEPLOYMENT.md contradicts itself and the code — 1.5**
(a) Healthcheck: one section says 503 fails the Docker HEALTHCHECK and triggers restart; another says "No healthcheck-driven auto-restart… the HTTP status doesn't [distinguish]". The code settles it (`status: index.loaded ? 200 : 503`) — the second bullet is stale and tells operators a working healthcheck is broken. (b) Stale counts: doc says chunkCount 3746 / embeddedCount 3744; reality is 3750 / 3748. (c) Embeddings default: Target A says `baai/bge-m3`, Target B says `local:Xenova/multilingual-e5-small` — only the first is true, and the stale one is the assumption behind DEPLOY-01. (d) COST.md recommends `openrouter/free`, which `config.ts:45-47` and `.env.example:4` explicitly forbid — and R-03 is live evidence that route was taken in production.
**Fix:** delete the stale healthcheck bullet, refresh the counts, delete the Target B claim, delete the COST.md `openrouter/free` recommendation.

**23. AQ-11 — low — Thin stub + invented values in code comments — 1.0**
The disk question returned two leading blank lines, two vague steps, a 301 inline link, a code fence containing only `/var/www/html/public/uploads`, and a trailing bare `[1]`. The otherwise-faithful object-storage answer added `// e.g. https://<bucket>.storage.iran.liara.site` and `region: "default", // required by SDK, value is ignored by Liara` — the cited chunk contains only the placeholder `LIARA_ENDPOINT=https://<Liara Bucket Endpoint>` and says nothing about region.
**Fix:** suppress answers below a minimum grounded-content threshold in favour of clarification; forbid invented example values in code comments where the source uses a placeholder.

**24. AG-07 — medium — Prompt scaffolding rendered to the user — 1.0**
Streamed delta text was literally `<next_step>\nInstall Node.js and npm on your Windows machine…\n</next_step>`, passed straight to the markdown renderer.
**Fix:** strip known scaffold tags in the delta post-processor, or stop instructing the model to emit tags the renderer does not consume.

**25. AG-09 — low — context.platform overwritten rather than merged — 1.0**
T1 `{platform:"django", product:"paas"}` → T2 `{product:"dbaas"}` — platform gone after one DBaaS-flavoured turn, and absent for T3/T4. Every later personalization decision runs without the stack the user stated.
**Fix:** merge the per-turn statePatch into `session.context`; clear a field only on explicit contradiction.

**26. UX-RTL-02 — high — `dir="auto"` on the user bubble is dead — 1.0**
`<article className="msg-user" dir="auto"><h2 className="sr-only">پیام شما</h2>{m.text}</article>` — direction resolves from the first strong character *in the element*, which is the sr-only Persian heading, so it is always RTL. Live: a pasted English stack trace computed `ltr` in the composer and `{dirAttr:"auto", computedDir:"rtl", firstChild:"H2"}` in the bubble, rendering right-aligned. The code comment at `Chat.tsx:144-145` states `dir=auto` exists precisely so "pasted English error logs and commands must render LTR".
**Fix:** move the sr-only heading outside the `dir=auto` element, or wrap the text in its own `<span dir="auto">`.

**27. UX-SPEED-01 — medium — 6.1s dead tail after the answer completes — 1.0**
`lastDelta 15038ms → done 21147ms` (6109ms); second sample 5997ms; others 3782/1581/975ms. During the window `Chat.tsx:130` blocks submit, a Stop button sits where Send should be, `answered` is gated on `m.done` so listen/feedback controls are absent, and `showStage` is false so there is no indicator either. Browser-confirmed at 17606ms: `{stop:true, len:714, actions:false}` with text unchanged since 15096ms.
**Fix:** emit a `text_done` event (or drop `streaming` on the last delta) and keep a lightweight indicator for the trailing verification pass.

**28. DEPLOY-05 — medium — Node unpinned on both targets — 1.0**
No `engines` field, no `.nvmrc`, no `.node-version`, no `vercel.json`. Vercel uses whatever its current default is, drifting silently; the Dockerfile pins only the floating `node:24-alpine`. Two targets, two undeclared, drifting runtimes. (`package-lock.json` is committed and `npm ci` is used — credited, not deducted.)
**Fix:** add `"engines": {"node": ">=24 <25"}` + `.nvmrc`, and pin the Dockerfile to a digest.

**29. SEC-CSP-01 — low — CSP allows `script-src 'unsafe-inline'` — 1.0**
Verified on `GET /` and `/api/health`: `default-src 'self'; script-src 'self' 'unsafe-inline'`. No nonce emitted despite Next.js supporting nonce-based CSP. Provides no defense against inline-script XSS if a sink were ever introduced.
**Fix:** per-request nonce via middleware; drop `'unsafe-inline'`.

**30. UX-A11Y-01 — medium — reduced-motion hides the composer and chips up to 778ms — 0.75**
`globals.css:158-166` zeroes `animation-duration` but never `animation-delay`, and the `animation: none !important` kill-list at `:1020` omits the two elements whose animation is an *inline* style (`Chat.tsx:331` `.6s ease .55s both`, `:334` `.75s`). With `fill-mode: both` the element holds `opacity:0` through the delay. rAF timeline with `reducedMotion:'reduce'`: composer invisible **562ms**, chips **778ms**, while headline and logo are visible immediately.
**Fix:** add `animation-delay: 0s !important` to the reduced-motion block.

**31. UX-INPUT-01 — medium — silent 8,000-char truncation of pasted logs — 0.75**
Inserting 14,100 chars on the live page: `{pasted:8000, maxLength:8000, counter:"۸٬۰۰۰ از ۸٬۰۰۰ نویسه", sendDisabled:false}`. 6,100 characters dropped with no toast or mark; the counter reads "at the limit", not "we deleted the second half", and the real error line in a log is usually near the end. Send stays enabled.
**Fix:** drop `maxLength`, let the value exceed the cap (`tooLong` already disables Send), and show an explicit over-limit message.

**32. UX-RTL-03 — medium — verification note has no dir handling, and is English — 0.5**
`Chat.tsx:245` `.note` has no dir attribute and no CSS rule, inheriting `rtl` from `<main>`. Live probe `{dir:"rtl", hasDirAttr:false}`; the dark-mode screenshot shows *"…NS settings for domains .purchased through Liara"* — sentence-final period at line start. The note is also untranslated English inside an all-Persian UI.
**Fix:** wrap in `<bdi>` / `dir="auto"`, and translate verification notes before they reach the UI.

**33. UX-HYDRATE-01 — medium — 5.6s pre-hydration window that swallows input — 0.5**
Slow-3G + 4× CPU: composer painted @3342ms, first responds @8966ms. The fully-styled SSR shell is on screen with no `disabled`, no skeleton, no spinner; Enter and chip taps do nothing. A run that went offline after DOMContentLoaded left the page permanently inert with no error surfaced.
**Fix:** render the SSR send button and chips disabled/`aria-busy`, re-enable on hydration.

**34. UX-MOB-02 — low — Enter always submits; no multi-line on mobile — 0.5**
`Chat.tsx:136` submits on unmodified Enter; soft keyboards have no Shift, so a newline can never be typed — directly at odds with the pasted-log use case. `{enterKeyHint:null, inForm:false}` — the composer is a plain `<div>`, so keyboards show a generic return key. Sub-44px targets not covered by the `pointer:coarse` block: chips (38px), theme toggle (40×40).
**Fix:** wrap in `<form onSubmit>` with `enterKeyHint="send"`; add `.chip`/`.theme-toggle`/`.new-chat` to the coarse-pointer rule.

**35. UX-POLISH-01 — low — Latin digits and unexplained retrieval pills — 0.5**
`Sources.tsx:29` renders "منابع (3)" with Latin digits while the live region on the same turn announces "۳ منبع" and the counter shows "۸٬۰۰۰". `Chat.tsx:399-403` renders raw retrieval context chips ('DNS', 'Next.js', 'PaaS') as bare non-interactive pills between the answer actions and the composer with no caption.
**Fix:** use `faNum`; label or remove the context pills.

**36. SEC-LOG-01 — low — provider error body logged verbatim — 0.5**
`provider.ts:168-169` throws `provider error ${res.status}: ${text}` where `text = await res.text()`, and the route logs `chat_failed {message: e.message}`. The log replacer strips secret-**named** keys only, not free text inside `message`, so anything the upstream echoes lands unredacted.
**Fix:** truncate and run `redactSecrets()` over the body, or log only status + category.

**37. COST-04 — low — evidence sent twice, budgeted in the wrong unit — 0.5**
`MAX_EVIDENCE_CHUNKS = 8; MAX_EVIDENCE_CHARS = 7000`, injected into the answer prompt and again into verify (`VERIFY_CLAIMS` defaults on). The corpus is Persian-dominant (~2–2.5 chars/token vs ~4 for English), so 7000 chars is ~2800–3500 input tokens, paid twice — by far the largest per-turn input line, bounded by characters and, per COST-03, never measured.
**Fix:** budget in tokens (`estimateTokens()` already exists) and reuse the answer call's tokenized evidence for verify.

**38. SEC-INJ-01 — low — regex allowlist front door — 0.0**
15 live attacks (EN/FA/FR ignore-instructions, DAN, direct exfil, transform, spaced letters, fullwidth unicode, base64, log-embedded SYSTEM, grandma, fence-escape): **zero leaks**. The base64 payload passed the deterministic detector and was stopped only by the model's own refusal. 10 legitimate trigger-word questions: **0/10** false positives. Not deducted — the `<user_data>` fence is the real control.
**Fix (optional):** an output-side sentinel check would make exfil resistance model-independent.

---

## 3. Top 10 highest-leverage fixes

Ranked by points recoverable ÷ risk of the change.

| # | Fix | Recovers | Risk |
|---:|---|---:|---|
| 1 | **Set `OPENROUTER_MODEL` in the Vercel prod env to the pinned model** (`config.ts:16`), removing the safety-classifier route | ~5–7 (R-03, plus a chunk of R-04's variance) | Zero code. Env var. Do this before reading further. |
| 2 | **`orchestrator.ts:442`: `v.checked && v.unsupportedCount === 0`** — stop caching unverified answers | ~3–5 (R-03) | One token. Cannot regress anything. |
| 3 | **`globals.css:505`: `embed` → `isolate`** | 3.0 (UX-RTL-01) | One word, A/B verified against the shipped page. Fixes command ordering in Persian prose. |
| 4 | **Temperature 0 + deterministic retrieval tie-break** | ~7 (R-04) and it makes every other fix verifiable | Config-level. Nothing can be certified until this lands. |
| 5 | **Route the low-evidence branch through persisted `session.workflow` / `session.troubleshooting`** before `CANNED.insufficient` | ~8–11 (R-02) | The branch already exists at `orchestrator.ts:326-346`; it reads the wrong object. Localized diff, huge agentic payoff. |
| 6 | **Rewrite anaphoric/short follow-ups into a standalone query (summary + context.platform) before the confidence gate** | ~3–5 (AQ-07, part of R-02) | Contained, and it is what makes the whole multi-turn contract work. |
| 7 | **Translate/expand English queries to Persian before retrieval** (the corpus is Persian-only) | ~5–8 (R-01) | Medium — needs an eval re-run — but it is the single largest quality lever in the report. |
| 8 | **Assign `n` server-side to every citation; strip out-of-range `[n]`; open `<details>` up to 5 sources** | ~6.5 (R-05) | Small, purely presentational + one server field. Restores the product's core verifiability claim. |
| 9 | **Pin `state.language` for the session; localize workflow/hypothesis templates** | 6.0 (R-06) | Small. Removes the most embarrassing user-visible defect class. |
| 10 | **Add `hasVectors`/`embedModel` to `/api/health` and make `build-index.ts` fail loudly on a provider model with no provider** | ~7 (DEPLOY-01 + DEPLOY-02) | Small, and it is the difference between a silent 16-point retrieval regression and a build failure. |

Not in the top 10 but nearly free: the hard retrieval filter on `platform×database` (AQ-01/R-01), and the `animation-delay: 0s !important` one-liner (UX-A11Y-01).

---

## 4. Where the panel may be wrong

**Scored from code, not from live evidence:**
- `DEPLOY-01` (4.0) was proven by running the build gate under a *simulated* Docker-stage environment. **No containerized build was ever run** — not by the judge, not by the repo (DEPLOYMENT.md admits this). The inference chain is strong and each link is verified, but the failure was never observed in an actual image.
- `SEC-RL-01` / `R-07`'s scale bypass was reasoned from a module-level `Map` plus a single-instance 429 probe. **Nobody demonstrated >20 rpm from one IP** by driving parallel isolates. The deployment judge's 4-way burst hitting 4 distinct `x-vercel-id`s corroborates it indirectly; that is the strongest evidence the panel has.
- `SEC-CSP-01`, `SEC-LOG-01`, `COST-04`, `AG-09`, `UX-RTL-02` (the `dir=auto` mechanism), `AG-01`'s root cause and `COST-01`'s root cause are all source reads. Most were confirmed by a live symptom; `SEC-LOG-01` and `COST-04` were not — no probe forced a provider error, and no token count was ever measured.

**Judges disagree:**
- **Django → database.** AQ reports the flagship cross-service question as refused or hallucinated in every attempt. The agentic judge got a *correct, grounded* Django→DBaaS answer at turn 2 of conversation A2 (settings.py `DATABASES` with `MYSQL_DB_*` env vars, `django-db-connection-pool`). Most likely explanation is R-04 (non-determinism) plus a different retrieval path when the platform is already in session context — which, if true, means AQ-02's "retrieval never surfaces it" is really "retrieval surfaces it inconsistently, and worse on a cold session". The 9-point deduction may be 2–3 points too harsh; the fix is the same either way.
- **Language bleed severity.** UX treated it as a polish issue (part of a 3/8 Persian-quality deduction); the agentic judge scored it `high` at 4.0. Both are describing the same defect at different altitudes; the merged 6.0 may double-count by ~1.5.

**Non-determinism contaminates the single-sample findings.** With answer length varying 17→1431 chars on identical input, any finding drawn from one or two runs — `AQ-04` (liara.json), `AQ-10` (cron), `AQ-11` (disk stub), `AG-07` (`<next_step>` leak) — could be a sampled artifact rather than a stable defect. They should be re-run after fix #4 before anyone spends engineering time on them.

**The whole quality score is confounded by the model routing.** ~15–20% of live turns were served by a content-safety classifier rather than a chat model. **No judge re-ran the suite with the model pinned.** The 33/80 for answer quality is a measurement of the *deployed configuration*, which is the right thing to score for a deployed system — but it is not a measurement of the system's ceiling. Fixes #1 and #4 could move that number materially in either direction, and until they land nobody knows which.

**Arithmetic honesty.** Findings account for **118.5** points; the criteria deducted **120.5**. The residual ~2 points are subscore-level judgements (register clash in placeholder copy, refusal-correctness rubric, "no dashboard" partial credit) that no judge attached to a discrete finding. The total is not padded, and it is not rounded up.

**One structural double-charge to be aware of:** R-03 costs 10 points across two criteria for what may be a single wrong environment variable. If fix #1 alone resolves it, roughly 10 points move at once — meaning the realistic post-fix ceiling on today's code, with no other work, is around **190/300**. That is still a failing grade for a documentation assistant.