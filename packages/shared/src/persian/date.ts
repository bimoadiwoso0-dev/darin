/**
 * تبدیل و قالب‌بندی تاریخ شمسی.
 *
 * قانون معماری (ADR-09): در دیتابیس همه‌چیز UTC است. این ماژول **فقط** برای
 * نمایش و برای تبدیل ورودی شمسی کاربر به `Date` استفاده می‌شود.
 */

/** تبدیل میلادی به شمسی — الگوریتم بدون وابستگی به کتابخانه بیرونی. */
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    gDaysInMonth.slice(0, gm - 1).reduce((a, b) => a + b, 0);

  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  /*
   * `days` اکنون شماره روز در سال شمسی است (از صفر).
   *
   * تقسیم مستقیم به‌جای پیمایش ماه‌ها انجام می‌شود چون در سال کبیسه، روز
   * ۳۶۶ام (۳۰ اسفند) از فهرست طول ماه‌ها بیرون می‌افتد و پیمایش، ماه و روز
   * صفر برمی‌گرداند. شش ماه اول ۳۱ روزه‌اند (۱۸۶ روز) و بقیه ۳۰ روزه.
   */
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = days < 186 ? 1 + (days % 31) : 1 + ((days - 186) % 30);

  return [jy, jm, jd];
}

/**
 * تبدیل شمسی به میلادی.
 *
 * مبنای محاسبه، شمارش روز از یک مبدأ ثابت است. عدد `1595` سال شمسی را به
 * پنجره‌ای می‌برد که فرمول کبیسه ۳۳ساله در آن معتبر است، و `-355668` همان
 * تعداد روز را به مبدأ تقویم میلادی برمی‌گرداند. این دو عدد با هم معنا
 * دارند؛ حذف یکی، سال خروجی را جابه‌جا می‌کند.
 */
export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const jDaysInMonth = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  const shiftedYear = jy + 1595;
  let days =
    -355668 +
    365 * shiftedYear +
    Math.floor(shiftedYear / 33) * 8 +
    Math.floor(((shiftedYear % 33) + 3) / 4) +
    jd +
    jDaysInMonth.slice(0, jm - 1).reduce((a, b) => a + b, 0);

  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let gd = days + 1;
  const isLeap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const gDaysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (let i = 0; i < 12; i++) {
    const dim = gDaysInMonth[i]!;
    if (gd <= dim) {
      gm = i + 1;
      break;
    }
    gd -= dim;
  }
  return [gy, gm, gd];
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

export const JALALI_WEEKDAYS = [
  'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه',
] as const;

/** سال شمسی جاری — برای موتور شماره‌گذاری. */
export function currentJalaliYear(now: Date = new Date()): number {
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate())[0];
}

export function currentJalaliMonth(now: Date = new Date()): number {
  return gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate())[1];
}

/** فاصله روزهای کامل بین دو تاریخ (بر مبنای UTC، مستقل از ساعت). */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / MS_PER_DAY);
}

/** افزودن روز به تاریخ بدون تغییر شیء ورودی. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** پایان روز (23:59:59.999) — موعد بازگشت همیشه به انتهای روز گرد می‌شود. */
export function endOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
