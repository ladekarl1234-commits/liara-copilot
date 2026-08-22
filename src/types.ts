// Shared contracts. Every module codes against these; keep changes deliberate.

// ---------- Documents & retrieval ----------

export interface DocChunk {
  id: string; // stable: sourcePath#chunkIndex
  sourcePath: string; // e.g. public/llms/paas/nextjs/getting-started.md
  url: string; // https://docs.liara.ir/paas/nextjs/getting-started/
  anchor?: string; // heading anchor for deep link
  product: string; // paas | dbaas | ai | iaas | dns | email | object-storage | one-click-apps | overview | references
  platform?: string; // nextjs | django | ... (paas subdirs)
  title: string; // page title
  heading?: string; // section heading this chunk belongs to
  headingPath: string[]; // [h1, h2, ...] breadcrumb
  contentType: 'text' | 'procedure' | 'code' | 'mixed';
  text: string; // chunk body (markdown)
  hash: string; // content hash for incremental indexing
}

export interface RetrievalFilters {
  product?: string;
  platform?: string;
}

export interface ScoredChunk {
  chunk: DocChunk;
  score: number; // fused score
  lexicalScore?: number;
  vectorScore?: number;
}

export interface RetrievalResult {
  chunks: ScoredChunk[];
  confidence: 'high' | 'medium' | 'low';
  queries: string[]; // actual queries executed
  filters: RetrievalFilters;
  latencyMs: number;
  /** whether the vector stage actually contributed this query. Config saying
   * 'hybrid' is not evidence it ran — the embedder can fail (EP-RET-01 follow-up). */
  vectorUsed?: boolean;
  /** gate signals (also surfaced in /api/diag) */
  signals?: { coverage: number; scorePerToken: number; margin: number };
}

export interface Citation {
  n?: number; // the [n] marker used in the answer text, when the model cited by number
  title: string;
  url: string; // deep link incl. #anchor when available
  product: string;
  heading?: string;
}

// ---------- Conversation state ----------

export type Intent =
  | 'question' // Ask: factual / how-to
  | 'troubleshooting' // Fix
  | 'workflow' // Guide: multi-step task
  | 'followup' // continues previous thread
  | 'chitchat' // greeting / out of scope
  | 'unsupported'; // not establishable from docs

export interface Hypothesis {
  id: string;
  text: string;
  status: 'untested' | 'testing' | 'rejected' | 'confirmed';
}

export interface WorkflowStep {
  id: string;
  label: string;
  status: 'done' | 'current' | 'pending';
}

export interface SessionState {
  id: string;
  language: 'fa' | 'en';
  profile: {
    experience?: 'beginner' | 'intermediate' | 'advanced';
    platform?: string;
    packageManager?: string;
    usesDocker?: boolean;
  };
  context: {
    product?: string;
    platform?: string;
    language?: string; // programming language
    database?: string;
    knownError?: string;
    triedActions: string[];
  };
  troubleshooting?: {
    problem: string;
    hypotheses: Hypothesis[];
    resolved: boolean;
    rootCause?: string;
  };
  workflow?: {
    goal: string;
    detected: string[];
    steps: WorkflowStep[];
  };
  summary: string; // rolling conversation summary (compact)
  turns: number;
  updatedAt: number;
}

// ---------- Agent plan (single cheap-model structured call) ----------

export interface AgentPlan {
  intent: Intent;
  language: 'fa' | 'en';
  action: 'answer' | 'clarify' | 'insufficient' | 'next_step' | 'resolve';
  statePatch: Partial<Pick<SessionState, 'profile' | 'context'>> & {
    troubleshooting?: SessionState['troubleshooting'];
    workflow?: SessionState['workflow'];
    // context fields to CLEAR (e.g. the user corrected/negated the platform).
    // clean-merge can only set fields, not remove them, so clearing is explicit.
    clearContext?: ('platform' | 'database' | 'knownError' | 'product')[];
  };
  retrievalQueries: string[]; // <= 3, in docs language (Persian) + key EN terms
  filters: RetrievalFilters;
  clarifyQuestion?: string; // when action = clarify
}

// ---------- Model provider ----------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: object; // request structured output
  /** Override MODEL_CALL_BUDGET_MS for this one call, covering every retry and
   *  backoff. For a call that is on the critical path AND has a usable
   *  fallback, waiting the global budget is strictly worse than giving up. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** provider reports the model that actually served the request (openrouter/free
   * is a dynamic router). Called at most once per call, before/at first token. */
  onMeta?: (meta: { model?: string }) => void;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
  model?: string; // actual model returned by the provider, when reported
}

