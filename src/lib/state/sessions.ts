// Conversation session store.
// ponytail: in-memory LRU (cap 5000, TTL 24h) — single-instance ceiling; swap
// for Redis-compatible storage behind these four functions when scaling out.

import crypto from 'node:crypto';
import type { AgentPlan, Hypothesis, SessionState } from '@/types';
import { log } from '@/lib/obs/log';
import { hashId } from '@/lib/security/hash';
import { redactSecrets } from '@/lib/security/redact';
import { unpackSession, portableStateEnabled } from '@/lib/state/portable';

const MAX_SESSIONS = 5000;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_CHARS = 900;

const store = new Map<string, SessionState>();

let ceilingWarned = false;

/**
 * The single-instance ceiling, said out loud once (EP-SCALE-01).
 *
 * Conversation state is this Map. Behind a non-sticky load balancer with N
 * instances, ~(N-1)/N of follow-up turns land on a process that has never seen
 * the id, so summary, profile, troubleshooting ledger and workflow silently
 * vanish mid-conversation and Fix/Guide degrade to Ask with NO error anywhere.
 * Until the store is externalized, a single instance (or sticky sessions) is a
 * hard prerequisite, not a preference — so it is a startup warning in
 * production and a warning the first time the symptom is actually observed,
 * rather than something an operator discovers from a confused user.
 */
function warnSingleInstanceCeiling(): void {
  if (ceilingWarned) return;
  ceilingWarned = true;
  log('warn', 'session_store_single_instance', {
    detail:
      'Conversation state is in-process. Run ONE instance, or enable sticky sessions: ' +
      'with N instances behind a non-sticky LB roughly (N-1)/N of follow-up turns silently start a new conversation.',
    maxSessions: MAX_SESSIONS,
    ttlMs: TTL_MS,
  });
}

if (process.env.NODE_ENV === 'production') warnSingleInstanceCeiling();

export function getOrCreateSession(id?: string, stateToken?: string): SessionState {
  if (id) {
    const s = store.get(id);
    if (s && Date.now() - s.updatedAt < TTL_MS) {
      store.delete(id); // LRU: re-insert on access
      store.set(id, s);
      return s;
    }
    // This process cannot resolve the id — on serverless that is the NORMAL
    // case, because the previous turn ran in a different isolate. Before
    // giving up and silently starting a new conversation, try the copy the
    // client carried. It is HMAC-signed, so adopting it is safe: only this
    // server could have authored it, and it must name the same id.
    const carried = unpackSession(stateToken, id);
    if (carried) {
      save(carried); // warm this isolate's cache for the rest of the turn
      log('info', 'session_restored_from_client', { sessionId: hashId(id), turns: carried.turns });
      return carried;
    }
    // Genuinely unresolvable: expired, evicted, or no portable state. The turn
    // below starts a brand-new conversation, which is the visible shape of the
    // multi-instance failure (EP-SCALE-01). Hashed: the raw id is a credential.
    log('warn', 'session_not_resolved', {
      sessionId: hashId(id),
      reason: s ? 'expired' : 'unknown',
      stored: store.size,
      hadToken: Boolean(stateToken),
      portable: portableStateEnabled(),
    });
    if (!portableStateEnabled()) warnSingleInstanceCeiling();
  }
  // Unknown/expired ids are NEVER adopted: a client cannot pre-create a
  // guessable session id and wait for someone to collide with it. Session
  // secrecy rests on the 122 bits of randomUUID entropy.
  const fresh: SessionState = {
    id: crypto.randomUUID(),
    language: 'fa',
    profile: {},
    context: { triedActions: [] },
    summary: '',
    turns: 0,
    updatedAt: Date.now(),
  };
  save(fresh);
  return fresh;
}

export function save(s: SessionState): void {
  s.updatedAt = Date.now();
  store.delete(s.id);
  store.set(s.id, s);
  while (store.size > MAX_SESSIONS) {
    const oldest = store.keys().next().value as string;
    store.delete(oldest);
  }
}

