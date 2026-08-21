// Persian text normalization + tokenization shared by the index build and the
// query side. Index and query MUST use the exact same functions.

const DIACRITICS = /[ً-ٰٟـ]/g; // tashkeel + tatweel
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Canonical Persian form: ي→ی ك→ک ة→ه, strip diacritics/tatweel, fa/ar digits→ASCII, lowercase latin. */
export function normalizeFa(input: string): string {
  let s = input.replace(DIACRITICS, '');
  s = s
    .replace(/[يئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[أإٱ]/g, 'ا')
    .replace(/ؤ/g, 'و');
  s = s.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    if (i >= 0) return String(i);
    return String(PERSIAN_DIGITS.indexOf(d));
  });
  return s.toLowerCase();
}

// Concept-family canonicalization: Liara docs and users use different words
// for the same concept (وصل/متصل/اتصال = "connect"). Folding each family
// member to one canonical token — applied identically at index and query time
// via tokenizeFa — closes the synonym gap that made 3 of 4 landing chips
// refuse. Curated + high-confidence only (not a broad thesaurus) to avoid
// false matches. Keys are post-normalizeFa forms.
const SYNONYM_CANON: Record<string, string> = {
  // connect
  وصل: 'اتصال', متصل: 'اتصال', کانکت: 'اتصال', connect: 'اتصال', connecting: 'اتصال', connection: 'اتصال',
  // deploy
  دیپلوی: 'استقرار', مستقر: 'استقرار', دیپلویمنت: 'استقرار', deploy: 'استقرار', deployment: 'استقرار', deploying: 'استقرار',
  // env vars
  انوایرمنت: 'متغیر', env: 'متغیر', envs: 'متغیر',
  // domain
  دامین: 'دامنه', domain: 'دامنه', subdomain: 'زیردامنه',
  // database
  دیتابیس: 'دیتابیس', database: 'دیتابیس', db: 'دیتابیس', پایگاهداده: 'دیتابیس',
  // error / troubleshooting
  ارور: 'خطا', error: 'خطا', اکسپشن: 'خطا', exception: 'خطا',
  // create / setup
  بساز: 'ساخت', ایجاد: 'ساخت', راهاندازی: 'ساخت', setup: 'ساخت', create: 'ساخت',
  // remove
  حذف: 'حذف', پاک: 'حذف', delete: 'حذف', remove: 'حذف',
  // logs
  لاگ: 'لاگ', log: 'لاگ', logs: 'لاگ',
  // Possessive-clitic forms of the core product nouns ("my disk", "my bucket").
  // Users type these constantly and the (formal) docs never do, so the form is
  // both unretrievable and un-matchable at the gate.
  // ponytail: an explicit list, NOT a suffix stripper — a general -م/-ت/-ش rule
  // mangles ordinary Persian words (افزایش→افزای, سیستم→سیس, ساخت→ساخ) on the
  // index side too. Extend the list when evals surface a new one; only reach for
  // a real morphological analyzer (hazm/parsivar) if it grows past ~30 entries.
  دیتابیسم: 'دیتابیس', دیسکم: 'دیسک', باکتم: 'باکت', ایمیجم: 'ایمیج',
  کاربرانم: 'کاربران', قیمتش: 'قیمت', علتش: 'علت', خطاش: 'خطا', لاگش: 'لاگ',
  // certificate / ssl
  گواهی: 'گواهی', certificate: 'گواهی', ssl: 'گواهی',
};

const SYNONYM_MAP = new Map(Object.entries(SYNONYM_CANON));
function canon(token: string): string {
  // Map lookup — NOT `obj[token]`, which would resolve inherited keys like
  // "constructor"/"toString" (present in JS code blocks) to a function.
  return SYNONYM_MAP.get(token) ?? token;
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}._\-‌]*/gu;

/**
 * Tokenize normalized text. Technical tokens ("next.js", "DATABASE_URL",
 * "پیش‌فرض") additionally emit their joined form and their parts so users can
 * match them however they type them.
 */
export function tokenizeFa(text: string): string[] {
  const out: string[] = [];
  const matches = normalizeFa(text).match(TOKEN_RE) ?? [];
  for (const raw of matches) {
    const t = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (!t) continue;
    const parts = t.split(/[._\-‌]+/).filter(Boolean);
    const joined = parts.join('');
    const hasLatinDigit = /[a-z0-9]/i.test(t);
    if (hasLatinDigit || parts.length === 1) {
      // identifiers (next.js, DATABASE_URL) and single tokens: emit the joined
      // form, plus the sub-parts for identifiers so users can match any spelling
      out.push(canon(joined));
      if (hasLatinDigit && parts.length > 1) for (const p of parts) if (p.length > 1) out.push(canon(p));
    } else {
      // pure-Persian ZWNJ word (پروژه‌ام, می‌خواهم): the joined form is a
      // non-word ("پروژهام") that only inflates coverage — emit the real
      // morphemes and let stopwords drop the clitics (ام, می, …).
      for (const p of parts) if (p.length > 1) out.push(canon(p));
    }
  }
  return out;
}

