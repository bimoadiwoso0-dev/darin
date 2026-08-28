/**
 * قالب‌بندی تاریخ شمسی در سمت سرور.
 *
 * ── چرا این فایل وجود دارد ──────────────────────────────────────────────
 * سرور تاریخ‌ها را همیشه به‌صورت `timestamptz` استاندارد ذخیره می‌کند و
 * تبدیل به شمسی فقط برای *نمایش* است (قانون ۶۸). اما چند جا در سرور هم
 * متنِ نهایی ساخته می‌شود: متن یادآوری‌ها و سرصفحه فایل‌های Excel. آنجا
 * تبدیل ناگزیر است.
 *
 * ── چرا `toLocaleDateString('fa-IR')` کافی نیست ─────────────────────────
 * دو مشکل دارد:
 *
 * ۱. **منطقه زمانی سرور را می‌گیرد.** کانتینر معمولاً روی UTC است. موعد
 *    بازگشتِ ۲۰:۳۰ به وقت تهران، در UTC هنوز همان روز است ولی موعدِ
 *    ۰۱:۰۰ بامداد تهران در UTC روز *قبل* است — یعنی متن یادآوری یک روز
 *    اشتباه به عضو می‌گفت.
 * ۲. تقویم را صریح نمی‌گوید و به پیش‌فرض ICU تکیه می‌کند.
 *
 * پس منطقه زمانی و تقویم هر دو صریح‌اند و ارقام هم فارسی می‌شوند تا با
 * بقیه رابط کاربری یکدست باشد.
 */

/** منطقه زمانی کتابخانه. اگر روزی چندشعبه‌ای شد، از تنظیمات خوانده می‌شود. */
export const LIBRARY_TIMEZONE = 'Asia/Tehran';

const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: LIBRARY_TIMEZONE,
});

const jalaliDateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', timeZone: LIBRARY_TIMEZONE, hour12: false,
});

/** `۱۴۰۵/۰۶/۰۹` */
export function formatJalaliDate(value: Date | null | undefined, fallback = '—'): string {
  if (!value || Number.isNaN(value.getTime())) return fallback;
  return jalaliDate.format(value);
}

/** `۱۴۰۵/۰۶/۰۹, ۱۴:۳۰` — جداکننده «،» پیش‌فرض ICU است و با سمت وب یکدست. */
export function formatJalaliDateTime(value: Date | null | undefined, fallback = '—'): string {
  if (!value || Number.isNaN(value.getTime())) return fallback;
  return jalaliDateTime.format(value);
}