/** Merge a plan's state patch into the session, with bounded sizes. */
export function applyPatch(
  s: SessionState,
  patch: AgentPlan['statePatch'],
  language: 'fa' | 'en',
  intent?: AgentPlan['intent'],
): void {
  s.language = language;
  if (patch.profile) s.profile = { ...s.profile, ...clean(patch.profile) };

  // A fresh, non-error, non-continuation question means the previous error is
  // stale — clear it so an unrelated turn isn't answered against an old
  // "connect ECONNREFUSED" (AG-002). BUT never clear it mid-flow: while an
  // unresolved troubleshooting session is active, a follow-up/clarification is
  // part of that flow and must keep the error context (AG2-004 regression).
  const newProduct = patch.context?.product;
  const topicSwitched = Boolean(newProduct && newProduct !== s.context.product);
  const activeTroubleshooting = Boolean(s.troubleshooting && !s.troubleshooting.resolved);
  if (
    ((intent === 'question' || intent === 'workflow') && !activeTroubleshooting) ||
    topicSwitched
  ) {
    if (!patch.context?.knownError) s.context.knownError = undefined;
    if (topicSwitched) {
      s.troubleshooting = undefined;
      // the Guide checklist was never retired, so one deploy question left a
      // 7-step list rendering above every later answer for the whole 24h
      // session, with step w1 permanently `current` (EP-AGT-02)
      if (!patch.workflow) s.workflow = undefined;
    }
  }
  // a finished checklist renders once (all steps done) and is retired on the
  // NEXT turn, so completion is visible but does not become decoration
  if (!patch.workflow && s.workflow?.steps.length && s.workflow.steps.every((st) => st.status === 'done')) {
    s.workflow = undefined;
  }

  if (patch.context) {
    const { triedActions, ...rest } = patch.context as SessionState['context'];
    s.context = { ...s.context, ...clean(rest), triedActions: s.context.triedActions };
    if (Array.isArray(triedActions)) {
      for (const a of triedActions) if (a && !s.context.triedActions.includes(a)) s.context.triedActions.push(a);
      s.context.triedActions = s.context.triedActions.slice(-20);
    }
  }

  // explicit clears (e.g. user corrected "it is NOT nextjs") — after the merge
  for (const field of patch.clearContext ?? []) {
    if (field === 'platform') s.context.platform = undefined;
    else if (field === 'database') s.context.database = undefined;
    else if (field === 'knownError') s.context.knownError = undefined;
    else if (field === 'product') s.context.product = undefined;
  }

  if (patch.troubleshooting) {
    patch.troubleshooting.hypotheses = (patch.troubleshooting.hypotheses ?? []).slice(0, 8);
    s.troubleshooting = mergeLedger(s.troubleshooting, patch.troubleshooting);
  }
  if (patch.workflow) {
    patch.workflow.steps = (patch.workflow.steps ?? []).slice(0, 12);
    s.workflow = patch.workflow;
  }
}

const LEDGER_RANK: Record<Hypothesis['status'], number> = { confirmed: 0, testing: 1, untested: 2, rejected: 3 };

/**
 * Merge a hypothesis ledger by id instead of replacing it wholesale: the
 * ledger's whole value is remembering what has been ruled out, and one terse
 * model turn used to erase that (EP-AGT-06). A patch that names a DIFFERENT
 * problem is a new investigation and does replace.
 * The result is ordered confirmed → testing → untested → rejected so the head
 * of the list is always the hypothesis to act on (what the Fix message and the
 * hypothesis panel present first).
 */
function mergeLedger(
  prev: SessionState['troubleshooting'],
  patch: NonNullable<SessionState['troubleshooting']>,
): NonNullable<SessionState['troubleshooting']> {
  const newProblem = patch.problem?.trim();
  const sameFlow = prev && (!newProblem || newProblem === prev.problem);
  const merged: Hypothesis[] = sameFlow ? prev.hypotheses.map((h) => ({ ...h })) : [];
  for (const h of patch.hypotheses) {
    const existing = merged.find((m) => m.id === h.id);
    if (existing) {
      existing.status = h.status;
      if (h.text) existing.text = h.text;
    } else merged.push({ ...h });
  }
  merged.sort((a, b) => LEDGER_RANK[a.status] - LEDGER_RANK[b.status]);
  return {
    problem: newProblem || prev?.problem || '',
    hypotheses: merged.slice(0, 8),
    resolved: patch.resolved,
    rootCause: patch.rootCause ?? (sameFlow ? prev.rootCause : undefined),
  };
}

/** Rolling compact summary instead of full history in every model call. */
export function pushTurn(s: SessionState, userMsg: string, assistantGist: string): void {
  s.turns += 1;
  // The summary is embedded in the plan/answer system prompt on EVERY later
  // turn (prompts.stateBlock), so it is a model-bound sink: redact pasted
  // secrets here or a turn-1 paste leaks to the model on turn 2 (AC-SEC-002).
  const u = redactSecrets(userMsg).replace(/\s+/g, ' ').slice(0, 200);
  const a = redactSecrets(assistantGist).replace(/\s+/g, ' ').slice(0, 200);
  s.summary = `${s.summary}\nU:${u}\nA:${a}`.slice(-MAX_SUMMARY_CHARS).trimStart();
  save(s);
}

export function contextChips(s: SessionState): string[] {
  const chips: string[] = [];
  if (s.context.platform) chips.push(displayName(s.context.platform));
  if (s.context.product && s.context.product !== s.context.platform) chips.push(displayName(s.context.product));
  if (s.context.database) chips.push(displayName(s.context.database));
  if (s.troubleshooting && !s.troubleshooting.resolved) chips.push(s.language === 'fa' ? 'عیب‌یابی' : 'Troubleshooting');
  return chips.slice(0, 4);
}

const DISPLAY: Record<string, string> = {
  nextjs: 'Next.js', nodejs: 'Node.js', dotnet: '.NET', php: 'PHP',
  paas: 'PaaS', dbaas: 'DBaaS', iaas: 'IaaS', 'object-storage': 'Object Storage',
  'one-click-apps': 'One-Click Apps', 'dns-management-system': 'DNS',
  'email-server': 'Email', postgresql: 'PostgreSQL', mysql: 'MySQL',
  mongodb: 'MongoDB', mariadb: 'MariaDB', mssql: 'SQL Server', redis: 'Redis',
  'elastic-search': 'Elasticsearch', rabbitmq: 'RabbitMQ', ai: 'AI',
};

function displayName(key: string): string {
  return DISPLAY[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function clean<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** @internal test-only; do not call from app code (EP-MAINT-08). */
export function resetSessionsForTests(): void {
  store.clear();
  ceilingWarned = false;
}
