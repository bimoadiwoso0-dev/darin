import { describe, expect, it } from 'vitest';
import {
  JALALI_WEEKDAYS,
  gregorianToJalali,
  jalaliToGregorian,
} from './date';

/**
 * تبدیل تقویم — قلب قانون ۶۸.
 *
 * این تست‌ها پس از کشف دو اشکال واقعی نوشته شدند:
 *   ۱. `jalaliToGregorian` سالِ شمسی را به‌جای میلادی برمی‌گرداند (ضریب
 *      مبدأ حذف شده بود).
 *   ۲. `gregorianToJalali` برای ۳۰ اسفند سال کبیسه، ماه و روز صفر می‌داد،
 *      چون پیمایش ماه‌ها روز ۳۶۶ام را پوشش نمی‌داد.
 *
 * هر دو از نوع اشکالی‌اند که با یک تاریخ نمونه دیده نمی‌شوند و فقط با
 * پیمایش کامل چند سال آشکار می‌شوند.
 */
describe('تبدیل تقویم شمسی و میلادی', () => {
  it('تاریخ‌های مرجع را درست تبدیل می‌کند', () => {
    // آغاز سال‌های شمسی — نوروز
    expect(gregorianToJalali(2025, 3, 21)).toEqual([1404, 1, 1]);
    expect(gregorianToJalali(2024, 3, 20)).toEqual([1403, 1, 1]);
    expect(gregorianToJalali(2026, 3, 21)).toEqual([1405, 1, 1]);
    // یک تاریخ دلخواه میانه سال
    expect(gregorianToJalali(2000, 1, 1)).toEqual([1378, 10, 11]);
  });

  it('جهت معکوس همان تاریخ را برمی‌گرداند', () => {
    expect(jalaliToGregorian(1404, 1, 1)).toEqual([2025, 3, 21]);
    expect(jalaliToGregorian(1403, 1, 1)).toEqual([2024, 3, 20]);
    expect(jalaliToGregorian(1378, 10, 11)).toEqual([2000, 1, 1]);
  });

  it('سال میلادی را برمی‌گرداند، نه سال شمسی', () => {
    // اشکال اصلی: خروجی [1404, 3, 21] بود به‌جای [2025, 3, 21]
    const [year] = jalaliToGregorian(1404, 1, 1);
    expect(year).toBeGreaterThan(1900);
  });

  it('۳۰ اسفند سال کبیسه را درست تبدیل می‌کند', () => {
    // ۱۴۰۳ کبیسه است؛ روز ۳۶۶ام سال
    expect(jalaliToGregorian(1403, 12, 30)).toEqual([2025, 3, 20]);
    expect(gregorianToJalali(2025, 3, 20)).toEqual([1403, 12, 30]);

    // ۱۳۹۹ هم کبیسه است
    expect(gregorianToJalali(2021, 3, 20)).toEqual([1399, 12, 30]);
  });

  it('در سال غیرکبیسه، ۲۹ اسفند آخرین روز سال است', () => {
    // ۱۴۰۴ کبیسه نیست
    expect(jalaliToGregorian(1404, 12, 29)).toEqual([2026, 3, 20]);
    expect(gregorianToJalali(2026, 3, 20)).toEqual([1404, 12, 29]);
  });

  it('رفت‌وبرگشت روی ۲۱ سال کامل بدون خطاست', () => {
    const monthLength = (year: number, month: number): number => {
      if (month <= 6) return 31;
      if (month <= 11) return 30;
      const [gy, gm, gd] = jalaliToGregorian(year, 12, 30);
      const [backYear, backMonth, backDay] = gregorianToJalali(gy, gm, gd);
      return backYear === year && backMonth === 12 && backDay === 30 ? 30 : 29;
    };

    const mismatches: string[] = [];
    for (let year = 1395; year <= 1415; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= monthLength(year, month); day++) {
          const [gy, gm, gd] = jalaliToGregorian(year, month, day);
          const back = gregorianToJalali(gy, gm, gd);
          if (back[0] !== year || back[1] !== month || back[2] !== day) {
            mismatches.push(`${year}/${month}/${day} → ${back.join('/')}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('روزهای متوالی میلادی به روزهای متوالی شمسی می‌رسند', () => {
    // ۴۰۰ روز پیاپی — هر روز باید دقیقاً یک روز جلوتر از قبلی باشد
    const start = new Date(2024, 2, 1);
    let previous: [number, number, number] | null = null;

    for (let i = 0; i < 400; i++) {
      const date = new Date(start.getTime() + i * 86_400_000);
      const current = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());

      expect(current[1]).toBeGreaterThanOrEqual(1);
      expect(current[1]).toBeLessThanOrEqual(12);
      expect(current[2]).toBeGreaterThanOrEqual(1);
      expect(current[2]).toBeLessThanOrEqual(31);

      if (previous) {
        const sameMonth = previous[0] === current[0] && previous[1] === current[1];
        if (sameMonth) expect(current[2]).toBe(previous[2] + 1);
        else expect(current[2]).toBe(1);
      }
      previous = current;
    }
  });

  it('نام روزهای هفته با ترتیب یکشنبه‌محور جاوااسکریپت هم‌راستاست', () => {
    // `Date.getDay()` صفر را یکشنبه می‌داند و آرایه هم از یکشنبه شروع می‌شود
    expect(JALALI_WEEKDAYS[0]).toBe('یکشنبه');
    expect(JALALI_WEEKDAYS[6]).toBe('شنبه');

    const [gy, gm, gd] = jalaliToGregorian(1404, 1, 1);
    const weekday = new Date(gy, gm - 1, gd).getDay();
    expect(JALALI_WEEKDAYS[weekday]).toBe('جمعه'); // نوروز ۱۴۰۴ جمعه بود
  });
});
