// Dev diagnostics: in-memory ring buffer of the last 50 pipeline traces.

export interface PipelineTrace {
  requestId: string;
  /** assistant message id — join key to request_metrics and feedback (EP-OBS-01) */
  messageId?: string;
  /** how the turn ended (EP-OBS-04) */
  outcome?: string;
  /** 'model' | 'fallback' — silent planner degradation is otherwise invisible (EP-OBS-02) */
  planRoute?: string;
  /** whether claim verification ran, and what it found (EP-OBS-03) */
  verified?: boolean;
  unsupportedClaims?: number;
  ts: string;
  message: string;
  plan?: unknown;
  retrieval?: {
    queries: string[];
    confidence: string;
    chunks: { id: string; score: number; url: string }[];
    latencyMs: number;
  };
  modelRoute?: string;
  actualModel?: string; // provider-reported model that served (openrouter/free routes dynamically)
  usage?: { inputTokens: number; outputTokens: number };
  totalLatencyMs?: number;
  error?: string;
}

const MAX = 50;
const buffer: PipelineTrace[] = [];

export function recordTrace(t: PipelineTrace): void {
  buffer.push(t);
  if (buffer.length > MAX) buffer.shift();
}

/** Last n traces, most recent first. */
export function lastTraces(n: number = MAX): PipelineTrace[] {
  return buffer.slice(-n).reverse();
}

/**
 * The (redacted) user message for a given requestId, or undefined if it has
 * already scrolled out of the ring buffer. messageId === requestId (EP-OBS-01),
 * so this is what /api/feedback uses to resolve a thumbs-down back to the
 * question it answered (EP-PRD-04) without a second index.
 */
export function findTraceMessage(requestId: string): string | undefined {
  return buffer.find((t) => t.requestId === requestId)?.message;
}
