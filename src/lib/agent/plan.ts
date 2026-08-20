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
      clearContext: z
        .array(z.enum(['platform', 'database', 'knownError', 'product']))
        .max(4)
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
  /econnrefused|etimedout|enotfound|eaddrinuse|eacces|traceback|exception|stack trace|\b50[234]\b|\b4\d\d\b error|error:|failed|fail(s|ed|ing)?|خطا|ارور|اکسپشن|کرش|crash|نمی‌?شه|نمی‌?شود|نمی‌?کند|کار نمی‌?کن|بالا نمی‌?(آد|یاد|اد)|اجرا نمی‌?ش|مشکل دار|صادر نشد|پر شد|تعریف نشد|یافت نشد|not found|بیلد (نمی|خطا)|down|قطع (شد|می‌?ش)/i;

const GREETING_RE = /^(سلام|درود|hi|hello|hey|صبح بخیر|وقت بخیر|خسته نباشید)[!.\s؟?]*$/i;

// A stack term is NEGATED only when a negation cue sits DIRECTLY on it —
// "not nextjs" / "instead of nextjs" (before) or "nextjs نیست" (after). This
// must NOT fire for "my nextjs app is not working" (the "not" modifies
// "working", not the platform) (AG3-002).
const NEG_BEFORE_RE = /\b(not|isn'?t|no longer( use| using| need)?|instead of|stopped using|dropped|migrated from|moved (away )?from)\s*$|(به\s*جای|عوض\s*کرد(م|ی|)?\s*(به)?)\s*$/i;
const NEG_AFTER_RE = /^\s*(نیست|نبود|نمیخوام|رو عوض)/i;

export interface DeterministicSignals {
  language: 'fa' | 'en';
  hasError: boolean;
  isGreeting: boolean;
  platform?: string;
  database?: string;
  product?: string;
  negatedPlatform?: boolean; // a platform term appears, but negated
  negatedDatabase?: boolean;
}

// "nextjs رو دیگه استفاده نمی‌کنم" — abandonment cue after the platform.
const NEG_ABANDON_RE = /(استفاده\s*نمی|دیگه\s*(ازش|از این)?\s*استفاده|رهاش? کرد|کنار گذاشت|no longer (use|using)|stopped using|dropped)/i;

/** True when a negation cue sits directly before or (near-)after the matched term. */
function isNegated(message: string, termRe: RegExp): boolean {
  const m = new RegExp(termRe.source, termRe.flags).exec(message);
  if (!m) return false;
  const before = message.slice(Math.max(0, m.index - 15), m.index);
  const after = message.slice(m.index + m[0].length, m.index + m[0].length + 10);
  // abandonment ("no longer use X") can trail the platform by a few words
  const afterWide = message.slice(m.index + m[0].length, m.index + m[0].length + 30);
  return NEG_BEFORE_RE.test(before) || NEG_AFTER_RE.test(after) || NEG_ABANDON_RE.test(afterWide);
}

export function preClassify(message: string): DeterministicSignals {
  const platformHit = PLATFORM_HINTS.find(([re]) => re.test(message));
  const databaseHit = DB_HINTS.find(([re]) => re.test(message));
  const negatedPlatform = platformHit ? isNegated(message, platformHit[0]) : false;
  const negatedDatabase = databaseHit ? isNegated(message, databaseHit[0]) : false;
  // On a switch ("use django instead of nextjs"), the FIRST hint (nextjs) is the
  // negated one — look for a SECOND, non-negated platform to adopt (AG2-001).
  let platform = negatedPlatform ? undefined : platformHit?.[1];
  if (negatedPlatform) {
    const second = PLATFORM_HINTS.find(([re, name]) => name !== platformHit![1] && re.test(message) && !isNegated(message, re));
    if (second) platform = second[1];
  }
  let database = negatedDatabase ? undefined : databaseHit?.[1];
  if (negatedDatabase) {
    const second = DB_HINTS.find(([re, name]) => name !== databaseHit![1] && re.test(message) && !isNegated(message, re));
    if (second) database = second[1];
  }
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
    negatedPlatform,
    negatedDatabase,
  };
}