/** Rough language detection for a user message. */
export function detectLanguage(text: string): 'fa' | 'en' {
  const fa = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return fa >= latin * 0.5 && fa > 0 ? 'fa' : 'en';
}

/** Key used for caches and gap records: normalized, tokenized, order kept. */
export function normalizedKey(text: string): string {
  return tokenizeFa(text).join(' ');
}

// Stopwords carry no evidence about WHICH doc answers a query: function words
// (fa+en) plus domain-ubiquitous terms (liara appears in every page).
const STOPWORDS = new Set([
  // fa function words
  'از', 'در', 'به', 'با', 'که', 'را', 'و', 'یا', 'برای', 'تا', 'هم', 'این',
  'آن', 'چه', 'کدام', 'چیست', 'چیه', 'چطور', 'چگونه', 'چرا', 'کی', 'کجا',
  'آیا', 'اگر', 'باید', 'بدون', 'روی', 'مثل', 'مثلا', 'لطفا', 'سلام', 'خب',
  'کنم', 'کنید', 'کنیم', 'کرد', 'کردم', 'میکنم', 'میشود', 'میشه', 'نمیشه',
  'شود', 'بشه', 'است', 'هست', 'نیست', 'دارم', 'دارد', 'داره', 'ندارم',
  'شده', 'بشود', 'من', 'ما', 'شما', 'خودم', 'وقتی', 'الان', 'دیگه', 'یک',
  'چند', 'همه', 'فقط', 'ولی', 'اما', 'پس', 'بعد', 'قبل', 'داخل', 'روش',
  // Persian clitics / verb fragments left by ZWNJ splitting (پروژه‌ام → ام,
  // می‌خواهم → می/خواهم) — these carry no doc-discriminating signal
  'ام', 'ات', 'اش', 'مان', 'تان', 'شان', 'مون', 'تون', 'شون', 'هام',
  'می', 'نمی', 'ها', 'های', 'هایی', 'تر', 'ترین', 'ای', 'خواهم', 'میخواهم',
  'میخوام', 'خوام', 'بکنم', 'کنه',
  // Colloquial/spoken Persian function words and light verbs. These are how a
  // real user actually types a question ("چطور ... رو توی ... بذارم که از بیرون
  // قابل دسترسی نباشن"), and they are NOT in the (written, formal) docs corpus,
  // so every one of them used to land in the gate's denominator as an
  // unmatchable token and drag a perfectly-retrieved query below the coverage
  // floor. They carry zero information about WHICH page answers the question.
  // (EP-ANS-01; the OOV set was harvested from evals/cases against the index.)
  'رو', 'توی', 'تو', 'یه', 'موقع', 'جا', 'جایی', 'هر', 'اگه', 'چی',
  'چیکار', 'چطوریه', 'چنده', 'کدوم', 'قابل', 'بیرون', 'لازمه', 'مناسبه',
  'شکلیه', 'مدام', 'ظاهرا', 'بعضی', 'کن', 'بگو', 'برایم', 'نگه',
  // discourse markers — they frame the question, they never identify the page
  'چیزی', 'چیز', 'درباره', 'منظورم', 'منظورت', 'یعنی', 'حالا', 'خیلی',
  'واقعا', 'اصلا', 'کاملا', 'ضمنا', 'همچنین', 'بنابراین',
  // light/auxiliary verb forms (بودن/شدن/داشتن/کردن/گرفتن/دادن conjugations)
  'بذارم', 'بشن', 'بشم', 'نباشن', 'نباشم', 'نیستن', 'نمیشن', 'هستن', 'هستند',
  'دارن', 'دارند', 'داشته', 'باشم', 'باشد', 'باشه', 'بتونم', 'میتونم', 'میده',
  'میدید', 'میاد', 'بدم', 'بده', 'بگیر', 'بگیرم', 'گیرم', 'بیارم', 'ببرم',
  'بندازم', 'بزنن', 'بفرستم', 'کردنش', 'بهم', 'بهشون', 'خورده', 'شدم',
  // en function words
  'how', 'do', 'does', 'the', 'my', 'your', 'a', 'an', 'to', 'for', 'on',
  'in', 'with', 'can', 'i', 'is', 'are', 'it', 'and', 'of', 'or', 'what',
  'why', 'when', 'where', 'not', 'no', 'about', 'me', 'we', 'you', 'should',
  'would', 'there', 'this', 'that', 'get', 'have', 'has', 'want', 'need',
  'please', 'help',
  // domain-ubiquitous
  'لیارا', 'liara', 'برنامه', 'app', 'application',
]);

/** Tokens that actually discriminate between docs (stopwords removed). */
export function informativeTokens(text: string): string[] {
  return tokenizeFa(text).filter((t) => !STOPWORDS.has(t));
}
