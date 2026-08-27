import { describe, expect, it } from 'vitest';
import {
  buildPrefixTsQuery,
  normalizeDigits,
  persianNormalize,
  toPersianDigits,
} from './normalize.js';
import { cleanIsbn, isbn10To13, isValidIsbn, toCanonicalIsbn13 } from './isbn.js';

describe('persianNormalize', () => {
  it('یای عربی را به یای فارسی تبدیل می‌کند', () => {
    // U+064A (ي عربی) در برابر U+06CC (ی فارسی)
    expect(persianNormalize('ايران')).toBe(persianNormalize('ایران'));
    expect(persianNormalize('ايران')).toBe('ایران');
  });

  it('کاف عربی را به کاف فارسی تبدیل می‌کند', () => {
    expect(persianNormalize('كتاب')).toBe('کتاب');
    expect(persianNormalize('كتاب')).toBe(persianNormalize('کتاب'));
  });

  it('نیم‌فاصله را حذف می‌کند تا کلمه یکپارچه شود', () => {
    expect(persianNormalize('کتاب‌ها')).toBe('کتابها');
  });

  it('اعراب و کشیده را حذف می‌کند', () => {
    expect(persianNormalize('كِتـــاب')).toBe('کتاب');
  });

  it('فاصله اضافه را جمع می‌کند و trim می‌زند', () => {
    expect(persianNormalize('  دیوان    حافظ  ')).toBe('دیوان حافظ');
  });

  it('ارقام فارسی و عربی را به لاتین تبدیل می‌کند', () => {
    expect(persianNormalize('چاپ ۱۲')).toBe('چاپ 12');
    expect(persianNormalize('چاپ ١٢')).toBe('چاپ 12');
  });

  it('انواع الف را یکسان می‌کند', () => {
    expect(persianNormalize('آذر')).toBe('اذر');
    expect(persianNormalize('أمير')).toBe('امیر');
  });

  it('علائم نگارشی را به فاصله تبدیل می‌کند', () => {
    expect(persianNormalize('«دیوان حافظ»')).toBe('دیوان حافظ');
    expect(persianNormalize('حافظ، دیوان')).toBe('حافظ دیوان');
  });

  it('حروف لاتین را کوچک می‌کند', () => {
    expect(persianNormalize('Divan Of HAFEZ')).toBe('divan of hafez');
  });

  it('ورودی خالی یا null را به رشته خالی تبدیل می‌کند', () => {
    expect(persianNormalize(null)).toBe('');
    expect(persianNormalize(undefined)).toBe('');
    expect(persianNormalize('')).toBe('');
  });

  it('کلمات متفاوت را یکسان نمی‌کند (حافظ در برابر حافض)', () => {
    expect(persianNormalize('حافظ')).not.toBe(persianNormalize('حافض'));
  });
});

describe('normalizeDigits', () => {
  it('فقط ارقام را تغییر می‌دهد و بقیه متن را دست‌نخورده می‌گذارد', () => {
    expect(normalizeDigits('شابک ۹۷۸-۶۰۰')).toBe('شابک 978-600');
  });
});

describe('toPersianDigits', () => {
  it('برای نمایش، ارقام را فارسی می‌کند', () => {
    expect(toPersianDigits(1405)).toBe('۱۴۰۵');
    expect(toPersianDigits('BK-000123')).toBe('BK-۰۰۰۱۲۳');
  });
});

describe('buildPrefixTsQuery', () => {
  it('کوئری پیشوندی امن می‌سازد', () => {
    expect(buildPrefixTsQuery('دیوان حافظ')).toBe('دیوان:* & حافظ:*');
  });

  it('کاراکترهای خطرناک tsquery را حذف می‌کند', () => {
    const q = buildPrefixTsQuery("حافظ' | 1=1 --");
    expect(q).not.toContain('|');
    expect(q).not.toContain("'");
  });

  it('برای ورودی خالی رشته خالی برمی‌گرداند', () => {
    expect(buildPrefixTsQuery('   ')).toBe('');
  });
});

describe('ISBN', () => {
  it('شابک ۱۰ رقمی معتبر را می‌پذیرد', () => {
    expect(isValidIsbn('0-306-40615-2')).toBe(true);
  });

  it('شابک ۱۳ رقمی معتبر را می‌پذیرد', () => {
    expect(isValidIsbn('978-0-306-40615-7')).toBe(true);
  });

  it('شابک نامعتبر را رد می‌کند', () => {
    expect(isValidIsbn('978-0-306-40615-0')).toBe(false);
  });

  it('ارقام فارسی در شابک را می‌پذیرد', () => {
    expect(cleanIsbn('۹۷۸۰۳۰۶۴۰۶۱۵۷')).toBe('9780306406157');
    expect(isValidIsbn('۹۷۸-۰-۳۰۶-۴۰۶۱۵-۷')).toBe(true);
  });

  it('شابک ۱۰ رقمی را به ۱۳ رقمی تبدیل می‌کند', () => {
    expect(isbn10To13('0-306-40615-2')).toBe('9780306406157');
  });

  it('شکل متعارف هر دو نوع شابک یکسان است (کلید تشخیص تکراری)', () => {
    expect(toCanonicalIsbn13('0-306-40615-2')).toBe(toCanonicalIsbn13('978-0-306-40615-7'));
  });

  it('برای شابک نامعتبر null برمی‌گرداند', () => {
    expect(toCanonicalIsbn13('12345')).toBeNull();
  });
});
