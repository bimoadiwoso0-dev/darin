import { describe, expect, it } from 'vitest';
import { parseBookDictation } from './dictation.js';

/**
 * تجزیه جمله دیکته‌شده.
 *
 * جمله‌های این تست‌ها عمداً همان‌طور نوشته شده‌اند که یک کتابدار واقعاً
 * می‌گوید — با «و»، با ویرگول، و گاهی بدون ترتیب.
 */
describe('parseBookDictation', () => {
  it('رکورد کامل گفته‌شده را به فیلدها تقسیم می‌کند', () => {
    const r = parseBookDictation(
      'عنوان قلعه حیوانات، نویسنده جورج اورول، مترجم امیر امیرشاهی، ' +
        'ناشر امیرکبیر، سال هزار و سیصد و نود و نه، تعداد صفحه صد و بیست',
    );

    expect(r.text.title).toBe('قلعه حیوانات');
    expect(r.text.publisherName).toBe('امیرکبیر');
    expect(r.numbers.publicationYear).toBe(1399);
    expect(r.numbers.pageCount).toBe(120);
    expect(r.contributors).toEqual([
      { role: 'AUTHOR', fullName: 'جورج اورول' },
      { role: 'TRANSLATOR', fullName: 'امیر امیرشاهی' },
    ]);
    expect(r.unrecognized).toBe('');
  });

  it('بدون هیچ کلیدواژه‌ای، کل جمله عنوان است', () => {
    // رایج‌ترین حالت: کتابدار فقط نام کتاب را می‌گوید
    const r = parseBookDictation('صد سال تنهایی');
    expect(r.text.title).toBe('صد سال تنهایی');
    expect(r.contributors).toEqual([]);
    // «سال» داخل عنوان نباید فیلد سال انتشار را پر کند
    expect(r.numbers.publicationYear).toBeUndefined();
  });

  it('واژه‌های معمولی زبان داخل عنوان، عنوان را تکه‌تکه نمی‌کنند', () => {
    /*
     * بدترین حالت ممکن این ابزار: داده‌ای در فیلدی بنشیند که کتابدار
     * قصدش را نداشته. «سال»، «جلد»، «چاپ» و «صفحه» در عنوان‌های واقعی
     * فراوان‌اند، پس فقط با جداکننده یا با مقدار هم‌جنس کلیدواژه می‌شوند.
     */
    const r = parseBookDictation('عنوان صد سال تنهایی، نویسنده گابریل گارسیا مارکز');
    expect(r.text.title).toBe('صد سال تنهایی');
    expect(r.numbers.publicationYear).toBeUndefined();
    expect(r.contributors).toEqual([
      { role: 'AUTHOR', fullName: 'گابریل گارسیا مارکز' },
    ]);

    expect(parseBookDictation('سال بلوا').text.title).toBe('سال بلوا');
    expect(parseBookDictation('جلد دوم شاهنامه').text.title).toBe('جلد دوم شاهنامه');
  });

  it('کلیدواژه غیرقاطع با مقدار هم‌جنس پذیرفته می‌شود', () => {
    // بدون ویرگول هم، «سال هزار و چهارصد» روشن است چون مقدارش عدد است
    const r = parseBookDictation('عنوان کیمیاگر ناشر ققنوس سال هزار و چهارصد');
    expect(r.text.title).toBe('کیمیاگر');
    expect(r.numbers.publicationYear).toBe(1400);
  });

  it('کلیدواژه بلندتر بر کوتاه‌تر مقدم است', () => {
    // «عنوان کتاب» نباید به «عنوان» + مقدار «کتاب …» تجزیه شود
    const r = parseBookDictation('عنوان کتاب بوف کور');
    expect(r.text.title).toBe('بوف کور');
  });

  it('کلیدواژه داخل واژه دیگر شمرده نمی‌شود', () => {
    /*
     * «سال» داخل «سالار» و «چاپ» داخل «چاپخانه» نباید کلیدواژه شمرده
     * شود. `\b` جاوااسکریپت روی فارسی این را تضمین نمی‌کند و همین‌جا
     * قفل می‌شود.
     */
    const r = parseBookDictation('عنوان سالار مگس‌ها');
    expect(r.text.title).toBe('سالار مگس‌ها');
    expect(r.numbers.publicationYear).toBeUndefined();
  });

  it('چند پدیدآورنده با «و» یا ویرگول جدا می‌شوند', () => {
    const r = parseBookDictation('نویسنده محمد رضایی و زهرا کریمی، مترجم علی نوری');
    expect(r.contributors).toEqual([
      { role: 'AUTHOR', fullName: 'محمد رضایی' },
      { role: 'AUTHOR', fullName: 'زهرا کریمی' },
      { role: 'TRANSLATOR', fullName: 'علی نوری' },
    ]);
  });

  it('شابک را رقم به رقم می‌چیند، نه به‌صورت عدد', () => {
    const r = parseBookDictation(
      'عنوان تست، شابک نه هفت هشت شش صفر صفر یک دو سه چهار پنج شش هفت',
    );
    expect(r.isbn).toBe('9786001234567');
    // نباید به‌جای شابک، عددی جمع‌زده بنشیند
    expect(r.numbers.publicationYear).toBeUndefined();
  });

  it('زبان را به کد ISO تبدیل می‌کند', () => {
    expect(parseBookDictation('عنوان تست، زبان انگلیسی').language).toBe('en');
    expect(parseBookDictation('عنوان تست، زبان فارسی').language).toBe('fa');
    expect(parseBookDictation('عنوان تست، زبان عربی است').language).toBe('ar');
  });

  it('واژه‌های ربط پس از کلیدواژه را از مقدار حذف می‌کند', () => {
    const r = parseBookDictation('عنوان: بوف کور. ناشر: نشر چشمه است');
    expect(r.text.title).toBe('بوف کور');
    expect(r.text.publisherName).toBe('چشمه');
  });

  it('ترتیب گفتن اهمیتی ندارد', () => {
    const r = parseBookDictation('ناشر ققنوس، سال هزار و چهارصد، عنوان کیمیاگر');
    expect(r.text.title).toBe('کیمیاگر');
    expect(r.text.publisherName).toBe('ققنوس');
    expect(r.numbers.publicationYear).toBe(1400);
  });

  it('عددی که عدد نیست را به فیلد عددی نمی‌نشاند', () => {
    // اگر تشخیص گفتار «سال» را اشتباه بشنود، فیلد سال نباید متن بگیرد
    const r = parseBookDictation('عنوان تست، سال نامشخص');
    expect(r.numbers.publicationYear).toBeUndefined();
    expect(r.unrecognized).toContain('نامشخص');
  });

  it('حرف‌های پیش از اولین کلیدواژه را شناخته‌نشده گزارش می‌کند', () => {
    // کتابدار را از قلم افتادن بخشی از گفته‌اش آگاه نگه می‌دارد
    const r = parseBookDictation('خب بذار ببینم، عنوان بوف کور');
    expect(r.text.title).toBe('بوف کور');
    expect(r.unrecognized).toContain('خب بذار ببینم');
  });

  it('نویسه‌های عربی موتور تشخیص گفتار را یکسان می‌بیند', () => {
    // موتور گاهی «ي» و «ك» عربی برمی‌گرداند
    const r = parseBookDictation('عنوان كتاب كيمياگر، ناشر ققنوس');
    expect(r.text.title).toBe('کیمیاگر');
    expect(r.text.publisherName).toBe('ققنوس');
  });

  it('نوبت چاپ و جلد را می‌گیرد', () => {
    const r = parseBookDictation('عنوان تست، نوبت چاپ سوم، شماره جلد دو');
    expect(r.numbers.edition).toBe(3);
    expect(r.numbers.volumeNumber).toBe(2);
  });

  it('ورودی خالی، نتیجه خالی می‌دهد و خطا نمی‌اندازد', () => {
    const r = parseBookDictation('');
    expect(r.text).toEqual({});
    expect(r.contributors).toEqual([]);
    expect(parseBookDictation(null).text.title).toBeUndefined();
  });
});
