// Dev diagnostics: in-memory ring buffer of the last 50 pipeline traces.

export interface PipelineTrace {
  requestId: string;
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
