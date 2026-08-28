import {
  formatJalaliDate, formatJalaliDateTime,
} from '../src/common/utils/jalali-format';

/**
 * تبدیل تاریخ برای متن‌هایی که سرور می‌سازد (قانون ۶۸).
 *
 * اشکالی که این تست می‌بندد: متن یادآوری با
 * `dueAt.toLocaleDateString('fa-IR')` ساخته می‌شد، بدون تعیین منطقه زمانی.
 * روی کانتینر که ساعتش UTC است، موعدِ بامداد به وقت تهران یک روز عقب‌تر
 * نمایش داده می‌شد — یعنی به عضو تاریخ اشتباه گفته می‌شد.
 */
describe('قالب‌بندی تاریخ شمسی در سرور', () => {
  const originalTz = process.env.TZ;
  afterAll(() => { process.env.TZ = originalTz; });

  it('تاریخ را با منطقه زمانی تهران می‌سنجد، نه منطقه زمانی سرور', () => {
    // ۲۰:۳۰ به وقت جهانی = ۰۰:۰۰ بامداد روز بعد به وقت تهران (+۳:۳۰)
    const nearMidnightTehran = new Date('2026-09-06T20:30:00.000Z');

    // ۶ سپتامبر ۲۰۲۶ = ۱۵ شهریور ۱۴۰۵ → لحظه بالا در تهران ۱۶ شهریور است
    expect(formatJalaliDate(nearMidnightTehran)).toBe('۱۴۰۵/۰۶/۱۶');

    // همان لحظه در UTC هنوز ۶ سپتامبر (۱۵ شهریور) است — تفاوت دقیقاً همان
    // اشکالی است که این تابع حل می‌کند.
    const utcView = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
    }).format(nearMidnightTehran);
    expect(utcView).toBe('۱۴۰۵/۰۶/۱۵');
  });

  it('ماه و روز را با صفر پیشوند می‌دهد تا با بقیه رابط کاربری یکدست باشد', () => {
    // ۲۱ مارس ۲۰۲۶ ظهر = ۱ فروردین ۱۴۰۵
    expect(formatJalaliDate(new Date('2026-03-21T12:00:00.000Z'))).toBe('۱۴۰۵/۰۱/۰۱');
  });

  it('ساعت را هم به وقت تهران و ۲۴ ساعته می‌دهد', () => {
    const value = new Date('2026-09-06T09:00:00.000Z'); // ۱۲:۳۰ تهران
    // جداکننده «، » پیش‌فرض ICU برای fa-IR است؛ سمت وب هم دقیقاً همین خروجی
    // را می‌دهد و هدف، یکدستی بین دو سمت است.
    expect(formatJalaliDateTime(value)).toBe('۱۴۰۵/۰۶/۱۵, ۱۲:۳۰');
  });

  it('برای مقدار خالی، متن جایگزین می‌دهد و خطا نمی‌اندازد', () => {
    expect(formatJalaliDate(null)).toBe('—');
    expect(formatJalaliDate(undefined, '')).toBe('');
    expect(formatJalaliDate(new Date('نامعتبر'))).toBe('—');
  });
});
