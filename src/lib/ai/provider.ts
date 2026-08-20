// OpenAI-compatible ModelProvider over plain fetch. Works with Liara AI
// (https://ai.liara.ir/api/v1/<workspace>), OpenRouter, Ollama, OpenAI.
// Server-side only. Bounded retries, hard timeout, typed error taxonomy.

import type { ChatMessage, GenerateOptions, GenerateResult, ModelProvider, Usage } from '@/types';
import type { ErrorCode } from '@/types';
import { config } from '@/lib/config';

export class ModelError extends Error {
  constructor(
    public code: Extract<ErrorCode, 'model_timeout' | 'model_unavailable' | 'rate_limited'>,
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class OpenAICompatibleProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    const cfg = config();
    this.baseUrl = (baseUrl ?? cfg.AI_BASE_URL ?? '').replace(/\/$/, '');
    this.apiKey = apiKey ?? cfg.AI_API_KEY ?? '';
    if (!this.baseUrl || !this.apiKey) {
      throw new ModelError('model_unavailable', 'AI provider not configured — set AI_BASE_URL and AI_API_KEY');
    }
  }

  private headers() {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
  }

  private async post(pathname: string, body: object, signal?: AbortSignal): Promise<Response> {
    const cfg = config();
    let lastErr: unknown;
    for (let attempt = 0; attempt <= cfg.MODEL_MAX_RETRIES; attempt++) {
      const signals = [AbortSignal.timeout(cfg.MODEL_TIMEOUT_MS), ...(signal ? [signal] : [])];
      try {
        const res = await fetch(`${this.baseUrl}${pathname}`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
        if (res.ok) return res;
        if (RETRYABLE.has(res.status) && attempt < cfg.MODEL_MAX_RETRIES) {
          await sleep(250 * 4 ** attempt);
          continue;
        }
        const text = (await res.text()).slice(0, 500);
        if (res.status === 429) throw new ModelError('rate_limited', `provider rate limit: ${text}`);
        throw new ModelError('model_unavailable', `provider error ${res.status}: ${text}`);
      } catch (e) {
        if (e instanceof ModelError) throw e;
        lastErr = e;
        const isTimeout = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
        if (isTimeout && signal?.aborted) throw new ModelError('model_timeout', 'request aborted');
        if (attempt < cfg.MODEL_MAX_RETRIES) {
          await sleep(250 * 4 ** attempt);
          continue;
        }
        if (isTimeout) throw new ModelError('model_timeout', `model call exceeded ${cfg.MODEL_TIMEOUT_MS}ms`);
        throw new ModelError('model_unavailable', `network failure: ${(e as Error).message}`);
      }
    }
    throw new ModelError('model_unavailable', `network failure: ${String(lastErr)}`);
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
    const res = await this.post('/chat/completions', body, opts.signal);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? '';
    return { text, usage: usageOf(data.usage, opts.messages, text) };
  }

  async *generateStream(opts: GenerateOptions): AsyncIterable<string> {
    const body = {
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 1400,
      temperature: opts.temperature ?? 0.2,
      stream: true,
    };
    const res = await this.post('/chat/completions', body, opts.signal);
    if (!res.body) throw new ModelError('model_unavailable', 'no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m || m[1] === '[DONE]') continue;
        try {
          const delta = JSON.parse(m[1]).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // partial/keepalive line — ignore
        }
      }
    }
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const res = await this.post('/embeddings', { model, input: texts });
    const data = await res.json();
    const rows = (data.data ?? []).sort((a: { index: number }, b: { index: number }) => a.index - b.index);
    if (rows.length !== texts.length) throw new ModelError('model_unavailable', 'embedding count mismatch');
    return rows.map((r: { embedding: number[] }) => r.embedding);
  }
}

function usageOf(u: { prompt_tokens?: number; completion_tokens?: number } | undefined, messages: ChatMessage[], text: string): Usage {
  if (u?.prompt_tokens != null) return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0 };
  // provider did not report usage — estimate (chars/4)
  const inChars = messages.reduce((n, m) => n + m.content.length, 0);
  return { inputTokens: Math.ceil(inChars / 4), outputTokens: Math.ceil(text.length / 4) };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let providerSingleton: ModelProvider | null = null;
export function getProvider(): ModelProvider {
  if (!providerSingleton) providerSingleton = new OpenAICompatibleProvider();
  return providerSingleton;
}
export function setProviderForTests(p: ModelProvider | null) {
  providerSingleton = p;
}