export function fallbackPlan(message: string, s: DeterministicSignals, state: SessionState): AgentPlan {
  // inherit session platform only when this message has no topic of its own
  const ownTopic = s.database ?? (s.product && s.product !== 'paas' ? s.product : undefined);
  const negated = s.negatedPlatform || s.negatedDatabase;
  const platform = s.platform ?? (ownTopic || negated ? undefined : state.context.platform);
  const isDeploy = !s.hasError && DEPLOY_INTENT_RE.test(message);
  const intent: AgentPlan['intent'] = s.isGreeting
    ? 'chitchat'
    : s.hasError
      ? 'troubleshooting'
      : isDeploy
        ? 'workflow'
        : 'question';

  const clearContext: NonNullable<AgentPlan['statePatch']['clearContext']> = [];
  // clear the old value ONLY when the negation named no replacement — if the
  // user switched TO a new stack ("django instead of nextjs"), s.platform is
  // already the new one and must not be cleared after the merge
  if (s.negatedPlatform && !s.platform) clearContext.push('platform');
  if (s.negatedDatabase && !s.database) clearContext.push('database');

  // Deterministically seed the agentic state so Fix AND Guide are visible even
  // in keyless mode (no model to author it). Ranked hypotheses come from the
  // error signature; workflow steps from a detected deploy intent.
  const troubleshooting = s.hasError ? seedTroubleshooting(message, s) : undefined;
  const workflow = isDeploy ? seedWorkflow(s, platform, state) : undefined;

  return {
    intent,
    language: s.language,
    action: isDeploy ? 'next_step' : 'answer',
    statePatch: {
      context: {
        ...(s.platform ? { platform: s.platform } : {}),
        ...(s.database ? { database: s.database } : {}),
        ...(s.product ? { product: s.product } : {}),
        ...(s.hasError ? { knownError: message.slice(0, 300) } : {}),
      } as SessionState['context'],
      ...(clearContext.length ? { clearContext } : {}),
      ...(troubleshooting ? { troubleshooting } : {}),
      ...(workflow ? { workflow } : {}),
    },
    retrievalQueries: s.isGreeting ? [] : [message.slice(0, 200)],
    filters: {
      ...(platform ? { platform } : {}),
      ...(s.product && s.product !== 'paas' ? { product: s.product } : {}),
    },
  };
}

// Deterministic hypothesis seeding from the error signature — a ranked ledger,
// most-likely first, so the troubleshooting UI has real content without a model.
// Ordered most-specific-first so a query is matched by its distinctive symptom,
// not a generic one that happens to appear (AG2-002: an SSL error that also says
// "app not up" must hit the SSL bucket, not the generic port bucket).
const ERROR_HYPOTHESES: { re: RegExp; specific: boolean; hyps: string[] }[] = [
  {
    re: /ssl|tls|گواهی|certificate|cert|https|دامنه|domain|dns|رکورد/i,
    specific: true,
    hyps: [
      'رکوردهای DNS دامنه هنوز به لیارا اشاره نمی‌کنند یا منتشر نشده‌اند',
      'دامنه در بخش دامنه‌های برنامه اضافه/تأیید نشده است',
      'صدور گواهی SSL هنوز کامل نشده (کمی زمان می‌برد)',
    ],
  },
  {
    re: /disk|دیسک|پر شد|no space|فضا|storage full/i,
    specific: true,
    hyps: ['فضای دیسک برنامه پر شده و باید افزایش یابد', 'فایل‌های موقت/لاگ حجم زیادی گرفته‌اند'],
  },
  {
    re: /econnrefused|127\.0\.0\.1|localhost|5432|3306|27017|6379|اتصال.*دیتابیس|دیتابیس.*(وصل|اتصال)/i,
    specific: true,
    hyps: [
      'آدرس اتصال (host/port) به localhost/127.0.0.1 اشاره می‌کند نه به هاست داخلی سرویس مقصد',
      'متغیرهای محیطی اتصال (مثل DATABASE_URL) تنظیم نشده یا اشتباه‌اند',
      'سرویس مقصد در حال اجرا/در دسترس نیست یا هنوز آماده نشده',
    ],
  },
  {
    re: /\b502\b|bad gateway|بالا نمی|اجرا نمی|پورت|\bport\b/i,
    specific: false,
    hyps: [
      'برنامه به پورت درست (مقدار متغیر PORT) گوش نمی‌دهد یا روی 0.0.0.0 bind نشده',
      'فرایند برنامه هنگام اجرا کرش می‌کند (لاگ‌ها را بررسی کنید)',
      'دستور اجرای برنامه (start command) نادرست است',
    ],
  },
];

