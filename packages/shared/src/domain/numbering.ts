/**
 * موتور الگوی شماره‌گذاری.
 *
 * الگو با متغیرهای داخل آکولاد نوشته می‌شود:
 *   `BK-{SEQ:6}`         -> BK-000001
 *   `{YEAR}-{SEQ:5}`     -> 1405-00001   (سال شمسی)
 *   `{GYEAR}-{SEQ:5}`    -> 2026-00001   (سال میلادی)
 *   `A-{PREFIX}-{SEQ:3}` -> A-001-025
 *   `200{SEQ:9}{EAN}`    -> بارکد EAN-13 با رقم کنترل خودکار
 */

export const NUMBERING_TARGETS = {
  ACCESSION: 'شماره ثبت',
  BARCODE: 'بارکد',
  LIBRARY_CODE: 'کد کتابخانه',
  ASSET: 'شماره اموال',
  MEMBER_CODE: 'کد عضویت',
  LOAN_NUMBER: 'شماره امانت',
} as const;
export type NumberingTarget = keyof typeof NUMBERING_TARGETS;

export const NUMBERING_RESET = {
  NEVER: 'هرگز',
  YEARLY: 'سالانه',
  MONTHLY: 'ماهانه',
} as const;
export type NumberingReset = keyof typeof NUMBERING_RESET;

export interface RenderNumberOptions {
  pattern: string;
  sequence: number;
  prefix?: string | null;
  /** سال شمسی جاری — از لایه فراخوان پاس داده می‌شود تا تابع خالص بماند. */
  solarYear?: number;
  gregorianYear?: number;
  solarMonth?: number;
}

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;
const EAN_PLACEHOLDER = 'EAN';

