import { numberPatternToSequenceRegex, type NumberingTarget } from '@darin/shared';

/**
 * همگام‌سازی شمارنده‌های شماره‌گذاری با بیشترین مقدار موجود در داده.
 *
 * ── چرا لازم است ─────────────────────────────────────────────────────────
 * شمارنده‌ها در جدول `numbering_rules` نگهداری می‌شوند و فقط وقتی جلو می‌روند
 * که شماره از طریق `NumberingService` تولید شود. اما داده می‌تواند از مسیرهای
 * دیگری وارد سیستم شود:
 *   • Import انبوه از Excel (۱۰٬۰۰۰ کتاب با شماره ثبت موجود)
 *   • Seed داده نمایشی
 *   • بازیابی از نسخه پشتیبان
 *   • ورود دستی شماره توسط کتابدار (قانون ۸)
 *
 * در همه این حالت‌ها شمارنده عقب می‌ماند و اولین شماره خودکارِ بعدی تکراری
 * می‌شود. این تابع پس از هر یک از آن عملیات‌ها صدا زده می‌شود.
 *
 * ── چرا از الگو برای استخراج توالی استفاده می‌کنیم ────────────────────────
 * «حذف همه غیررقم‌ها» کافی نیست: شماره امانت `1405000329` با آن روش به عدد
 * ۱٬۴۰۵٬۰۰۰٬۳۲۹ تبدیل می‌شود، در حالی که توالی واقعی ۳۲۹ است. بارکد EAN-13
 * هم یک رقم کنترل انتهایی دارد که جزء توالی نیست. بنابراین از خودِ الگوی
 * قانون یک Regex ساخته می‌شود که دقیقاً بخش توالی را جدا کند.
 *
 * شمارنده **فقط جلو می‌رود**؛ عقب بردن آن تولید شماره تکراری را تضمین می‌کند.
 */

/** حداقل چیزی که این تابع از کلاینت دیتابیس نیاز دارد. */
interface MinimalPrisma {
  numberingRule: {
    findMany(args?: unknown): Promise<Array<{
      id: string;
      key: string;
      target: NumberingTarget;
      pattern: string;
      currentSequence: number;
      currentPeriod: string | null;
      resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY';
    }>>;
    update(args: {
      where: { id: string };
      data: { currentSequence?: number; currentPeriod?: string | null };
    }): Promise<unknown>;
  };
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** ستون دیتابیسِ متناظر با هر نوع شماره. */
const COLUMN_BY_TARGET: Record<NumberingTarget, { table: string; column: string; softDelete: boolean }> = {
  ACCESSION:    { table: 'book_copies', column: 'accessionNumber', softDelete: true },
  BARCODE:      { table: 'book_copies', column: 'barcode',         softDelete: true },
  ASSET:        { table: 'book_copies', column: 'assetNumber',     softDelete: true },
  LIBRARY_CODE: { table: 'book_copies', column: 'libraryCode',     softDelete: true },
  MEMBER_CODE:  { table: 'members',     column: 'memberCode',      softDelete: true },
  LOAN_NUMBER:  { table: 'loans',       column: 'loanNumber',      softDelete: false },
};

export interface SequenceSyncResult {
  key: string;
  previous: number;
  current: number;
  changed: boolean;
  /** اگر الگو قابل تجزیه نبود، همگام‌سازی انجام نشده و دلیلش اینجاست. */
  skippedReason?: string;
}

/** کلید دوره — باید با `periodKey` در `numbering.service.ts` یکسان بماند. */
export function periodKeyFor(
  policy: 'NEVER' | 'YEARLY' | 'MONTHLY',
  year: number,
  month: number,
): string {
  switch (policy) {
    case 'YEARLY': return String(year);
    case 'MONTHLY': return `${year}-${String(month).padStart(2, '0')}`;
    default: return 'ALL';
  }
}

export async function syncNumberingSequences(
  prisma: MinimalPrisma,
  options: { onlyKeys?: string[]; solarYear: number; solarMonth: number },
): Promise<SequenceSyncResult[]> {
  const rules = await prisma.numberingRule.findMany();
  const results: SequenceSyncResult[] = [];

  for (const rule of rules) {
    if (options.onlyKeys && !options.onlyKeys.includes(rule.key)) continue;

    const mapping = COLUMN_BY_TARGET[rule.target];
    const regex = numberPatternToSequenceRegex(rule.pattern);

    if (!mapping || !regex) {
      results.push({
        key: rule.key,
        previous: rule.currentSequence,
        current: rule.currentSequence,
        changed: false,
        skippedReason: !mapping
          ? 'ستون متناظری برای این نوع شماره تعریف نشده است.'
          : 'الگوی این قانون قابل تجزیه خودکار نیست؛ شمارنده را دستی تنظیم کنید.',
      });
      continue;
    }

    // فقط رکوردهایی شمرده می‌شوند که **دقیقاً** با الگوی فعلی می‌خوانند.
    // شماره‌هایی که با الگوی قدیمی ساخته شده‌اند نادیده گرفته می‌شوند — چون
    // توالی آنها با توالی الگوی جدید قابل مقایسه نیست.
    const softDeleteFilter = mapping.softDelete ? ` AND "deletedAt" IS NULL` : '';

    const rows = await prisma.$queryRawUnsafe<Array<{ max: string | null }>>(
      `SELECT max((substring("${mapping.column}" from $1))::bigint)::text AS max
         FROM "${mapping.table}"
        WHERE "${mapping.column}" ~ $1${softDeleteFilter}`,
      regex,
    );

    const found = Number(rows[0]?.max ?? 0);
    const maxFound = Number.isFinite(found) ? found : 0;
    const next = Math.max(maxFound, rule.currentSequence);

    // دوره جاری هم تنظیم می‌شود. بدون این، اولین تولیدِ بعدی فکر می‌کند وارد
    // دوره جدیدی شده و شمارنده را صفر می‌کند — که دقیقاً همان شماره تکراری
    // است که می‌خواستیم جلویش را بگیریم.
    const period = periodKeyFor(rule.resetPolicy, options.solarYear, options.solarMonth);
    const needsUpdate = next !== rule.currentSequence || rule.currentPeriod !== period;

    if (needsUpdate) {
      await prisma.numberingRule.update({
        where: { id: rule.id },
        data: { currentSequence: next, currentPeriod: period },
      });
    }

    results.push({
      key: rule.key,
      previous: rule.currentSequence,
      current: next,
      changed: next !== rule.currentSequence,
    });
  }

  return results;
}
