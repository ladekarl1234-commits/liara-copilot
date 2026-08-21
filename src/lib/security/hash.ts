import crypto from 'node:crypto';

/**
 * Non-reversible, stable id for logs and on-disk records.
 *
 * The raw session id is a session CREDENTIAL (getOrCreateSession resolves it
 * back to the user's SessionState, whose summary/context feed the answer
 * prompt), and a client IP is PII — neither may be written anywhere a log
 * shipper, backup or support engineer could read and replay it. A 12-char
 * SHA-256 prefix still joins rows across feedback.jsonl / request_metrics /
 * chat_request, which is the only thing the raw value was ever used for.
 *
 * One helper on purpose: every sink that touches a session id must call this,
 * so the next sink cannot quietly forget (EP-SEC-02).
 */
export function hashId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}
