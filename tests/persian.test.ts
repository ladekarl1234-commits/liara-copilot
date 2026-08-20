import { describe, it, expect } from 'vitest';
import { normalizeFa, tokenizeFa, detectLanguage, normalizedKey } from '@/lib/text/persian';

describe('normalizeFa', () => {
  it('maps arabic yeh/kaf/teh-marbuta to persian forms', () => {
    expect(normalizeFa('علي')).toBe('علی');
    expect(normalizeFa('ديدن')).toBe('دیدن');
    expect(normalizeFa('كتاب')).toBe('کتاب');
    expect(normalizeFa('شبكة')).toBe('شبکه');
  });

  it('strips diacritics and tatweel', () => {
    expect(normalizeFa('مُدَرِّس')).toBe('مدرس');
    expect(normalizeFa('کـتـاب')).toBe('کتاب');
  });

  it('converts persian and arabic digits to ascii', () => {
    expect(normalizeFa('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normalizeFa('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeFa('نسخه ۱۲')).toBe('نسخه 12');
  });

  it('lowercases latin', () => {
    expect(normalizeFa('Next.JS DATABASE_URL')).toBe('next.js database_url');
  });
});

describe('tokenizeFa', () => {
  it('emits the real morphemes for a pure-Persian ZWNJ word (no joined non-word)', () => {
    // پیش‌فرض → parts پیش + فرض. The joined "پیشفرض" is NOT emitted for
    // pure-Persian words (it only inflated coverage); the same parts are
    // produced at index time so a doc using "پیش‌فرض" still matches.
    const toks = tokenizeFa('پیش‌فرض');
    expect(toks).toContain('پیش');
    expect(toks).toContain('فرض');
    expect(toks).not.toContain('پیشفرض');
  });

  it('splits DATABASE_URL into joined identifier + parts (with synonym fold)', () => {
    const toks = tokenizeFa('DATABASE_URL');
    expect(toks).toContain('databaseurl'); // exact identifier preserved
    expect(toks).toContain('دیتابیس'); // "database" folds to the canonical Persian concept
    expect(toks).toContain('url');
  });

  it('folds connect-family synonyms to a canonical token', () => {
    // وصل / متصل / اتصال all mean "connect" — folded so they match each other
    expect(tokenizeFa('وصل')).toContain('اتصال');
    expect(tokenizeFa('متصل')).toContain('اتصال');
    expect(tokenizeFa('connect')).toContain('اتصال');
  });

  it('never resolves an inherited Object key to a non-string token', () => {
    // 'constructor'/'toString' appear in JS code blocks — must stay strings
    for (const t of tokenizeFa('constructor toString hasOwnProperty')) {
      expect(typeof t).toBe('string');
    }
  });

  it('splits next.js into joined + parts', () => {
    const toks = tokenizeFa('next.js');
    expect(toks).toContain('nextjs');
    expect(toks).toContain('next');
    expect(toks).toContain('js');
  });

  it('keeps plain words as-is', () => {
    expect(tokenizeFa('لیارا')).toEqual(['لیارا']);
  });
});

describe('detectLanguage', () => {
  it('detects persian', () => {
    expect(detectLanguage('سلام دنیا')).toBe('fa');
  });

  it('detects english', () => {
    expect(detectLanguage('hello world')).toBe('en');
  });

  it('mixed but persian-dominant is fa', () => {
    expect(detectLanguage('چطور DATABASE_URL را تنظیم کنم')).toBe('fa');
  });

  it('mixed but latin-dominant is en', () => {
    expect(detectLanguage('deploy the nextjs application با')).toBe('en');
  });

  it('empty / no letters is en', () => {
    expect(detectLanguage('123 !?')).toBe('en');
  });
});

describe('normalizedKey', () => {
  it('is stable across equivalent spellings', () => {
    expect(normalizedKey('علي')).toBe(normalizedKey('علی'));
    expect(normalizedKey('نصب Next.JS')).toBe(normalizedKey('نصب next.js'));
    expect(normalizedKey('۱۲ گیگ')).toBe(normalizedKey('12 گیگ'));
  });

  it('is deterministic', () => {
    const q = 'تنظیم DATABASE_URL در پیش‌فرض';
    expect(normalizedKey(q)).toBe(normalizedKey(q));
  });

  it('keeps token order', () => {
    expect(normalizedKey('الف ب پ')).toBe('الف ب پ');
  });
});
