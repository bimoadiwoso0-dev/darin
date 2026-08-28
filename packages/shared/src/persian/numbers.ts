import { foldPersianLetters, normalizeDigits } from './normalize.js';

/**
 * تبدیل عدد گفته‌شده به فارسی، به عدد.
 *
 * ── چرا لازم است ────────────────────────────────────────────────────────
 * کتابدار وقتی سال انتشار را می‌گوید، «هزار و سیصد و نود و نه» می‌گوید نه
 * «۱۳۹۹». موتور تشخیص گفتار هم دقیقاً همان کلمات را برمی‌گرداند. بدون این
 * تبدیل، فیلد سال با یک رشته فارسی پر می‌شد که هیچ‌جای سیستم عدد به
 * حسابش نمی‌آورد.
 *
 * ── چرا دستی و نه کتابخانه ──────────────────────────────────────────────
 * کتابخانه‌های موجود گویش‌های محاوره‌ای («پونصد»، «شونزده»، «شیش») را
 * پوشش نمی‌دهند، در حالی که همان‌ها چیزی است که واقعاً گفته می‌شود.
 */

const UNITS: Record<string, number> = {
  صفر: 0,
  یک: 1, اول: 1,
  دو: 2, دوم: 2,
  سه: 3, سوم: 3,
  چهار: 4, چهارم: 4,
  پنج: 5, پنجم: 5,
  شش: 6, شیش: 6, ششم: 6,
  هفت: 7, هفتم: 7,
  هشت: 8, هشتم: 8,
  نه: 9, نهم: 9,
  ده: 10, دهم: 10,
  یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14,
  پانزده: 15, پونزده: 15,
  شانزده: 16, شونزده: 16,
  هفده: 17, هیفده: 17,
  هجده: 18, هیجده: 18,
  نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50,
  شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90,
  صد: 100, یکصد: 100,
  دویست: 200, سیصد: 300, چهارصد: 400,
  پانصد: 500, پونصد: 500,
  ششصد: 600, شیشصد: 600,
  هفتصد: 700, هفصد: 700,
  هشتصد: 800,
  نهصد: 900, نهصدم: 900,
};

/** مقیاس‌ها ضرب می‌شوند، برخلاف یکان‌ها که جمع می‌شوند. */
const SCALES: Record<string, number> = {
  هزار: 1_000,
  میلیون: 1_000_000,
  ملیون: 1_000_000,
  میلیارد: 1_000_000_000,
};

/** واژه‌هایی که در شمردن بی‌اثرند و باید نادیده گرفته شوند. */
const FILLER = new Set(['و', 'ه', 'تا', 'عدد', 'شماره']);

function tokenize(input: string): string[] {
  return foldPersianLetters(normalizeDigits(input))
    // نیم‌فاصله در «پنج‌هزار» باید مثل فاصله عمل کند
    .replace(/‌/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * عدد فارسیِ گفته‌شده را به عدد تبدیل می‌کند. اگر متن اصلاً عدد نباشد،
 * `null` برمی‌گرداند — تا فراخوان بتواند تفاوت «صفر» و «عدد نیست» را
 * تشخیص دهد.
 *
 * `'هزار و سیصد و نود و نه'` → `1399`
 * `'دو هزار و بیست و شش'`    → `2026`
 * `'۱۳۹۹'`                   → `1399`
 * `'سیصد و بیست'`            → `320`
 */
export function persianWordsToNumber(input: string | null | undefined): number | null {
  if (!input) return null;

  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawNumber = false;

  for (const token of tokens) {
    if (FILLER.has(token)) continue;

    // رقم نوشته‌شده وسط جمله گفته‌شده — «سال 1399»
    if (/^\d+$/.test(token)) {
      current += Number(token);
      sawNumber = true;
      continue;
    }

    const unit = UNITS[token];
    if (unit !== undefined) {
      current += unit;
      sawNumber = true;
      continue;
    }

    const scale = SCALES[token];
    if (scale !== undefined) {
      /*
       * «هزار» بدون عدد قبلش یعنی «یک هزار». اگر `current` صفر باشد و
       * ضرب کنیم، نتیجه صفر می‌شد.
       */
      current = (current === 0 ? 1 : current) * scale;
      total += current;
      current = 0;
      sawNumber = true;
      continue;
    }

    // واژه‌ای که عدد نیست → کل عبارت عدد نبوده است
    return null;
  }

  if (!sawNumber) return null;
  return total + current;
}

/**
 * رشته‌ای از ارقامِ تک‌تک گفته‌شده را به رقم تبدیل می‌کند.
 *
 * شابک و بارکد را کسی به‌صورت عدد کامل نمی‌خواند؛ رقم به رقم می‌گوید:
 * «نه هفت هشت شش صفر صفر …». `persianWordsToNumber` این را جمع می‌زند و
 * عدد بی‌معنایی می‌سازد، پس مسیر جداگانه‌ای لازم است.
 *
 * `'نه هفت هشت شش صفر شش'` → `'978606'`
 * `'۹۷۸-۶۰۰-۱۲۳'`          → `'978600123'`
 */
export function persianWordsToDigits(input: string | null | undefined): string {
  if (!input) return '';

  let out = '';
  for (const token of tokenize(input)) {
    if (FILLER.has(token)) continue;

    if (/^\d+$/.test(token)) {
      out += token;
      continue;
    }

    const unit = UNITS[token];
    // فقط ارقام تک‌رقمی؛ «بیست» داخل یک شابک معنا ندارد
    if (unit !== undefined && unit <= 9) {
      out += String(unit);
      continue;
    }

    // «ده» تا «نوزده» گاهی به‌صورت دو رقم گفته می‌شوند
    if (unit !== undefined && unit <= 19) {
      out += String(unit);
      continue;
    }
  }
  return out;
}
