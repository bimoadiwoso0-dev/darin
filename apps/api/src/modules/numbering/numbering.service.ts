import { Injectable, Logger } from '@nestjs/common';
import {
  currentJalaliMonth,
  currentJalaliYear,
  renderNumberPattern,
  type NumberingTarget,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { ERROR_CODES } from '@darin/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { periodKeyFor, syncNumberingSequences, type SequenceSyncResult } from './sequence-sync';

/** تراکنش Prisma — تولید شماره باید داخل تراکنش فراخوان انجام شود. */
type Tx = Prisma.TransactionClient;

/**
 * تولید شماره یکتا (شماره ثبت، بارکد، کد عضویت، شماره امانت).
 *
 * ── چرا این کلاس وجود دارد ───────────────────────────────────────────────
 * ساده‌ترین راه (`SELECT max(accession) + 1`) در برابر همروندی می‌شکند: اگر
 * دو کتابدار هم‌زمان کتاب ثبت کنند، هر دو همان عدد را می‌خوانند و یکی از
 * درج‌ها با خطای یکتایی شکست می‌خورد.
 *
 * راه‌حل: شمارنده در جدول `numbering_rules` نگهداری می‌شود و افزایش آن با
 * `SELECT ... FOR UPDATE` انجام می‌گیرد. تراکنش دوم پشت قفل منتظر می‌ماند و
 * پس از آزاد شدن، مقدار به‌روز را می‌خواند. نتیجه: شماره تکراری **غیرممکن**
 * است، نه «بعید» (ADR-06).
 *
 * هزینه: تراکنش‌های هم‌زمان روی یک نوع شماره سریالی می‌شوند. برای کتابخانه‌ای
 * با چند کتابدار، این قفل چند میلی‌ثانیه است و کاملاً قابل قبول.
 */
@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * شماره بعدی را داخل تراکنش داده‌شده تولید می‌کند.
   *
   * **باید** با تراکنشی صدا زده شود که خودِ درج رکورد را هم انجام می‌دهد —
   * در غیر این صورت اگر درج شکست بخورد، یک شماره سوخته باقی می‌ماند.
   */
  async next(tx: Tx, ruleKey: string): Promise<string> {
    // قفل ردیف قانون تا پایان تراکنش فراخوان
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        pattern: string;
        prefix: string | null;
        currentSequence: number;
        resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY';
        currentPeriod: string | null;
        isActive: boolean;
      }>
    >`
      SELECT id, pattern, prefix, "currentSequence", "resetPolicy", "currentPeriod", "isActive"
      FROM numbering_rules WHERE key = ${ruleKey} FOR UPDATE
    `;

    const rule = rows[0];
    if (!rule) {
      throw new DomainError(
        ERROR_CODES.INTERNAL,
        `قانون شماره‌گذاری «${ruleKey}» تعریف نشده است. تنظیمات سیستم را بررسی کنید.`,
      );
    }
    if (!rule.isActive) {
      throw new DomainError(
        ERROR_CODES.CONFLICT,
        `قانون شماره‌گذاری «${ruleKey}» غیرفعال است؛ شماره باید دستی وارد شود.`,
      );
    }

    const year = currentJalaliYear();
    const month = currentJalaliMonth();
    const period = periodKey(rule.resetPolicy, year, month);

    // شروع دوره جدید (سال یا ماه نو) → شمارنده از صفر (فقط برای قانون‌های بازنشانی‌دار)
    const sequence = baseSequence(rule, period) + 1;

    await tx.numberingRule.update({
      where: { id: rule.id },
      data: { currentSequence: sequence, currentPeriod: period },
    });

    return renderNumberPattern({
      pattern: rule.pattern,
      sequence,
      prefix: rule.prefix,
      solarYear: year,
      solarMonth: month,
      gregorianYear: new Date().getUTCFullYear(),
    });
  }

  /**
   * چند شماره پشت سر هم — برای ثبت گروهی نسخه‌ها.
   * یک بار قفل می‌گیرد به‌جای N بار؛ برای افزودن ۵۰ نسخه از یک عنوان مهم است.
   */
  async nextBatch(tx: Tx, ruleKey: string, count: number): Promise<string[]> {
    if (count <= 0) return [];
    if (count > 5000) {
      throw DomainError.validation({ count: ['حداکثر ۵۰۰۰ شماره در یک درخواست قابل تولید است.'] });
    }

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        pattern: string;
        prefix: string | null;
        currentSequence: number;
        resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY';
        currentPeriod: string | null;
      }>
    >`
      SELECT id, pattern, prefix, "currentSequence", "resetPolicy", "currentPeriod"
      FROM numbering_rules WHERE key = ${ruleKey} AND "isActive" FOR UPDATE
    `;
    const rule = rows[0];
    if (!rule) {
      throw new DomainError(ERROR_CODES.INTERNAL, `قانون شماره‌گذاری «${ruleKey}» یافت نشد.`);
    }

    const year = currentJalaliYear();
    const month = currentJalaliMonth();
    const period = periodKey(rule.resetPolicy, year, month);
    const base = baseSequence(rule, period);

    const numbers: string[] = [];
    for (let i = 1; i <= count; i++) {
      numbers.push(
        renderNumberPattern({
          pattern: rule.pattern,
          sequence: base + i,
          prefix: rule.prefix,
          solarYear: year,
          solarMonth: month,
          gregorianYear: new Date().getUTCFullYear(),
        }),
      );
    }

    await tx.numberingRule.update({
      where: { id: rule.id },
      data: { currentSequence: base + count, currentPeriod: period },
    });

    return numbers;
  }

  /**
   * بررسی در دسترس بودن یک شماره که کاربر **دستی** وارد کرده (قانون ۸).
   *
   * کتاب‌هایی که از قبل شماره روی جلدشان دارند باید با همان شماره ثبت شوند؛
   * این متد پیش از ثبت به کتابدار می‌گوید آیا شماره آزاد است یا نه.
   */
  async checkAvailability(
    target: NumberingTarget,
    value: string,
    branchId: string,
    excludeCopyId?: string,
  ): Promise<{ available: boolean; conflictWith?: { copyId: string; bookTitle: string } }> {
    const trimmed = value.trim();
    if (!trimmed) return { available: false };

    const where =
      target === 'BARCODE'
        ? { barcode: trimmed }
        : target === 'ACCESSION'
          ? { branchId, accessionNumber: trimmed }
          : target === 'ASSET'
            ? { branchId, assetNumber: trimmed }
            : { branchId, libraryCode: trimmed };

    const existing = await this.prisma.bookCopy.findFirst({
      where: { ...where, deletedAt: null, ...(excludeCopyId ? { id: { not: excludeCopyId } } : {}) },
      select: { id: true, book: { select: { title: true } } },
    });

    if (!existing) return { available: true };
    return {
      available: false,
      conflictWith: { copyId: existing.id, bookTitle: existing.book.title },
    };
  }

  /** بررسی آزاد بودن کد عضویت. */
  async checkMemberCodeAvailability(
    code: string,
    excludeMemberId?: string,
  ): Promise<{ available: boolean }> {
    const existing = await this.prisma.member.findFirst({
      where: {
        memberCode: code.trim(),
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
      },
      select: { id: true },
    });
    return { available: !existing };
  }

  /**
   * پیش‌نمایش شماره بعدی **بدون** مصرف کردن آن.
   * فرم ثبت کتاب از این استفاده می‌کند تا شماره پیشنهادی را نشان دهد.
   */
  async preview(ruleKey: string): Promise<string | null> {
    const rule = await this.prisma.numberingRule.findUnique({ where: { key: ruleKey } });
    if (!rule || !rule.isActive) return null;

    const year = currentJalaliYear();
    const month = currentJalaliMonth();
    const period = periodKey(rule.resetPolicy, year, month);
    const base = baseSequence(rule, period);

    return renderNumberPattern({
      pattern: rule.pattern,
      sequence: base + 1,
      prefix: rule.prefix,
      solarYear: year,
      solarMonth: month,
      gregorianYear: new Date().getUTCFullYear(),
    });
  }

  /**
   * همگام‌سازی شمارنده‌ها با داده موجود.
   * پس از Import انبوه، Seed یا بازیابی پشتیبان باید صدا زده شود — وگرنه
   * اولین شماره خودکارِ بعدی با رکوردهای موجود تداخل می‌کند.
   */
  async syncSequences(onlyKeys?: string[]): Promise<SequenceSyncResult[]> {
    const results = await syncNumberingSequences(this.prisma, {
      onlyKeys,
      solarYear: currentJalaliYear(),
      solarMonth: currentJalaliMonth(),
    });
    for (const r of results.filter((x) => x.changed)) {
      this.logger.log(`شمارنده «${r.key}» از ${r.previous} به ${r.current} همگام شد`);
    }
    return results;
  }
}

