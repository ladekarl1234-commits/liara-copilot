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
  it('emits joined form for ZWNJ words plus parts', () => {
    const toks = tokenizeFa('پیش‌فرض');
    expect(toks).toContain('پیشفرض');
    expect(toks).toContain('پیش');
    expect(toks).toContain('فرض');
  });

  it('splits DATABASE_URL into joined + parts', () => {
    const toks = tokenizeFa('DATABASE_URL');
    expect(toks).toContain('databaseurl');
    expect(toks).toContain('database');
    expect(toks).toContain('url');
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
