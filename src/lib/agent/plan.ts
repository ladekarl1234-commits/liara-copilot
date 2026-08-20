// Planning: deterministic pre-pass (free) + one cheap structured model call.
// Falls back to the deterministic plan when no provider is configured or the
// model output is unusable.

import { z } from 'zod';
import type { AgentPlan, ModelProvider, SessionState, Usage } from '@/types';
import { detectLanguage } from '@/lib/text/persian';
import { planSystemPrompt } from '@/lib/agent/prompts';
import { planRoute } from '@/lib/ai/router';

const PlanSchema = z.object({
  intent: z.enum(['question', 'troubleshooting', 'workflow', 'followup', 'chitchat', 'unsupported']).catch('question'),
  language: z.enum(['fa', 'en']).catch('fa'),
  action: z.enum(['answer', 'clarify', 'insufficient', 'next_step', 'resolve']).catch('answer'),
  statePatch: z
    .object({
      profile: z
        .object({
          experience: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
          platform: z.string().max(40).optional(),
          packageManager: z.string().max(20).optional(),
          usesDocker: z.boolean().optional(),
        })
        .partial()
        .optional(),
      context: z
        .object({
          product: z.string().max(40).optional(),
          platform: z.string().max(40).optional(),
          language: z.string().max(30).optional(),
          database: z.string().max(30).optional(),
          knownError: z.string().max(300).optional(),
          triedActions: z.array(z.string().max(200)).max(10).optional(),
        })
        .partial()
        .optional(),
      troubleshooting: z
        .object({
          problem: z.string().max(300),
          hypotheses: z
            .array(
              z.object({
                id: z.string().max(30),
                text: z.string().max(200),
                status: z.enum(['untested', 'testing', 'rejected', 'confirmed']).catch('untested'),
              }),
            )
            .max(8),
          resolved: z.boolean().catch(false),
          rootCause: z.string().max(300).optional(),
        })
        .optional(),
      workflow: z
        .object({
          goal: z.string().max(200),
          detected: z.array(z.string().max(40)).max(8),
          steps: z
            .array(
              z.object({
                id: z.string().max(30),
                label: z.string().max(120),
                status: z.enum(['done', 'current', 'pending']).catch('pending'),
              }),
            )
            .max(12),
        })
        .optional(),
    })
    .catch({}),
  retrievalQueries: z.array(z.string().max(200)).max(3).catch([]),
  filters: z
    .object({ product: z.string().max(40).optional(), platform: z.string().max(40).optional() })
    .catch({}),
  clarifyQuestion: z.string().max(400).optional(),
});

// ---------------- deterministic signals ----------------

const PLATFORM_HINTS: [RegExp, string][] = [
  [/next\.?js|نکست/i, 'nextjs'],
  [/node\.?js|\bnode\b|اکسپرس|express/i, 'nodejs'],
  [/\breact\b|ری‌?اکت/i, 'react'],
  [/\bvue\b|ویو/i, 'vue'],
  [/angular|انگولار/i, 'angular'],
  [/django|جنگو/i, 'django'],
  [/flask|فلسک/i, 'flask'],
  [/laravel|لاراول/i, 'laravel'],
  [/\bphp\b/i, 'php'],
  [/\bpython\b|پایتون/i, 'python'],
  [/\.net|dotnet|asp\.net/i, 'dotnet'],
  [/\bgo(lang)?\b/i, 'go'],
  [/docker|داکر/i, 'docker'],
  [/\bstatic\b|استاتیک/i, 'static'],
];

const DB_HINTS: [RegExp, string][] = [
  [/postgres(ql)?|پستگرس|psql|5432/i, 'postgresql'],
  [/mysql|مای‌?اسکیوال|3306/i, 'mysql'],
  [/mariadb/i, 'mariadb'],
  [/mongo(db)?|مونگو|27017/i, 'mongodb'],
  [/redis|رديس|ردیس|6379/i, 'redis'],
  [/mssql|sql server/i, 'mssql'],
  [/elastic/i, 'elastic-search'],
  [/rabbitmq/i, 'rabbitmq'],
];