/** رقم کنترل EAN-13 برای رشته ۱۲ رقمی. */
function eanCheck(twelve: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * الگو را با مقادیر داده‌شده رندر می‌کند.
 * توکن EAN باید آخرین توکن باشد و بر اساس ارقام قبل از خود محاسبه می‌شود.
 */
export function renderNumberPattern(opts: RenderNumberOptions): string {
  const { pattern, sequence, prefix, solarYear, gregorianYear, solarMonth } = opts;

  let hasEan = false;
  const rendered = pattern.replace(TOKEN_RE, (_m, token: string, width?: string) => {
    const pad = width ? Number(width) : 0;
    switch (token) {
      case 'SEQ':
        return String(sequence).padStart(pad, '0');
      case 'YEAR':
        return String(solarYear ?? new Date().getFullYear());
      case 'YY':
        return String(solarYear ?? 0).slice(-2);
      case 'GYEAR':
        return String(gregorianYear ?? new Date().getUTCFullYear());
      case 'MONTH':
        return String(solarMonth ?? 1).padStart(2, '0');
      case 'PREFIX':
        return prefix ?? '';
      case 'EAN':
        hasEan = true;
        return EAN_PLACEHOLDER;
      default:
        return '';
    }
  });

  if (!hasEan) return rendered;

  const body = rendered.replace(EAN_PLACEHOLDER, '');
  const digits = body.replace(/\D/g, '').padStart(12, '0').slice(-12);
  return digits + eanCheck(digits);
}

/** اعتبارسنجی الگو پیش از ذخیره در تنظیمات. */
export function validateNumberPattern(pattern: string): { valid: boolean; error?: string } {
  if (!pattern.trim()) return { valid: false, error: 'الگو نمی‌تواند خالی باشد.' };
  if (pattern.length > 60) return { valid: false, error: 'الگو نباید بیش از ۶۰ نویسه باشد.' };

  const tokens = [...pattern.matchAll(TOKEN_RE)].map((m) => m[1]!);
  const known = ['SEQ', 'YEAR', 'YY', 'GYEAR', 'MONTH', 'PREFIX', 'EAN'];
  const unknown = tokens.find((t) => !known.includes(t));
  if (unknown) return { valid: false, error: `متغیر ناشناخته «${unknown}» در الگو تعریف نشده است.` };
  if (!tokens.includes('SEQ')) {
    return { valid: false, error: 'الگو باید حتماً شامل متغیر SEQ باشد تا شماره‌ها یکتا بمانند.' };
  }
  if (tokens.includes('EAN') && !pattern.trimEnd().endsWith('{EAN}')) {
    return { valid: false, error: 'متغیر EAN باید در انتهای الگو قرار بگیرد.' };
  }
  return { valid: true };
}


/**
 * ساخت الگوی Regex (سازگار با PostgreSQL) که بخش «توالی» را از یک شماره
 * قالب‌بندی‌شده استخراج می‌کند.
 *
 *   `{YEAR}{SEQ:6}`    → `^[0-9]{4}([0-9]{6})$`     تا از «1405000329» عدد 329 در بیاید
 *   `200{SEQ:9}{EAN}`  → `^200([0-9]{9})[0-9]$`     رقم کنترل EAN جزء توالی نیست
 *   `BK-{SEQ:6}`       → `^BK\-([0-9]{6})$`
 *
 * چرا لازم است: بدون آگاهی از الگو، «حذف همه غیررقم‌ها» پیشوند سال یا رقم
 * کنترل بارکد را هم وارد عدد توالی می‌کند و شمارنده به مقداری نجومی می‌پرد.
 *
 * اگر الگو قابل تبدیل نباشد `null` برمی‌گردد تا فراخوان به روش محافظه‌کارانه
 * برگردد.
 */
export function numberPatternToSequenceRegex(pattern: string): string | null {
  let out = '^';
  let lastIndex = 0;
  let sawSeq = false;

  const escape = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');

  for (const match of pattern.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    out += escape(pattern.slice(lastIndex, index));
    lastIndex = index + match[0].length;

    const token = match[1];
    const width = match[2] ? Number(match[2]) : 0;

    switch (token) {
      case 'SEQ':
        if (sawSeq) return null; // بیش از یک توالی — قابل استخراج نیست
        sawSeq = true;
        out += width > 0 ? `([0-9]{${width}})` : '([0-9]+)';
        break;
      case 'YEAR':
      case 'GYEAR':
        out += '[0-9]{4}';
        break;
      case 'YY':
      case 'MONTH':
        out += '[0-9]{2}';
        break;
      case 'EAN':
        out += '[0-9]';
        break;
      case 'PREFIX':
        // پیشوند دلخواه است و طولش ثابت نیست
        out += '.*?';
        break;
      default:
        return null;
    }
  }

  out += escape(pattern.slice(lastIndex)) + '$';
  return sawSeq ? out : null;
}

export const DEFAULT_NUMBERING_RULES: Array<{
  key: string;
  name: string;
  target: NumberingTarget;
  pattern: string;
  resetPolicy: NumberingReset;
}> = [
  { key: 'accession', name: 'شماره ثبت کتاب', target: 'ACCESSION', pattern: '{SEQ:6}', resetPolicy: 'NEVER' },
  { key: 'barcode', name: 'بارکد نسخه', target: 'BARCODE', pattern: '200{SEQ:9}{EAN}', resetPolicy: 'NEVER' },
  { key: 'library_code', name: 'کد کتابخانه', target: 'LIBRARY_CODE', pattern: 'BK-{SEQ:6}', resetPolicy: 'NEVER' },
  { key: 'asset', name: 'شماره اموال', target: 'ASSET', pattern: '{YEAR}-{SEQ:5}', resetPolicy: 'YEARLY' },
  { key: 'member_code', name: 'کد عضویت', target: 'MEMBER_CODE', pattern: 'M-{SEQ:5}', resetPolicy: 'NEVER' },
  { key: 'loan_number', name: 'شماره امانت', target: 'LOAN_NUMBER', pattern: '{YEAR}{SEQ:6}', resetPolicy: 'YEARLY' },
];
