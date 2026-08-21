// OpenAI-compatible ModelProvider over plain fetch. Works with Liara AI
// (https://ai.liara.ir/api/v1/<workspace>), OpenRouter, Ollama, OpenAI.
// Server-side only. Bounded retries, hard timeout, typed error taxonomy.

import type { ChatMessage, GenerateOptions, GenerateResult, ModelProvider, Usage } from '@/types';
import type { ErrorCode } from '@/types';
import { config } from '@/lib/config';
import { estimateTokens } from './router';
import { MockLLMProvider } from './mock-provider';

export class ModelError extends Error {
  constructor(
    public code: Extract<ErrorCode, 'model_timeout' | 'model_unavailable' | 'rate_limited'>,
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

/** The CLIENT went away — never an error metric, never a user-facing message. */
export class ClientAbortError extends Error {
  constructor() {
    super('client aborted the request');
    this.name = 'ClientAbortError';
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** don't start another attempt with less than this left on the call budget */
const MIN_ATTEMPT_MS = 1_000;
/** undici surfaces transport faults as TypeError; the cause carries the syscall */
const TRANSPORT = /fetch failed|network|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR/i;

/**
 * A retryable transport fault, as opposed to a programmer/runtime error.
 * `TypeError: AbortSignal.any is not a function` is also a TypeError from the
 * same line, and retrying it costs 3x latency and 3x spend while reporting a
 * deterministic bug as a provider fault (REL-10).
 */
function isTransportError(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  const cause = (e as { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error ? `${cause.message} ${String((cause as { code?: string }).code ?? '')}` : String(cause ?? '');
  return TRANSPORT.test(`${e.message} ${causeText}`);
}

function isAbortLike(e: unknown): e is DOMException {
  return e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export class OpenAICompatibleProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    const cfg = config();
    this.baseUrl = (baseUrl ?? cfg.aiBaseUrl ?? '').replace(/\/$/, '');
    this.apiKey = apiKey ?? cfg.aiApiKey ?? '';
    if (!this.baseUrl || !this.apiKey) {
      throw new ModelError('model_unavailable', 'AI provider not configured — set OPENROUTER_API_KEY (or AI_BASE_URL + AI_API_KEY)');
    }
  }

  private headers() {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      // OpenRouter attribution (ignored by other OpenAI-compatible providers)
      'HTTP-Referer': 'https://github.com/ladekarl1234-commits/liara-copilot',
      'X-Title': 'Liara Copilot',
    };
  }

  /**
   * One provider call under a hard deadline (cfg.MODEL_CALL_BUDGET_MS covering
   * every attempt and backoff). Returns the response plus an `abort` handle the
   * streaming caller uses for its own idle/total timers.
   *
   * `streaming` changes ONE thing and it matters: the attempt timer is a
   * connect/first-token bound, so once the headers are in it is disarmed and
   * the response BODY is no longer on a wall clock. Attaching
   * AbortSignal.timeout to fetch aborted the body too, which is why a long
   * answer used to be cut off at 30s mid-sentence (REL-03).
   */
  private async post(
    pathname: string,
    body: object,
    signal?: AbortSignal,
    streaming = false,
  ): Promise<{ res: Response; abort: (reason: DOMException) => void }> {
    const cfg = config();
    const deadline = Date.now() + cfg.MODEL_CALL_BUDGET_MS;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= cfg.MODEL_MAX_RETRIES; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break; // budget spent — stop retrying (REL-02)
      const attemptMs = Math.min(cfg.MODEL_TIMEOUT_MS, remaining);
      const ac = new AbortController();
      const timer = AbortSignal.timeout(attemptMs);
      const onTimer = () => ac.abort(new DOMException(`no response within ${attemptMs}ms`, 'TimeoutError'));
      timer.addEventListener('abort', onTimer, { once: true });
      try {
        const res = await fetch(`${this.baseUrl}${pathname}`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.any([ac.signal, ...(signal ? [signal] : [])]),
        });
        if (res.ok) {
          // non-streaming keeps the timer armed: it must still cover res.json()
          if (streaming) timer.removeEventListener('abort', onTimer);
          return { res, abort: (reason: DOMException) => ac.abort(reason) };
        }
        const backoff = 250 * 4 ** attempt;
        if (RETRYABLE.has(res.status) && attempt < cfg.MODEL_MAX_RETRIES && deadline - Date.now() > backoff + MIN_ATTEMPT_MS) {
          await res.text().catch(() => {}); // drain body — return connection to the pool
          await sleep(backoff);
          continue;
        }
        const text = (await res.text()).slice(0, 500);
        if (res.status === 429) throw new ModelError('rate_limited', `provider rate limit: ${text}`);
        throw new ModelError('model_unavailable', `provider error ${res.status}: ${text}`);
      } catch (e) {
        if (e instanceof ModelError) throw e;
        lastErr = e;
        // caller abort (client disconnect) is NOT a provider timeout — classify first
        if (signal?.aborted) throw new ClientAbortError();
        // A timeout is not a transient blip: retrying it burns the whole budget
        // for the same answer (REL-02). Anything that is not a recognised
        // transport fault is our bug — rethrow so it lands as 'internal',
        // not as "provider unreachable, try again shortly" (REL-10).
        if (isAbortLike(e)) throw new ModelError('model_timeout', `model call exceeded ${attemptMs}ms`);
        if (!isTransportError(e)) throw e;
        const backoff = 250 * 4 ** attempt;
        if (attempt < cfg.MODEL_MAX_RETRIES && deadline - Date.now() > backoff + MIN_ATTEMPT_MS) {
          await sleep(backoff);
          continue;
        }
        throw new ModelError('model_unavailable', `network failure: ${(e as Error).message}`);
      }
    }
    throw new ModelError(
      lastErr ? 'model_unavailable' : 'model_timeout',
      lastErr
        ? `network failure: ${String(lastErr)}`
        : `model call budget of ${cfg.MODEL_CALL_BUDGET_MS}ms exhausted`,
    );
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1400,
      temperature: opts.temperature ?? 0.2,
      stream: false,
    };
    // most-compatible structured output: json_object + schema in prompt (caller validates with zod)
    if (opts.jsonSchema) body.response_format = { type: 'json_object' };
    const { res } = await this.post('/chat/completions', body, opts.signal);
    // the attempt timer still covers this body read; without this the abort
    // escapes as a raw DOMException and is mislabelled 'internal' (REL-03)
    const data = await res.json().catch((e: unknown) => {
      if (opts.signal?.aborted) throw new ClientAbortError();
      if (isAbortLike(e)) throw new ModelError('model_timeout', `model call exceeded ${config().MODEL_TIMEOUT_MS}ms`);
      throw new ModelError('model_unavailable', `invalid provider response: ${(e as Error).message}`);
    });
    const text: string = data.choices?.[0]?.message?.content ?? '';
    const model: string | undefined = typeof data.model === 'string' ? data.model : undefined;
    if (model) opts.onMeta?.({ model });
    return { text, usage: usageOf(data.usage, opts.messages, text), model };
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<string> {
    const body = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1400,
      temperature: opts.temperature ?? 0.2,
      stream: true,
    };
    const cfg = config();
    const { res, abort } = await this.post('/chat/completions', body, opts.signal, true);
    if (!res.body) throw new ModelError('model_unavailable', 'no response body');
    const reader = res.body.getReader();
    // Two independent bounds on the body (REL-03/COST-08): an idle gap — no
    // data for MODEL_TIMEOUT_MS means the route is dead — and a total cap for
    // the whole answer. A slow-but-alive stream keeps its tokens.
    const startedAt = Date.now();
    let stalled = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        stalled = true;
        abort(new DOMException('stream stalled', 'TimeoutError'));
      }, cfg.MODEL_TIMEOUT_MS);
    };
    try {
      const decoder = new TextDecoder();
      let buf = '';
      let metaSent = false;
      armIdle();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        if (Date.now() - startedAt > cfg.MODEL_STREAM_TIMEOUT_MS) {
          abort(new DOMException('stream budget exhausted', 'TimeoutError'));
          throw new ModelError('model_timeout', `stream exceeded ${cfg.MODEL_STREAM_TIMEOUT_MS}ms`);
        }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const m = line.match(/^data:\s*(.*)$/);
          if (!m || m[1].trim() === '[DONE]') continue;
          try {
            const parsed = JSON.parse(m[1]);
            if (!metaSent && typeof parsed.model === 'string') {
              metaSent = true;
              opts.onMeta?.({ model: parsed.model }); // actual model (openrouter/free routes dynamically)
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // partial/keepalive line — ignore
          }
        }
      }
    } catch (e) {
      // an abort DURING the body used to escape as a raw DOMException (post()
      // had already returned), so the orchestrator called it 'internal' and the
      // user got "an unexpected error occurred" on a truncated answer (REL-03)
      if (e instanceof ModelError) throw e;
      if (opts.signal?.aborted) throw new ClientAbortError();
      if (stalled) throw new ModelError('model_timeout', `no stream data for ${cfg.MODEL_TIMEOUT_MS}ms`);
      if (isAbortLike(e)) throw new ModelError('model_timeout', 'stream aborted');
      throw new ModelError('model_unavailable', `stream failure: ${(e as Error).message}`);
    } finally {
      clearTimeout(idle);
      // runs on normal end, consumer throw, and generator .return() — the
      // socket must never be left holding a live provider stream
      await reader.cancel().catch(() => {});
    }
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const { res } = await this.post('/embeddings', { model, input: texts });
    const data = await res.json();
    const rows = (data.data ?? []).sort((a: { index: number }, b: { index: number }) => a.index - b.index);
    if (rows.length !== texts.length) throw new ModelError('model_unavailable', 'embedding count mismatch');
    return rows.map((r: { embedding: number[] }) => r.embedding);
  }
}

function usageOf(u: { prompt_tokens?: number; completion_tokens?: number } | undefined, messages: ChatMessage[], text: string): Usage {
  if (u?.prompt_tokens != null) return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0 };
  // provider did not report usage — estimate with the SAME (Persian-aware)
  // estimator the streaming path uses; a flat chars/4 here was a second,
  // disagreeing estimator in one codebase (COST-04)
  const inTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  return { inputTokens: inTokens, outputTokens: estimateTokens(text) };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let providerSingleton: ModelProvider | null = null;
export function getProvider(): ModelProvider {
  if (!providerSingleton) {
    providerSingleton = config().llmMock ? new MockLLMProvider() : new OpenAICompatibleProvider();
  }
  return providerSingleton;
}
export function setProviderForTests(p: ModelProvider | null) {
  providerSingleton = p;
}