const PRODUCT_HINTS: [RegExp, string][] = [
  [/object storage|فضای ذخیره|باکت|bucket|s3/i, 'object-storage'],
  [/دامنه|domain|dns|ssl|گواهی|certificate/i, 'paas'],
  [/ایمیل|email|smtp/i, 'email-server'],
  [/سرور مجازی|\biaas\b|\bvm\b|ubuntu|debian/i, 'iaas'],
  [/هوش مصنوعی|\bai\b|مدل زبانی|llm|چت‌?بات/i, 'ai'],
  [/دیتابیس|database|\bdb\b/i, 'dbaas'],
];

const ERROR_RE =
  /econnrefused|etimedout|enotfound|eaddrinuse|eacces|traceback|exception|stack trace|\b50[234]\b|\b4\d\d\b error|error:|failed|خطا|ارور|کرش|crash|نمی‌?شه|نمی‌?شود|کار نمی‌?کند|مشکل دارم/i;

const GREETING_RE = /^(سلام|درود|hi|hello|hey|صبح بخیر|وقت بخیر|خسته نباشید)[!.\s؟?]*$/i;

export interface DeterministicSignals {
  language: 'fa' | 'en';
  hasError: boolean;
  isGreeting: boolean;
  platform?: string;
  database?: string;
  product?: string;
}

export function preClassify(message: string): DeterministicSignals {
  const platform = PLATFORM_HINTS.find(([re]) => re.test(message))?.[1];
  const database = DB_HINTS.find(([re]) => re.test(message))?.[1];
  let product = PRODUCT_HINTS.find(([re]) => re.test(message))?.[1];
  if (!product && platform) product = 'paas';
  if (!product && database) product = 'dbaas';
  return {
    language: detectLanguage(message),
    hasError: ERROR_RE.test(message),
    isGreeting: GREETING_RE.test(message.trim()),
    platform,
    database,
    product,
  };
}

export function fallbackPlan(message: string, s: DeterministicSignals, state: SessionState): AgentPlan {
  const platform = s.platform ?? state.context.platform;
  return {
    intent: s.isGreeting ? 'chitchat' : s.hasError ? 'troubleshooting' : 'question',
    language: s.language,
    action: 'answer',
    statePatch: {
      context: {
        ...(s.platform ? { platform: s.platform } : {}),
        ...(s.database ? { database: s.database } : {}),
        ...(s.product ? { product: s.product } : {}),
        ...(s.hasError ? { knownError: message.slice(0, 300) } : {}),
      } as SessionState['context'],
    },
    retrievalQueries: s.isGreeting ? [] : [message.slice(0, 200)],
    filters: {
      ...(platform ? { platform } : {}),
      ...(s.product && s.product !== 'paas' ? { product: s.product } : {}),
    },
  };
}

// ---------------- model plan ----------------

export async function makePlan(
  message: string,
  state: SessionState,
  provider: ModelProvider | null,
): Promise<{ plan: AgentPlan; usage: Usage; route: string }> {
  const signals = preClassify(message);
  const fallback = fallbackPlan(message, signals, state);
  if (!provider || signals.isGreeting) return { plan: fallback, usage: zero(), route: 'deterministic' };

  const route = planRoute();
  try {
    const res = await provider.generate({
      model: route.model,
      messages: [
        { role: 'system', content: planSystemPrompt(state) },
        { role: 'user', content: `<user_data>\n${message}\n</user_data>` },
      ],
      maxTokens: 700,
      temperature: 0,
      jsonSchema: {}, // signal json mode
    });
    const parsed = PlanSchema.safeParse(extractJson(res.text));
    if (!parsed.success) return { plan: fallback, usage: res.usage, route: 'fallback-after-parse-error' };
    const plan = parsed.data as AgentPlan;
    // deterministic signals win when the model missed them
    if (!plan.filters.platform && (signals.platform ?? state.context.platform)) {
      plan.filters.platform = signals.platform ?? state.context.platform;
    }
    if (!plan.retrievalQueries.length && plan.action === 'answer') plan.retrievalQueries = [message.slice(0, 200)];
    return { plan, usage: res.usage, route: route.model };
  } catch {
    return { plan: fallback, usage: zero(), route: 'fallback-after-model-error' };
  }
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0 });
