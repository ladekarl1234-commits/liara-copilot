// Redact obvious secrets from user-pasted content BEFORE it is sent to the
// external model or written to disk. The model needs the diagnostic structure,
// not the raw credential — so we preserve shape (KEY=[REDACTED],
// user:[REDACTED]@host).
// Conservative by design: only well-known secret shapes, to avoid mangling
// ordinary text, commands, or code the user actually needs help with.

const PLACEHOLDER = '[REDACTED]';

// A pasted private key — collapse the whole armoured block, not just the body.
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// credentials inside a URL/connection string:  scheme://user:password@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;

// KEY = value  /  KEY: value  /  "KEY": "value"  where KEY names a secret.
// The optional quote BEFORE the separator is what makes the JSON form work
// ({"api_key": "…"}) — without it the closing quote of the key broke the match.
// Value must be >=4 chars so ordinary prose ("secret: it works") is left alone.
const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH[_-]?TOKEN)[A-Z0-9_]*)(["']?\s*[:=]\s*)(["']?)([^\s"']{4,})(["']?)/gi;

// CLI flag form, which the assignment pattern misses when the value is
// SPACE-separated:  `liara login --api-token <token>`. Restricted to a named
// secret flag and a >=8 char value so ordinary flags (`--app myapp`) are safe.
const CLI_FLAG_SECRET =
  /(--?(?:api[-_]?token|api[-_]?key|auth[-_]?token|token|password|passwd|secret)[= \t]+)(\S{8,})/gi;

// Persian assignment form. An explicit : or = is REQUIRED so a legitimate
// question ("رمز عبور دیتابیس را کجا ببینم؟") is not mangled.
const FA_SECRET_ASSIGNMENT =
  /((?:رمز(?:\s*عبور)?|کلمه\s*عبور|گذرواژه|کلید\s*(?:مخفی|api))\s*[:=]\s*)(\S{4,})/g;

// Bare tokens with a well-known issuer prefix — no key/assignment around them,
// which is exactly how they get pasted. Case-sensitive on purpose (AKIA is
// uppercase, sk-/gh?_/xox? are lowercase).
const KNOWN_TOKEN =
  /\b(sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

// Authorization: Bearer <token>   and   "Bearer <token>"
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * Redact secrets while keeping structure. Idempotent (running twice is a no-op
 * on already-redacted text). Returns the input unchanged when nothing matches.
 *
 * ponytail: shape allowlist — its coverage is exactly the set of shapes listed
 * above, so a bare unlabelled credential ("hunter2andmore" in prose) still gets
 * through. An entropy heuristic is the upgrade path if that becomes real; it
 * was not added because it mangles hashes, ids and base64 the user needs help
 * with, which is a worse failure for a docs assistant.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(PEM_PRIVATE_KEY, PLACEHOLDER)
    .replace(URL_CREDENTIALS, (_m, pre, _pw, at) => `${pre}${PLACEHOLDER}${at}`)
    .replace(SECRET_ASSIGNMENT, (_m, key, sep, q1, val, q2) =>
      val === PLACEHOLDER ? `${key}${sep}${q1}${val}${q2}` : `${key}${sep}${q1}${PLACEHOLDER}${q2}`,
    )
    .replace(CLI_FLAG_SECRET, (_m, flag) => `${flag}${PLACEHOLDER}`)
    .replace(FA_SECRET_ASSIGNMENT, (_m, pre) => `${pre}${PLACEHOLDER}`)
    .replace(BEARER, (_m, pre) => `${pre}${PLACEHOLDER}`)
    .replace(KNOWN_TOKEN, PLACEHOLDER);
}
