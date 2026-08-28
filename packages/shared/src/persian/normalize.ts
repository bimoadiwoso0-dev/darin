/**
 * نرمال‌سازی متن فارسی برای جستجو.
 *
 * این پیاده‌سازی باید **دقیقاً** با تابع `persian_normalize()` در PostgreSQL
 * (فایل migration `20250101000001_persian_search`) یکسان باشد. اگر یکی را
 * تغییر دادید، دیگری و تست‌های `normalize.test.ts` را هم به‌روز کنید — در غیر
 * این صورت ورودی کاربر با محتوای ایندکس‌شده تطابق نخواهد داشت.
 */

/** اعراب، تنوین، کشیده و نویسه‌های کنترلی جهت — کاملاً حذف می‌شوند. */
const STRIP_RE = /[ً-ٰٟـ​-‏ء]/g;

/** نگاشت یک‌به‌یک نویسه‌های هم‌ارز. ترتیب و طول با `translate()` در SQL یکی است. */
const FOLD_MAP: Record<string, string> = {
  // انواع «ی»
  'ي': 'ی', // ي عربی
  'ې': 'ی', // ې
  'ۍ': 'ی', // ۍ
  'ى': 'ی', // ى الف مقصوره
  'ئ': 'ی', // ئ
  // انواع «ک»
  'ك': 'ک', // ك عربی
  'ڪ': 'ک', // ڪ
  // انواع «ه»
  'ة': 'ه', // ة
  'ۀ': 'ه', // ۀ
  // انواع «ا»
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ
  // «ؤ»
  'ؤ': 'و',
};

// ارقام عربی-هندی (٠-٩) و فارسی (۰-۹) → ASCII
for (let i = 0; i < 10; i++) {
  FOLD_MAP[String.fromCharCode(0x0660 + i)] = String(i);
  FOLD_MAP[String.fromCharCode(0x06f0 + i)] = String(i);
}

const FOLD_RE = new RegExp(`[${Object.keys(FOLD_MAP).join('')}]`, 'g');

/**
 * هر چیزی جز رقم، حرف لاتین و **حروف** فارسی/عربی → فاصله.
 *
 * توجه: نمی‌توان کل بازه U+0600–U+06FF را مجاز دانست، چون علائم نگارشی عربی
 * (`،` U+060C، `؛` U+061B، `؟` U+061F، `٪` U+066A) هم داخل همین بازه‌اند و
 * باید حذف شوند. بنابراین فقط بازه‌های حرفی به‌صورت صریح مجاز شمرده می‌شوند.
 */
const PUNCT_RE =
  /[^0-9A-Za-zء-غف-يٮ-ۓەۥۦۮۯۺ-ۿ]/g;

/**
 * متن را برای ذخیره در ستون‌های ایندکس‌شده یا برای ساخت کوئری جستجو نرمال می‌کند.
 *
 * `«کتابِ  حافـظ»` → `کتاب حافظ`
 * `کتاب‌های ايران` → `کتابهای ایران`  (نیم‌فاصله حذف می‌شود، نه تبدیل به فاصله)
 */
export function persianNormalize(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(STRIP_RE, '')
    .replace(FOLD_RE, (c) => FOLD_MAP[c] ?? c)
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * فقط نویسه‌های هم‌ارز را یکدست می‌کند: «ي»←«ی»، «ك»←«ک»، ارقام عربی‌هندی
 * ← ASCII.
 *
 * سه تفاوت مهم با `persianNormalize`:
 *
 * ۱. **علائم نگارشی را نگه می‌دارد** — جایی لازم است که ویرگول خودش معنا
 *    دارد، مثل تفکیک فیلدهای یک جمله دیکته‌شده.
 * ۲. **نیم‌فاصله را نگه می‌دارد** — خروجی این تابع ممکن است مستقیم در
 *    پایگاه داده ذخیره شود؛ «مگس‌ها» نباید به «مگسها» تبدیل شود.
 * ۳. **طول رشته را تغییر نمی‌دهد** — هر نویسه با یک نویسه جایگزین می‌شود،
 *    پس اندیس‌های متن اصلی و خروجی یکی می‌مانند و می‌توان روی خروجی
 *    الگو یافت و از همان اندیس در متن برش زد.
 */
export function foldPersianLetters(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(FOLD_RE, (c) => FOLD_MAP[c] ?? c);
}

/** فقط ارقام را به ASCII تبدیل می‌کند — برای فیلدهای ISBN، بارکد و شماره تلفن. */
export function normalizeDigits(input: string | null | undefined): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else out += ch;
  }
  return out;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** ارقام ASCII را برای نمایش به فارسی تبدیل می‌کند. هرگز روی داده ذخیره‌شده اعمال نشود. */
export function toPersianDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!);
}

/**
 * متن جستجوی کاربر را به `tsquery` امن با پشتیبانی از پیشوند تبدیل می‌کند.
 * `حافظ شیراز` → `حافظ:* & شیراز:*`
 *
 * ورودی کاربر هرگز مستقیم داخل `to_tsquery` قرار نمی‌گیرد (خطر خطای نحوی و تزریق).
 */
export function buildPrefixTsQuery(input: string): string {
  const tokens = persianNormalize(input)
    .split(' ')
    .filter((t) => t.length > 0)
    .slice(0, 12); // سقف برای جلوگیری از کوئری بیش از حد سنگین
  if (tokens.length === 0) return '';
  return tokens.map((t) => `${t.replace(/[^0-9a-z؀-ۿ]/g, '')}:*`).join(' & ');
}
