import { describe, it, expect } from 'vitest';
import { redactSecrets } from '@/lib/security/redact';

describe('redactSecrets (AC-SEC-002)', () => {
  it('redacts a secret env assignment but keeps the key', () => {
    expect(redactSecrets('API_KEY=abcdef12345')).toBe('API_KEY=[REDACTED]');
    expect(redactSecrets('OPENROUTER_API_KEY: sk-or-verylongsecret')).toBe('OPENROUTER_API_KEY: [REDACTED]');
    expect(redactSecrets('PASSWORD="s3cr3tvalue"')).toBe('PASSWORD="[REDACTED]"');
  });

  it('redacts the password inside a connection string, preserving structure', () => {
    expect(redactSecrets('DATABASE_URL=postgres://user:password@host:5432/db')).toBe(
      'DATABASE_URL=postgres://user:[REDACTED]@host:5432/db',
    );
    expect(redactSecrets('redis://admin:hunter2@cache:6379')).toBe('redis://admin:[REDACTED]@cache:6379');
  });

  it('redacts a bearer token', () => {
    expect(redactSecrets('Authorization: Bearer abc123DEF456ghi')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('is idempotent (already-redacted text is unchanged)', () => {
    const once = redactSecrets('API_KEY=abcdef12345');
    expect(redactSecrets(once)).toBe(once);
  });

  it('leaves ordinary text, commands, and short prose values untouched', () => {
    expect(redactSecrets('deploy my next.js app to liara')).toBe('deploy my next.js app to liara');
    expect(redactSecrets('the secret: it works now')).toBe('the secret: it works now'); // value <4 chars
    expect(redactSecrets('run npm run build then liara deploy')).toBe('run npm run build then liara deploy');
  });

  it('handles empty / falsy input', () => {
    expect(redactSecrets('')).toBe('');
  });
});
