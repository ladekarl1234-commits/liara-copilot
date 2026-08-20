# Architectural decision log

Every material deviation from the challenge master prompt is recorded here with
evidence and trade-offs, per the prompt's mandate.

---

## D1 — Primary knowledge source: `public/llms/**/*.md` (as recommended)

**Decision**: consume the repo's generated LLM markdown, not scraped HTML.
**Evidence**: 1,142 files, clean plain markdown, Persian, each starting with
`Original link: https://docs.liara.ir/...` (e.g. `public/llms/paas/domains/move.md:1`),
enumerated by `public/all-links-llms.txt`. No frontmatter needed — the link
header + path structure carry product/platform metadata.
**Trade-off**: files are generated from MDX; JSX-only content (tab widgets,
videos) is absent. Acceptable: the textual instructions survive conversion.

## D2 — Local MiniSearch index instead of reusing the official MeiliSearch indexer

**Original recommendation**: investigate reusing the existing MeiliSearch
indexer.
**Implemented instead**: local in-process lexical index (MiniSearch) built
from the llms markdown at index time, plus optional vector search.
**Why better**: the official indexer (`indexer/src/crawlers/*.js`) crawls the
LIVE rendered site with Cheerio and pushes to a MeiliSearch server — it
requires network + a MeiliSearch deployment and cannot run offline or in CI.
A local index is reproducible from the cloned repo, has zero infrastructure,
starts in <1s, and is retrieval-eval-measurable.
**Trade-offs**: we re-implement section extraction; MeiliSearch typo tolerance
is replaced by Persian normalization + fuzzy prefix matching in MiniSearch.
**Impact**: accuracy — measured by evals (hit@k) instead of assumed; UX — no
external service to fail; cost — zero infra; complexity — one JSON artifact;
deployment — the index ships with the Docker image or builds at release time.

## D3 — Anchor recovery from MDX `<Section id>` props

**Decision**: deep citation anchors are recovered by parsing the sibling
`src/pages/**/*.mdx` file for `<Section id="..." title="...">` and matching
section titles to headings in the llms markdown.
**Evidence**: anchors on docs.liara.ir are explicitly authored ids rendered by
`src/components/Common/section.js:7-33`, NOT slugified headings; the llms
files do not contain them. The official crawler extracts the same ids from
rendered HTML (`indexer/src/crawlers/paas.js:41-91`).
**Trade-off**: chunks whose heading has no authored id cite the page URL
without an anchor (coverage reported by `build-index`).

## D4 — Provider: OpenAI-compatible HTTP, no SDK dependency

**Decision**: `ModelProvider` speaks the OpenAI chat/embeddings wire format
via `fetch`, configured by `AI_BASE_URL`/`AI_API_KEY`.
**Why**: Liara's own AI product is OpenAI-compatible
(`public/llms/ai/quick-start.md:29-32` → `https://ai.liara.ir/api/v1/<id>`),
as are OpenRouter/Ollama/OpenAI — one small client covers all, keeps secrets
server-side, and drops an SDK dependency. Anthropic-style APIs can be added
behind the same interface later.

## D5 — No database; JSONL + in-memory LRU

**Decision**: sessions in an in-memory LRU (TTL 24h, cap 5,000, no disk
persistence — a restart forgets conversations, which is acceptable for this
phase and stated honestly); feedback/gaps as JSONL under `data/runtime/`;
metrics as structured stdout logs.
**Why**: the prompt demands easy local runs and forbids premature infra.
Nothing here needs transactions or concurrent writers in this phase.
**Ceiling** (marked in code): multi-instance deploys need a shared store —
swap `sessions.ts` for Redis-compatible storage; the interface is 4 functions.

## D6 — Single-agent orchestration, one plan call + one answer call

**Original recommendation space**: "agentic capabilities" scoring.
**Decision**: one orchestrator with a structured plan step, a deterministic
evidence gate, stateful troubleshooting/workflow ledgers — not a multi-agent
swarm. Several conceptual stages (intent, state patch, query planning, next
action) share ONE cheap-model call, exactly as the prompt suggests.
**Impact on cost**: ≤2 model calls per message (+optional verification),
0 for cached FAQs and deterministic clarifications.

## D7 — Verification strategy: gate before streaming, claim-check after

**Original recommendation**: "retrieve → verify evidence → stream".
**Implemented**: deterministic evidence gate BEFORE streaming (confidence from
retrieval scores/coverage — no extra model call, no latency), plus an optional
post-answer claim check (`VERIFY_CLAIMS=on`) that appends corrections and logs
groundedness. Verifying every claim before streaming would serialize two model
calls and destroy perceived latency; the gate blocks the hallucination-prone
case (weak evidence) up front.

## D8 — Vector search optional, lexical-first

**Decision**: the index always builds lexically; embeddings are added only
when `AI_EMBEDDINGS_MODEL` is configured, and hybrid fusion switches on
automatically. Retrieval evals run in both modes.
**Why**: docs and queries are Persian; normalized lexical search over 1,142
curated pages is a strong, zero-cost, zero-latency baseline. The prompt: "If a
simpler local index produces equal or better evaluation results, use the
simpler implementation." Measured, not assumed — see docs/EVALUATION.md.