// A deploy / "how do I get my project onto Liara" intent → seed a Guide.
const DEPLOY_INTENT_RE =
  /استقرار|مستقر|دیپلوی|deploy|راه[\s‌]?اندازی|بالا بیار|منتشر کن|publish|از کجا شروع|چطور.*(اجرا|بالا)|get.*(started|running|deployed|onto)/i;

/** Deterministic deployment workflow checklist so Guide is visible keyless. */
function seedWorkflow(s: DeterministicSignals, platform: string | undefined, state: SessionState): SessionState['workflow'] {
  const detected: string[] = [];
  if (platform ?? state.context.platform) detected.push(platform ?? state.context.platform!);
  if (s.database ?? state.context.database) detected.push(s.database ?? state.context.database!);
  const hasDb = Boolean(s.database ?? state.context.database);
  const steps = [
    { id: 'w1', label: 'ساخت برنامه (انتخاب پلتفرم و پلن)', status: 'current' as const },
    ...(hasDb ? [{ id: 'w2', label: 'ساخت سرویس دیتابیس', status: 'pending' as const }] : []),
    { id: 'w3', label: 'تنظیم متغیرهای محیطی', status: 'pending' as const },
    { id: 'w4', label: 'اجرای استقرار (liara deploy یا Git)', status: 'pending' as const },
    ...(hasDb ? [{ id: 'w5', label: 'اجرای migration دیتابیس', status: 'pending' as const }] : []),
    { id: 'w6', label: 'اتصال دامنه (اختیاری)', status: 'pending' as const },
    { id: 'w7', label: 'بررسی سلامت و لاگ‌ها', status: 'pending' as const },
  ];
  return { goal: 'استقرار پروژه روی لیارا', detected, steps };
}

function seedTroubleshooting(message: string, s: DeterministicSignals): SessionState['troubleshooting'] {
  // prefer a specific bucket over a generic one even if the generic matches too
  const match = ERROR_HYPOTHESES.find((h) => h.specific && h.re.test(message)) ?? ERROR_HYPOTHESES.find((h) => h.re.test(message));
  const hyps = match?.hyps ?? [
    'پیکربندی یا متغیرهای محیطی برنامه نادرست است',
    'وابستگی یا سرویس موردنیاز در دسترس نیست',
    'لاگ‌های برنامه علت دقیق را نشان می‌دهند',
  ];
  return {
    problem: message.slice(0, 200),
    hypotheses: hyps.map((text, i) => ({ id: `h${i + 1}`, text, status: i === 0 ? 'testing' : 'untested' })),
    resolved: false,
  };
}

// ---------------- model plan ----------------

export async function makePlan(
  message: string,
  state: SessionState,
  provider: ModelProvider | null,
  signal?: AbortSignal,
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
      jsonSchema: {}, // request json mode
      signal,
    });
    const parsed = PlanSchema.safeParse(extractJson(res.text));
    if (!parsed.success) return { plan: fallback, usage: res.usage, route: 'fallback-after-parse-error' };
    const plan = parsed.data as AgentPlan;
    // deterministic signals win when the model missed them. Inherit the
    // session's platform ONLY when this message carries no product/database
    // signal of its own — otherwise a turn-1 "django" sticks to a turn-2
    // postgres-pricing question and filters out the right docs forever.
    if (!plan.filters.platform) {
      const ownTopic = signals.database ?? (signals.product && signals.product !== 'paas' ? signals.product : undefined);
      const inherited = ownTopic || plan.filters.product ? undefined : state.context.platform;
      const p = signals.platform ?? inherited;
      if (p) plan.filters.platform = p;
    }
    if (!plan.retrievalQueries.length && plan.action === 'answer') plan.retrievalQueries = [message.slice(0, 200)];
    return { plan, usage: res.usage, route: route.model };
  } catch (e) {
    if ((e as Error).name === 'ClientAbortError') throw e; // don't answer a gone client
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
