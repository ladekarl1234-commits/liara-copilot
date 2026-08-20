// Conversation session store.
// ponytail: in-memory LRU (cap 5000, TTL 24h) — single-instance ceiling; swap
// for Redis-compatible storage behind these four functions when scaling out.

import crypto from 'node:crypto';
import type { AgentPlan, SessionState } from '@/types';

const MAX_SESSIONS = 5000;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SUMMARY_CHARS = 900;

const store = new Map<string, SessionState>();

export function getOrCreateSession(id?: string): SessionState {
  if (id) {
    const s = store.get(id);
    if (s && Date.now() - s.updatedAt < TTL_MS) {
      store.delete(id); // LRU: re-insert on access
      store.set(id, s);
      return s;
    }
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
    if (topicSwitched) s.troubleshooting = undefined;
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
    s.troubleshooting = patch.troubleshooting;
  }
  if (patch.workflow) {
    patch.workflow.steps = (patch.workflow.steps ?? []).slice(0, 12);
    s.workflow = patch.workflow;
  }
}

/** Rolling compact summary instead of full history in every model call. */
export function pushTurn(s: SessionState, userMsg: string, assistantGist: string): void {
  s.turns += 1;
  const u = userMsg.replace(/\s+/g, ' ').slice(0, 200);
  const a = assistantGist.replace(/\s+/g, ' ').slice(0, 200);
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

export function resetSessionsForTests(): void {
  store.clear();
}
