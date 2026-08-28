import { describe, expect, it } from 'vitest';
import { persianWordsToDigits, persianWordsToNumber } from './numbers.js';

describe('persianWordsToNumber', () => {
  it('سال شمسی گفته‌شده را می‌فهمد', () => {
    expect(persianWordsToNumber('هزار و سیصد و نود و نه')).toBe(1399);
    expect(persianWordsToNumber('هزار و چهارصد و پنج')).toBe(1405);
    expect(persianWordsToNumber('هزار و سیصد و هشتاد')).toBe(1380);
  });

  it('سال میلادی را هم می‌فهمد', () => {
    expect(persianWordsToNumber('دو هزار و بیست و شش')).toBe(2026);
    expect(persianWordsToNumber('هزار و نهصد و هشتاد و چهار')).toBe(1984);
  });

  it('«هزار» بدون عدد یعنی یک هزار', () => {
    expect(persianWordsToNumber('هزار')).toBe(1000);
    expect(persianWordsToNumber('هزار و پنجاه')).toBe(1050);
  });

  it('گویش محاوره‌ای را می‌پذیرد', () => {
    // آنچه واقعاً گفته می‌شود، نه آنچه در کتاب دستور زبان نوشته شده
    expect(persianWordsToNumber('پونصد')).toBe(500);
    expect(persianWordsToNumber('شونزده')).toBe(16);
    expect(persianWordsToNumber('شیش')).toBe(6);
    expect(persianWordsToNumber('هزار و سیصد و نود و شیش')).toBe(1396);
  });

  it('رقم نوشته‌شده را هم می‌پذیرد', () => {
    expect(persianWordsToNumber('۱۳۹۹')).toBe(1399);
    expect(persianWordsToNumber('1399')).toBe(1399);
  });

  it('برای متنی که عدد نیست، null می‌دهد', () => {
    // تفاوت «صفر» و «عدد نیست» باید برای فراخوان قابل تشخیص باشد
    expect(persianWordsToNumber('قلعه حیوانات')).toBeNull();
    expect(persianWordsToNumber('')).toBeNull();
    expect(persianWordsToNumber(null)).toBeNull();
    expect(persianWordsToNumber('صفر')).toBe(0);
  });

  it('نویسه‌های هم‌ارز عربی را یکسان می‌بیند', () => {
    // موتور تشخیص گفتار گاهی «ی» عربی برمی‌گرداند
    expect(persianWordsToNumber('هزار و سيصد و نود و نه')).toBe(1399);
  });

  it('عدد صفحه و تیراژ را می‌شمارد', () => {
    expect(persianWordsToNumber('صد و بیست')).toBe(120);
    expect(persianWordsToNumber('دویست و چهل و هشت')).toBe(248);
    expect(persianWordsToNumber('سه هزار')).toBe(3000);
  });
});

describe('persianWordsToDigits', () => {
  it('شابک گفته‌شده رقم به رقم را می‌چیند', () => {
    expect(persianWordsToDigits('نه هفت هشت شش صفر صفر یک دو سه چهار پنج شش هفت'))
      .toBe('9786001234567');
  });

  it('رقم‌های نوشته‌شده و جداکننده‌ها را می‌پذیرد', () => {
    expect(persianWordsToDigits('۹۷۸-۶۰۰-۱۲۳')).toBe('978600123');
    expect(persianWordsToDigits('978 600 123')).toBe('978600123');
  });

  it('«و» را جداکننده می‌گیرد، نه رقم', () => {
    expect(persianWordsToDigits('یک و دو و سه')).toBe('123');
  });

  it('برخلاف تبدیل عدد، ارقام را جمع نمی‌زند', () => {
    // «نه هفت هشت» به‌عنوان عدد ۲۴ می‌شد؛ به‌عنوان شابک باید ۹۷۸ بماند
    expect(persianWordsToNumber('نه هفت هشت')).toBe(24);
    expect(persianWordsToDigits('نه هفت هشت')).toBe('978');
  });

  it('برای متن غیرعددی رشته خالی می‌دهد', () => {
    expect(persianWordsToDigits('قلعه حیوانات')).toBe('');
    expect(persianWordsToDigits(null)).toBe('');
  });
});
