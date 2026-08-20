# Security Review — Round 001 (commit 67caf52)

Judge: security-reviewer · Owns: Security / reliability / monitoring (50)
Mode: DEGRADED keyless (aiConfigured:false). Model-prose defenses marked theoretical.

## Score: 41 / 50

| Subarea | Assessment |
|---|---|
| Prompt-injection fencing | Strong: `sanitizeFences` applied to user msg (orchestrator:76,157), state and evidence blocks; `<user_data>`/`<evidence>` DATA framing + INJECTION_FENCE. Instruction-obedience injection remains model-dependent (theoretical, needs key). |
| Markdown / XSS | Cleared. react-markdown v10, no rehype-raw (raw HTML escaped), default urlTransform strips `javascript:`/`data:` (proven). Links get rel=noopener noreferrer nofollow + target=_blank. |
| Input / body limits | Cleared. Byte cap on the stream (413 proven), zod message/sessionId validation, trim+min+max. |
| Rate limiting | Partial. IP-only key, per-key-before-global ordering, global backstop. Weakness: trusts leftmost X-Forwarded-For with no IP validation — safe ONLY if Liara LB overwrites XFF (unverified). |
| Secret leakage | Cleared. API key only in Authorization header; never echoed in errors/logs; log replacer strips secret-named keys at depth; no config import in client components. |
| Error handling / stack traces | Cleared. Canned user messages, typed error taxonomy, no stack to client. |
| Diag gating | Cleared. `/api/diag` 404 in prod (proven), gated by diagEnabled. |
| Unauth write surface | `/api/feedback` accepts arbitrary sessionId/messageId + 2KB comment, appends unbounded to feedback.jsonl and poisons gap analytics (proven 204 with forged session). |
| Dependencies | 3 high-severity (postcss path traversal, sharp/libvips CVEs) via next. |
| CSP | Weak: `script-src 'self' 'unsafe-inline'`, no object-src/nonce — defeats CSP XSS mitigation as defense-in-depth. |

See structured findings for reproductions and evidence.
