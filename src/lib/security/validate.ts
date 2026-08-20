// Input validation at the trust boundary. All messages here are safe to show
// to end users (no echoed input, no internals).

import { z } from 'zod';
import { config } from '@/lib/config';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const sessionIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{8,40}$/, 'invalid session id');

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new ValidationError(r.error.issues[0]?.message ?? 'invalid input');
  }
  return r.data;
}

export function parseChatRequest(body: unknown): { sessionId?: string; message: string } {
  const schema = z.object({
    sessionId: sessionIdSchema.optional(),
    message: z
      .string({ required_error: 'message is required', invalid_type_error: 'message must be a string' })
      .transform((s) => s.trim())
      .pipe(
        z
          .string()
          .min(1, 'message must not be empty')
          .max(config().MAX_INPUT_CHARS, `message exceeds ${config().MAX_INPUT_CHARS} characters`),
      ),
  });
  return parse(schema, body);
}

export function parseFeedback(body: unknown): {
  sessionId: string;
  messageId: string;
  verdict: 'helpful' | 'not_helpful' | 'not_solved';
  comment?: string;
} {
  const schema = z.object({
    sessionId: sessionIdSchema,
    messageId: z.string().min(1, 'messageId is required').max(100, 'messageId too long'),
    verdict: z.enum(['helpful', 'not_helpful', 'not_solved'], {
      errorMap: () => ({ message: 'verdict must be helpful, not_helpful or not_solved' }),
    }),
    comment: z.string().max(2000, 'comment exceeds 2000 characters').optional(),
  });
  return parse(schema, body);
}
