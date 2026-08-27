import { toPersianDigits } from '@darin/shared';

/**
 * قالب‌بندی برای نمایش.
 *
 * ── قانون ۶۸: تاریخ ذخیره در برابر تاریخ نمایش ──────────────────────────
 * تمام تاریخ‌ها در دیتابیس UTC هستند. تبدیل به شمسی **فقط اینجا** انجام
 * می‌شود. هیچ رشته تاریخ شمسی هرگز به سرور ارسال نمی‌شود.
 */

const TIMEZONE = 'Asia/Tehran';

const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIMEZONE,
});

const jalaliDateLong = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: TIMEZONE,
});

const jalaliDateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE, hour12: false,
});

const timeOnly = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE, hour12: false,
});

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `۱۴۰۵/۰۳/۱۲` */
export function formatDate(value: string | Date | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? jalaliDate.format(date) : fallback;
}

/** `۱۲ خرداد ۱۴۰۵` */
export function formatDateLong(value: string | Date | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? jalaliDateLong.format(date) : fallback;
}

/** `۱۴۰۵/۰۳/۱۲ ۱۴:۳۰` */
export function formatDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? jalaliDateTime.format(date) : fallback;
}

export function formatTime(value: string | Date | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? timeOnly.format(date) : fallback;
}

/**
 * فاصله زمانی خوانا: «۳ روز پیش»، «فردا»، «۲ ساعت دیگر».
 *
 * برای موعد بازگشت حیاتی است: کتابدار باید در یک نگاه بفهمد کتاب دیرکرد
 * دارد یا نه، بدون اینکه تاریخ‌ها را در ذهن مقایسه کند.
 */
export function formatRelative(value: string | Date | null | undefined): string {
  const date = parse(value);
  if (!date) return '—';

  const MS_DAY = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTarget = new Date(date);
  startOfTarget.setHours(0, 0, 0, 0);

  const days = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / MS_DAY);

  if (days === 0) return 'امروز';
  if (days === 1) return 'فردا';
  if (days === -1) return 'دیروز';
  if (days === 2) return 'پس‌فردا';
  if (days === -2) return 'پریروز';

  if (days > 0) {
    if (days < 7) return `${toPersianDigits(days)} روز دیگر`;
    if (days < 30) return `${toPersianDigits(Math.round(days / 7))} هفته دیگر`;
    if (days < 365) return `${toPersianDigits(Math.round(days / 30))} ماه دیگر`;
    return `${toPersianDigits(Math.round(days / 365))} سال دیگر`;
  }

  const past = Math.abs(days);
  if (past < 7) return `${toPersianDigits(past)} روز پیش`;
  if (past < 30) return `${toPersianDigits(Math.round(past / 7))} هفته پیش`;
  if (past < 365) return `${toPersianDigits(Math.round(past / 30))} ماه پیش`;
  return `${toPersianDigits(Math.round(past / 365))} سال پیش`;
}

/** `۱۲۵٬۰۰۰ تومان` */
export function formatMoney(
  value: number | string | null | undefined,
  options: { currency?: string; showUnit?: boolean } = {},
): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';

  const formatted = new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: 0,
  }).format(amount);

  if (options.showUnit === false) return formatted;
  const unit = options.currency === 'IRR' ? 'ریال' : 'تومان';
  return `${formatted} ${unit}`;
}

/** `۱٬۲۳۴` — عدد با جداکننده هزارگان فارسی. */
export function formatNumber(value: number | null | undefined, fallback = '۰'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat('fa-IR').format(value);
}

/** `۲٫۵ مگابایت` */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${formatNumber(bytes)} بایت`;
  if (bytes < 1_048_576) return `${formatNumber(Math.round(bytes / 1024))} کیلوبایت`;
  if (bytes < 1_073_741_824) {
    return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} مگابایت`;
  }
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(bytes / 1_073_741_824)} گیگابایت`;
}

/** درصد با علامت فارسی. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${formatNumber(Math.round(value))}٪`;
}

/**
 * نمایش شناسه‌های لاتین (بارکد، شابک، کد قفسه).
 * این مقادیر **نباید** به ارقام فارسی تبدیل شوند — کتابدار آنها را با
 * برچسب روی کتاب مقایسه می‌کند و باید عیناً یکسان باشند.
 */
export function formatIdentifier(value: string | null | undefined): string {
  return value?.trim() || '—';
}

/** فهرست نام‌ها با جداکننده فارسی: «حافظ، سعدی و مولانا» */
export function formatNameList(names: readonly string[], max = 3): string {
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0]!;

  const shown = names.slice(0, max);
  const rest = names.length - shown.length;

  const joined =
    shown.length === 2
      ? `${shown[0]} و ${shown[1]}`
      : `${shown.slice(0, -1).join('، ')} و ${shown.at(-1)}`;

  return rest > 0 ? `${joined} و ${toPersianDigits(rest)} نفر دیگر` : joined;
}

/** تبدیل تاریخ به مقداری که `<input type="date">` می‌پذیرد (میلادی ISO). */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const date = parse(value);
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export { toPersianDigits };
