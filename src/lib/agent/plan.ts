// Planning: deterministic pre-pass (free) + one cheap structured model call.
// Falls back to the deterministic plan when no provider is configured or the
// model output is unusable.

import { z } from 'zod';
import type { AgentPlan, ModelProvider, SessionState, Usage } from '@/types';
import { detectLanguage } from '@/lib/text/persian';
import { planSystemPrompt } from '@/lib/agent/prompts';
import { planRoute } from '@/lib/ai/router';
import { log } from '@/lib/obs/log';

const PlanSchema = z.object({
  intent: z.enum(['question', 'troubleshooting', 'workflow', 'followup', 'chitchat', 'unsupported']).catch('question'),
  language: z.enum(['fa', 'en']).catch('fa'),
  action: z.enum(['answer', 'clarify', 'insufficient', 'next_step', 'resolve']).catch('answer'),
  // Every sub-object carries its OWN `.catch(undefined)`: one malformed limb
  // (e.g. a delta-shaped troubleshooting patch, which the plan prompt actively
  // invites) must drop only itself, never take context + profile + workflow
  // down with it (EP-AGT-01).
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
        .optional()
        .catch(undefined),
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
        .optional()
        .catch(undefined),
      troubleshooting: z
        .object({
          // optional: a patch that only updates hypothesis statuses is valid and
          // must not be discarded; makePlan restores the ORIGINAL problem below.
          problem: z.string().max(300).optional(),
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
        .optional()
        .catch(undefined),
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
        .optional()
        .catch(undefined),
      clearContext: z
        .array(z.enum(['platform', 'database', 'knownError', 'product']))
        .max(4)
        .optional()
        .catch(undefined),
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

// --- social / flow-control cues (all free, all keyless) ---
// A greeting was previously matched anchored-exact, so "سلام، چطوری؟" and
// "hi there" took the full plan+retrieve+answer path and then got the "no
// reliable answer" refusal. Now: a social cue must be present AND almost
// nothing must be left once the cue and its usual fillers are stripped — so
// "ممنون، چطور دیتابیس بسازم؟" is still a real question (EP-AGT-11).
const SOCIAL_CUE_RE =
  /(سلام|درود|صبح بخیر|وقت بخیر|شب بخیر|خسته نباشید|مرسی|ممنون|سپاس|دمت گرم|\bhi\b|\bhello\b|\bhey\b|\bthanks?\b|thank you|\bthx\b|good (morning|evening))/i;
const SOCIAL_FILLER_RE =
  /(سلام|درود|صبح بخیر|وقت بخیر|شب بخیر|خسته نباشید|مرسی|ممنون|سپاس|دمت گرم|چطوری|چطورید|خوبی|بابت|از شما|خیلی|جان|عزیز|مشکل|حل شد|درست شد|رفع شد|hi|hello|hey|thanks?|thank you|thx|good (morning|evening)|how are you|there|mate|a lot|so much|for (the )?help|fixed|solved|works now|it works|you)/gi;

// "it still doesn't work" — the product's own one-click follow-up sends the
// literal string "هنوز حل نشده" (Feedback.tsx). Without this the turn falls out
// of the Fix flow into a generic refusal (EP-AGT-04).
const CONTINUATION_RE =
  /(هنوز|بازم|باز هم|حل نشد|درست نشد|رفع نشد|فرقی نکرد|همون(\s|‌)?خطا|کار نکرد|still|didn'?t work|does ?n'?t work|not working|same error|no luck)/i;

// "thanks, it's fixed" — the only deterministic termination condition a Fix
// flow has when no model is available (EP-AGT-07).
const RESOLVED_RE =
  /(حل شد|درست شد|رفع شد|مشکل حل|مشکل رفع|درست کار می‌?کن|الان کار می‌?کن|solved|fixed|works now|it works|worked now|resolved)/i;

// A past-tense check the user reports having already done — the single most
// valuable anti-repetition signal, and empty on every fallback turn until now
// (EP-AGT-09). Captures the clause around the verb, trimmed at punctuation.
const TRIED_RE =
  /([^.،؛\n]{0,120}?(?:چک کردم|بررسی کردم|امتحان کردم|تست کردم|ری‌?استارت کردم|ریستارت کردم|عوض کردم|ست کردم|تنظیم کردم|اضافه کردم|زدم|i (?:tried|checked|restarted|ran|already)|already (?:tried|checked|did)|tried|checked)[^.،؛\n]{0,80})/i;

// Cheap experience / toolchain extraction so personalization is not a
// model-only feature (EP-AGT-05b).
const BEGINNER_RE = /تازه[‌\s]?کار|مبتدی|بلد نیستم|بلد نیس|تازه شروع|اولین بار|هیچی نمی‌?دونم|beginner|newbie|new to (this|liara)|never done/i;
const ADVANCED_RE = /حرفه[‌\s]?ای|با ?تجربه|سال‌?هاست|می‌?دونم چطور|senior|experienced|advanced user|i know how/i;
const PM_RE = /\b(npm|pnpm|yarn|bun)\b/i;

/** Tokens left once social cues and their fillers are stripped. */
function residualTokens(message: string): number {
  return message
    .replace(SOCIAL_FILLER_RE, ' ')
    .replace(/[!.,،؛?؟:;\-—_()"'`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

// A stack term is NEGATED only when a negation cue sits DIRECTLY on it —
// "not nextjs" / "instead of nextjs" (before) or "nextjs نیست" (after). This
// must NOT fire for "my nextjs app is not working" (the "not" modifies
// "working", not the platform) (AG3-002).
const NEG_BEFORE_RE = /\b(not|isn'?t|no longer( use| using| need)?|instead of|stopped using|dropped|migrated from|moved (away )?from)\s*$|(به\s*جای|عوض\s*کرد(م|ی|)?\s*(به)?)\s*$/i;
const NEG_AFTER_RE = /^\s*(نیست|نبود|نمیخوام|رو عوض)/i;

export interface DeterministicSignals {
  language: 'fa' | 'en';
  hasError: boolean;
  isGreeting: boolean; // greeting / thanks / pure sign-off — the free canned path
  isContinuation: boolean; // "still broken" — keep the active Fix flow running
  isResolved: boolean; // "it's fixed" — terminate the active Fix flow
  triedAction?: string; // a check the user reports having already done
  experience?: 'beginner' | 'intermediate' | 'advanced';
  packageManager?: string;
  platform?: string;
  database?: string;
  product?: string;
  negatedPlatform?: boolean; // a platform term appears, but negated
  negatedDatabase?: boolean;
}

// "nextjs رو دیگه استفاده نمی‌کنم" — abandonment cue after the platform. Uses
// SPECIFIC phrases, not bare "dropped" (which is common in error reports like
// "the connection dropped" and would mis-label an active platform — COMP-R5-02).
const NEG_ABANDON_RE = /(استفاده\s*نمی|دیگه\s*(ازش|از این)?\s*استفاده|رهاش? کرد|کنار گذاشت|no longer (use|using|need)|stopped using|dropped it|moved away from)/i;

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
  const hasError = ERROR_RE.test(message);
  // "still not working" wins over "fixed": a message can carry both stems
  // ("درست نشد" contains neither "درست شد" nor vice-versa, but "not fixed" does).
  const isContinuation = CONTINUATION_RE.test(message);
  const isResolved = !isContinuation && RESOLVED_RE.test(message);
  const trimmed = message.trim();
  const social = SOCIAL_CUE_RE.test(trimmed) || isResolved;
  return {
    language: detectLanguage(message),
    hasError,
    // a social opener/closer with (almost) no payload costs zero model calls
    isGreeting: social && !hasError && !isContinuation && residualTokens(trimmed) <= 2,
    isContinuation,
    isResolved,
    triedAction: TRIED_RE.exec(message)?.[1]?.trim().slice(0, 200) || undefined,
    experience: BEGINNER_RE.test(message) ? 'beginner' : ADVANCED_RE.test(message) ? 'advanced' : undefined,
    packageManager: PM_RE.exec(message)?.[1]?.toLowerCase(),
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

  // An unresolved ledger keeps ownership of the conversation: "هنوز حل نشده" /
  // "بازم کار نمی‌کنه" carries no error signature of its own, so without this it
  // classified as a plain question, retrieved against meaningless text and got
  // the generic refusal — abandoning the flow the user was in (EP-AGT-04).
  const active = state.troubleshooting && !state.troubleshooting.resolved ? state.troubleshooting : undefined;
  const continuingFix = Boolean(active && (s.isContinuation || s.isResolved));

  const intent: AgentPlan['intent'] = s.isGreeting
    ? 'chitchat'
    : continuingFix
      ? 'troubleshooting'
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
  // error signature; workflow steps from a detected deploy intent. A follow-up
  // inside an active flow ADVANCES the existing ledger instead of re-deriving a
  // new one from the follow-up text (EP-AGT-03).
  const troubleshooting = continuingFix
    ? advanceLedger(active!, s.isResolved)
    : s.hasError
      ? seedTroubleshooting(message, s)
      : undefined;
  const workflow = isDeploy ? seedWorkflow(s, platform, state) : undefined;

  return {
    intent,
    language: s.language,
    action: s.isResolved && active ? 'resolve' : isDeploy ? 'next_step' : 'answer',
    statePatch: {
      context: {
        ...(s.platform ? { platform: s.platform } : {}),
        ...(s.database ? { database: s.database } : {}),
        ...(s.product ? { product: s.product } : {}),
        // never let a follow-up ("بازم کار نمی‌کنه") overwrite the ORIGINAL
        // error text that the whole flow is diagnosing
        ...(s.hasError && !continuingFix ? { knownError: message.slice(0, 300) } : {}),
        ...(s.triedAction ? { triedActions: [s.triedAction] } : {}),
      } as SessionState['context'],
      ...(s.experience || s.packageManager
        ? {
            profile: {
              ...(s.experience ? { experience: s.experience } : {}),
              ...(s.packageManager ? { packageManager: s.packageManager } : {}),
            },
          }
        : {}),
      ...(clearContext.length ? { clearContext } : {}),
      ...(troubleshooting ? { troubleshooting } : {}),
      ...(workflow ? { workflow } : {}),
    },
    // a continuation carries no searchable content of its own — retrieve against
    // the problem we are actually diagnosing, not "هنوز حل نشده"
    retrievalQueries: s.isGreeting
      ? []
      : [((continuingFix && (state.context.knownError ?? active!.problem)) || message).slice(0, 200)],
    filters: {
      ...(platform ? { platform } : {}),
      ...(s.product && s.product !== 'paas' ? { product: s.product } : {}),
    },
  };
}

/**
 * Advance an existing hypothesis ledger without a model: a negative follow-up
 * rejects the hypothesis under test and promotes the next untested one; a
 * positive one confirms it and closes the flow. The `problem` is carried over
 * verbatim — it states what we are diagnosing, not what the user last typed.
 */
export function advanceLedger(
  t: NonNullable<SessionState['troubleshooting']>,
  resolved: boolean,
): NonNullable<SessionState['troubleshooting']> {
  const hypotheses = t.hypotheses.map((h) => ({ ...h }));
  const current = hypotheses.find((h) => h.status === 'testing');
  if (resolved) {
    if (current) current.status = 'confirmed';
    return { ...t, hypotheses, resolved: true, rootCause: t.rootCause ?? current?.text };
  }
  if (current) current.status = 'rejected';
  // ponytail: promote the next untested hypothesis in rank order. When every
  // hypothesis is exhausted the ledger simply has nothing `testing` — escalating
  // (asking for logs, generating new hypotheses) needs the model.
  const next = hypotheses.find((h) => h.status === 'untested');
  if (next) next.status = 'testing';
  return { ...t, hypotheses, resolved: false };
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

function seedTroubleshooting(message: string, _s: DeterministicSignals): SessionState['troubleshooting'] {
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

/** How the returned plan was produced (EP-OBS-02):
 *  'deterministic' — no model call was attempted at all (no provider, or a free
 *     greeting/thanks short-circuit) — this is by design, not a degradation.
 *  'model'         — the planning model's structured call succeeded and parsed.
 *  'fallback'      — a model call was attempted and silently degraded to the
 *     regex-based fallbackPlan (unparseable JSON or a thrown ModelError); this
 *     IS a quality degradation and must be observable. `reason` says why. */
export type PlanRoute = 'deterministic' | 'model' | 'fallback';

export async function makePlan(
  message: string,
  state: SessionState,
  provider: ModelProvider | null,
  signal?: AbortSignal,
): Promise<{ plan: AgentPlan; usage: Usage; route: PlanRoute; reason?: string }> {
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
    const raw = extractJson(res.text);
    const parsed = PlanSchema.safeParse(raw);
    if (!parsed.success) return { plan: fallback, usage: res.usage, route: 'fallback', reason: 'parse-error' };
    // A delta-shaped troubleshooting patch may omit `problem`; restore the one
    // the flow started with so the retained problem statement never drifts to
    // whatever the last follow-up said (EP-AGT-01/EP-AGT-03).
    const t = parsed.data.statePatch.troubleshooting;
    if (t && !t.problem) t.problem = state.troubleshooting?.problem ?? message.slice(0, 200);
    // a dropped limb is otherwise invisible: `route` still names the model
    const dropped = droppedPatchKeys(raw, parsed.data.statePatch);
    if (dropped.length) log('warn', 'plan_patch_partial', { dropped, route: route.model });
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
    // Deterministic flow-control also wins: an unresolved ledger owns a "still
    // broken" follow-up even if the model called it a plain question, which
    // would drop the user out of the Fix flow into a refusal (EP-AGT-04).
    if (state.troubleshooting && !state.troubleshooting.resolved && signals.isContinuation) {
      plan.intent = 'troubleshooting';
      if (!plan.retrievalQueries.length) {
        plan.retrievalQueries = [(state.context.knownError ?? state.troubleshooting.problem).slice(0, 200)];
      }
    }
    // a check the user reports having done is worth keeping even when the model
    // forgot to record it — it is the anti-repetition signal (EP-AGT-09)
    if (signals.triedAction && !plan.statePatch.context?.triedActions?.length) {
      plan.statePatch.context = { ...plan.statePatch.context, triedActions: [signals.triedAction] } as SessionState['context'];
    }
    if (!plan.retrievalQueries.length && plan.action === 'answer') plan.retrievalQueries = [message.slice(0, 200)];
    return { plan, usage: res.usage, route: 'model' };
  } catch (e) {
    if ((e as Error).name === 'ClientAbortError') throw e; // don't answer a gone client
    return { plan: fallback, usage: zero(), route: 'fallback', reason: 'model-error' };
  }
}

/** statePatch keys the model sent that the schema rejected and dropped. */
function droppedPatchKeys(raw: unknown, patch: Record<string, unknown>): string[] {
  const sent = (raw as { statePatch?: Record<string, unknown> } | null)?.statePatch;
  if (!sent || typeof sent !== 'object') return [];
  return Object.keys(sent).filter((k) => sent[k] !== undefined && sent[k] !== null && patch[k] === undefined);
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
