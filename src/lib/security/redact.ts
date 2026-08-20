// Redact obvious secrets from user-pasted content BEFORE it is sent to the
// external model. The model needs the diagnostic structure, not the raw
// credential — so we preserve shape (KEY=[REDACTED], user:[REDACTED]@host).
// Conservative by design: only well-known secret shapes, to avoid mangling
// ordinary text, commands, or code the user actually needs help with.

const PLACEHOLDER = '[REDACTED]';

// credentials inside a URL/connection string:  scheme://user:password@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;

// KEY = value  /  KEY: value  where KEY names a secret. Value may be quoted.
// Value must be >=4 chars so ordinary prose ("secret: it works") is left alone.
const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH[_-]?TOKEN)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"']{4,})(["']?)/gi;

// Authorization: Bearer <token>   and   "Bearer <token>"
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * Redact secrets while keeping structure. Idempotent (running twice is a no-op
 * on already-redacted text). Returns the input unchanged when nothing matches.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(URL_CREDENTIALS, (_m, pre, _pw, at) => `${pre}${PLACEHOLDER}${at}`)
    .replace(SECRET_ASSIGNMENT, (_m, key, sep, q1, val, q2) =>
      val === PLACEHOLDER ? `${key}${sep}${q1}${val}${q2}` : `${key}${sep}${q1}${PLACEHOLDER}${q2}`,
    )
    .replace(BEARER, (_m, pre) => `${pre}${PLACEHOLDER}`);
}
