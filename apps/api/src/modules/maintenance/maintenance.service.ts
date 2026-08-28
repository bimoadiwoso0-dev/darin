import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SETTING_KEYS } from '@darin/shared';
import { formatJalaliDate } from '../../common/utils/jalali-format';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { LoansService } from '../circulation/loans.service';
import { ReservationsService } from '../circulation/reservations.service';
import { SettingsService } from '../settings/settings.service';

/**
 * کارهای نگهداری شبانه.
 *
 * ── چرا وضعیت‌ها ذخیره می‌شوند و نه محاسبه ─────────────────────────────
 * «دیرکرد» می‌توانست هر بار با `dueAt < now()` محاسبه شود، اما آن‌وقت
 * نمی‌شد رویش ایندکس زد و گزارش دیرکرد در ۵۰۰٬۰۰۰ امانت کند می‌شد.
 * به‌جایش یک بار در شبانه‌روز وضعیت به‌روز می‌شود و همه کوئری‌ها از
 * ایندکس `(status, dueAt)` استفاده می‌کنند.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loans: LoansService,
    private readonly reservations: ReservationsService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  /** هر شب ساعت ۱ بامداد — پیش از پشتیبان‌گیری ساعت ۲. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'nightly-maintenance' })
  async nightly(): Promise<Record<string, number>> {
    this.logger.log('شروع کارهای نگهداری شبانه');
    const results = {
      overdueMarked: 0,
      reservationsExpired: 0,
      membershipsExpired: 0,
      tokensPruned: 0,
      dueSoonNotices: 0,
    };

    try {
      results.overdueMarked = await this.loans.markOverdueLoans();
      results.reservationsExpired = await this.reservations.expireStaleHolds();
      results.membershipsExpired = await this.expireMemberships();
      results.tokensPruned = await this.auth.pruneExpiredTokens();
      results.dueSoonNotices = await this.createDueSoonNotifications();

      this.logger.log({ results }, 'کارهای نگهداری شبانه تمام شد');
    } catch (err) {
      // یک کار ناموفق نباید بقیه را متوقف کند؛ خطا ثبت و کار ادامه پیدا می‌کند
      this.logger.error({ err, results }, 'خطا در کارهای نگهداری شبانه');
    }

    return results;
  }

  /** عضویت‌های منقضی‌شده را علامت می‌زند. */
  async expireMemberships(): Promise<number> {
    const result = await this.prisma.member.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() }, deletedAt: null },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  /**
   * اعلان یادآوری موعد بازگشت.
   * فقط یک بار به‌ازای هر امانت ساخته می‌شود — بررسی وجود اعلان قبلی از
   * ارسال پیام تکراری در شب‌های متوالی جلوگیری می‌کند.
   */
  async createDueSoonNotifications(): Promise<number> {
    const days = this.settings.get(SETTING_KEYS.NOTIFY_DUE_SOON_DAYS);
    const until = new Date(Date.now() + days * 86_400_000);

    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', dueAt: { gte: new Date(), lte: until } },
      select: {
        id: true, dueAt: true, memberId: true,
        copy: { select: { book: { select: { title: true } } } },
      },
      take: 2000,
    });
    if (loans.length === 0) return 0;

    const existing = await this.prisma.notification.findMany({
      where: {
        type: 'DUE_SOON',
        memberId: { in: [...new Set(loans.map((l) => l.memberId))] },
      },
      select: { payload: true },
    });
    const notified = new Set(
      existing
        .map((n) => (n.payload as { loanId?: string } | null)?.loanId)
        .filter((x): x is string => Boolean(x)),
    );

    const toCreate = loans.filter((l) => !notified.has(l.id));
    if (toCreate.length === 0) return 0;

    await this.prisma.notification.createMany({
      data: toCreate.map((loan) => ({
        memberId: loan.memberId,
        channel: 'IN_APP' as const,
        type: 'DUE_SOON' as const,
        title: 'یادآوری موعد بازگشت',
        body: `موعد بازگشت «${loan.copy.book.title}» تاریخ ${formatJalaliDate(loan.dueAt)} است.`,
        payload: { loanId: loan.id },
        status: 'PENDING' as const,
      })),
    });

    return toCreate.length;
  }

  /** اجرای دستی — برای مدیر سیستم و آزمون. */
  async runNow(): Promise<Record<string, number>> {
    return this.nightly();
  }
}
