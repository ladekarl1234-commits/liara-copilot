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
  /** gate signals (also surfaced in /api/diag) */
  signals?: { coverage: number; scorePerToken: number; margin: number };
}

export interface Citation {
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
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: Usage;
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
  | { type: 'session'; sessionId: string }
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
  | 'internal';

// ---------- Observability ----------

export interface RequestMetrics {
  requestId: string;
  sessionId: string;
  intent?: Intent;
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
  errorCategory?: string;
}