/**
 * پایه شمارنده برای تولید بعدی.
 *
 * اشکالی که اینجا رفع شده: پیش‌تر شرط «اگر دوره عوض شده، از صفر شروع کن»
 * برای قانون‌های `NEVER` هم اجرا می‌شد. چون `currentPeriod` این قانون‌ها
 * تازه پس از اولین تولید مقدار می‌گیرد، مقایسه `null !== 'ALL'` درست بود و
 * شمارنده را صفر می‌کرد — یعنی دقیقاً پس از یک Import انبوه یا بازیابی
 * پشتیبان، اولین شماره خودکار تکراری تولید می‌شد.
 *
 * حالا فقط قانون‌هایی که واقعاً سیاست بازنشانی دارند بررسی می‌شوند.
 */
function baseSequence(
  rule: { currentSequence: number; currentPeriod: string | null; resetPolicy: 'NEVER' | 'YEARLY' | 'MONTHLY' },
  period: string,
): number {
  if (rule.resetPolicy === 'NEVER') return rule.currentSequence;
  return rule.currentPeriod !== period ? 0 : rule.currentSequence;
}

/** کلید دوره برای سیاست بازنشانی شمارنده. */
function periodKey(policy: 'NEVER' | 'YEARLY' | 'MONTHLY', year: number, month: number): string {
  return periodKeyFor(policy, year, month);
}