export interface ModelProvider {
  generate(opts: GenerateOptions): Promise<GenerateResult>;
  generateStream(opts: GenerateOptions): AsyncIterable<string>; // yields text deltas
  embed(texts: string[], model: string): Promise<number[][]>;
}

// ---------- Liara provider (future real integration; mock only this phase) ----------

export interface LiaraApp {
  name: string;
  platform: string;
  status: 'running' | 'stopped' | 'failed';
}

export interface LiaraDeployment {
  id: string;
  appName: string;
  status: 'ready' | 'failed' | 'building';
  createdAt: string;
}

export interface LiaraProvider {
  getApplications(): Promise<LiaraApp[]>;
  getApplication(name: string): Promise<LiaraApp | null>;
  getDeployments(appName: string): Promise<LiaraDeployment[]>;
  getLogs(appName: string, lines?: number): Promise<string[]>;
  getEnvironmentVariables(appName: string): Promise<Record<string, string>>;
  getDomains(appName: string): Promise<{ domain: string; status: string }[]>;
  getDatabases(): Promise<{ name: string; type: string; status: string }[]>;
}

// ---------- API ----------

export interface ChatRequest {
  sessionId?: string;
  message: string;
}

// SSE event stream from /api/chat
export type ChatEvent =
  | { type: 'stage'; stage: 'understanding' | 'searching' | 'checking' | 'answering' }
  // `state` is the signed, portable conversation state. The client stores it and
  // echoes it on the next turn so a follow-up resumes even when it lands on a
  // different serverless isolate. Absent when SESSION_SECRET is not configured.
  | { type: 'session'; sessionId: string; state?: string }
  | { type: 'context'; chips: string[] } // small context indicator
  | { type: 'workflow'; workflow: NonNullable<SessionState['workflow']> }
  | { type: 'troubleshooting'; state: NonNullable<SessionState['troubleshooting']> }
  | { type: 'delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'verification'; note?: string } // post-answer claim check outcome
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'rate_limited'
  | 'model_timeout'
  | 'model_unavailable'
  | 'index_missing'
  | 'invalid_input'
  | 'voice_unavailable'
  | 'internal';

// ---------- Speech (STT / TTS behind provider abstractions) ----------

export interface Transcript {
  text: string;
  language?: string; // detected language code, when available
  durationMs?: number;
}

export interface TranscribeOptions {
  mimeType?: string;
  languageHints?: string[]; // e.g. ['fa', 'en']
  signal?: AbortSignal;
}

export interface SpeechToTextProvider {
  transcribe(audio: Uint8Array, opts?: TranscribeOptions): Promise<Transcript>;
}

/** Text-to-speech contract. Phase I implements this in the browser
 * (SpeechSynthesis); the interface keeps a future server/vendor TTS swappable. */
export interface TextToSpeechProvider {
  speak(text: string, opts?: { lang?: string }): Promise<void> | void;
  stop(): void;
  supported(): boolean;
}

// ---------- Observability ----------

/** How a turn actually ended. This is the operational dimension: without it
 * refusals, clarifications, greetings and injection blocks are indistinguishable
 * in the log stream, so the product's core quality ratio (refusal rate) cannot
 * be computed (EP-OBS-04). */
export type TurnOutcome =
  | 'answered'
  | 'cache'
  | 'degraded' // keyless: grounded sources, no generation
  | 'sources_fallback' // answer model failed, served evidence instead
  | 'insufficient' // evidence gate refused
  | 'clarify'
  | 'chitchat'
  | 'troubleshoot_low_evidence'
  | 'workflow_low_evidence'
  | 'injection_blocked'
  | 'client_abort'
  | 'error';

export interface RequestMetrics {
  requestId: string;
  sessionId: string;
  /** id of the assistant message this turn produced — the join key between
   * request_metrics, the pipeline trace and a later feedback row (EP-OBS-01). */
  messageId?: string;
  intent?: Intent;
  /** how the turn ended (EP-OBS-04) */
  outcome?: TurnOutcome;
  product?: string;
  retrievalLatencyMs?: number;
  candidateCount?: number;
  modelLatencyMs?: number;
  totalLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  cacheHit: boolean;
  retrievalConfidence?: string;
  modelRoute?: string;
  /** 'model' when the planner's structured call succeeded, 'fallback' when it
   * silently degraded to deterministic regex classification (EP-OBS-02) */
  planRoute?: 'model' | 'fallback' | 'none';
  /** whether claim verification actually ran — distinguishes "checked, clean"
   * from "never checked", which otherwise look identical (EP-OBS-03) */
  verified?: boolean;
  unsupportedClaims?: number;
  errorCategory?: string;
}
