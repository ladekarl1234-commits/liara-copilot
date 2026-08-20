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
    out.push(joined);
    if (parts.length > 1) for (const p of parts) if (p.length > 1) out.push(p);
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
