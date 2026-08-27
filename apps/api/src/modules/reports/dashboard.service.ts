import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface DashboardRange {
  from: Date;
  to: Date;
  label: string;
}

/**
 * داشبورد (قوانین ۴، ۱۰۷، ۱۰۸، ۱۱۹).
 *
 * ── قانون ۱۰۸: هیچ عدد ساختگی ─────────────────────────────────────────────
 * تمام اعداد این کلاس از دیتابیس محاسبه می‌شوند. هیچ مقدار Hard-code یا
 * تصادفی در خروجی نیست.
 *
 * ── راهبرد کارایی ─────────────────────────────────────────────────────────
 * داشبورد چند ده شمارش دارد. اگر هرکدام یک رفت‌وبرگشت جدا به دیتابیس باشد،
 * صفحه کند می‌شود. بنابراین:
 *   • شمارش‌های هم‌خانواده در یک کوئری `GROUP BY` جمع می‌شوند
 *   • کوئری‌های مستقل با `Promise.all` موازی اجرا می‌شوند
 *   • نتیجه در لایه Controller با TTL کوتاه Cache می‌شود
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** آمار کلیدی — کارت‌های بالای داشبورد. */
  async summary() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      titleCount,
      copyStats,
      memberStats,
      loansToday,
      returnsToday,
      overdueToday,
      newBooksThisMonth,
      newMembersThisMonth,
      activeReservations,
      readyReservations,
      unpaidFines,
    ] = await Promise.all([
      this.prisma.book.count({ where: { deletedAt: null } }),

      // یک کوئری برای تمام وضعیت‌های نسخه — نه ۱۰ کوئری جدا
      this.prisma.bookCopy.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),

      this.prisma.member.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),

      this.prisma.loan.count({ where: { loanedAt: { gte: startOfToday } } }),
      this.prisma.loan.count({ where: { returnedAt: { gte: startOfToday } } }),
      this.prisma.loan.count({
        where: { status: 'OVERDUE', dueAt: { gte: startOfToday, lt: now } },
      }),
      this.prisma.book.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth } } }),
      this.prisma.member.count({ where: { deletedAt: null, joinedAt: { gte: startOfMonth } } }),
      this.prisma.reservation.count({ where: { status: { in: ['PENDING', 'READY'] } } }),
      this.prisma.reservation.count({ where: { status: 'READY' } }),

      this.prisma.$queryRaw<Array<{ total: string | null; count: bigint }>>`
        SELECT sum("amount" - "paidAmount")::text AS total, count(*)::bigint AS count
          FROM fines WHERE "status" IN ('UNPAID', 'PARTIALLY_PAID')
      `,
    ]);

    const byStatus = Object.fromEntries(copyStats.map((s) => [s.status, s._count._all]));
    const byMemberStatus = Object.fromEntries(memberStats.map((s) => [s.status, s._count._all]));
    const totalCopies = copyStats.reduce((sum, s) => sum + s._count._all, 0);
    const totalMembers = memberStats.reduce((sum, s) => sum + s._count._all, 0);

    // دیرکرد کل از جدول امانت می‌آید نه از وضعیت نسخه — چون «دیرکرد» ویژگی
    // امانت است نه ویژگی خود کتاب.
    const overdueTotal = await this.prisma.loan.count({ where: { status: 'OVERDUE' } });

    return {
      collection: {
        titles: titleCount,
        copies: totalCopies,
        available: byStatus['AVAILABLE'] ?? 0,
        onLoan: byStatus['ON_LOAN'] ?? 0,
        reservedHold: byStatus['RESERVED_HOLD'] ?? 0,
        lost: byStatus['LOST'] ?? 0,
        damaged: byStatus['DAMAGED'] ?? 0,
        inRepair: byStatus['IN_REPAIR'] ?? 0,
        notLoanable: byStatus['NOT_LOANABLE'] ?? 0,
        newThisMonth: newBooksThisMonth,
      },
      members: {
        total: totalMembers,
        active: byMemberStatus['ACTIVE'] ?? 0,
        inactive: byMemberStatus['INACTIVE'] ?? 0,
        expired: byMemberStatus['EXPIRED'] ?? 0,
        suspended: byMemberStatus['SUSPENDED'] ?? 0,
        blocked: byMemberStatus['BLOCKED'] ?? 0,
        newThisMonth: newMembersThisMonth,
      },
      circulation: {
        loansToday,
        returnsToday,
        overdueToday,
        overdueTotal,
        activeReservations,
        readyForPickup: readyReservations,
      },
      finance: {
        outstandingAmount: Number(unpaidFines[0]?.total ?? 0),
        outstandingCount: Number(unpaidFines[0]?.count ?? 0),
      },
    };
  }

  /**
   * روند ماهانه امانت، بازگشت و دیرکرد (قانون ۴).
   * با `generate_series` تولید می‌شود تا ماه‌های بدون فعالیت هم صفر نشان
   * داده شوند — نمودار با شکاف، گمراه‌کننده است.
   */
  async circulationTrend(months = 12) {
    return this.prisma.$queryRaw<
      Array<{ period: string; loans: bigint; returns: bigint; overdue: bigint }>
    >`
      WITH periods AS (
        SELECT date_trunc('month', generate_series(
          date_trunc('month', now()) - (${months - 1} || ' months')::interval,
          date_trunc('month', now()),
          '1 month'::interval
        )) AS period
      )
      SELECT to_char(p.period, 'YYYY-MM') AS period,
             count(l."id") FILTER (WHERE date_trunc('month', l."loanedAt") = p.period)::bigint AS loans,
             count(l."id") FILTER (WHERE date_trunc('month', l."returnedAt") = p.period)::bigint AS returns,
             count(l."id") FILTER (
               WHERE date_trunc('month', l."dueAt") = p.period
                 AND (l."returnedAt" IS NULL OR l."returnedAt" > l."dueAt")
             )::bigint AS overdue
        FROM periods p
        LEFT JOIN loans l
          ON date_trunc('month', l."loanedAt")   = p.period
          OR date_trunc('month', l."returnedAt") = p.period
          OR date_trunc('month', l."dueAt")      = p.period
       GROUP BY p.period
       ORDER BY p.period
    `.then((rows) =>
      rows.map((r) => ({
        period: r.period,
        loans: Number(r.loans),
        returns: Number(r.returns),
        overdue: Number(r.overdue),
      })),
    );
  }

  /** رشد مجموعه — تعداد نسخه‌های افزوده‌شده در هر ماه (قانون ۴). */
  async collectionGrowth(months = 12) {
    const rows = await this.prisma.$queryRaw<
      Array<{ period: string; added: bigint; cumulative: bigint }>
    >`
      WITH periods AS (
        SELECT date_trunc('month', generate_series(
          date_trunc('month', now()) - (${months - 1} || ' months')::interval,
          date_trunc('month', now()),
          '1 month'::interval
        )) AS period
      ),
      monthly AS (
        SELECT p.period,
               count(c."id")::bigint AS added
          FROM periods p
          LEFT JOIN book_copies c
            ON date_trunc('month', c."createdAt") = p.period AND c."deletedAt" IS NULL
         GROUP BY p.period
      )
      SELECT to_char(period, 'YYYY-MM') AS period,
             added,
             sum(added) OVER (ORDER BY period)::bigint AS cumulative
        FROM monthly ORDER BY period
    `;
    return rows.map((r) => ({
      period: r.period,
      added: Number(r.added),
      cumulative: Number(r.cumulative),
    }));
  }

  /** پرترددترین کتاب‌ها (قانون ۳۸). */
  async popularBooks(range: DashboardRange, limit = 10) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; title: string; authors: string[] | null; loanCount: bigint }>
    >`
      SELECT b."id", b."title",
             (SELECT array_agg(p."fullName")
                FROM book_contributors bc JOIN persons p ON p."id" = bc."personId"
               WHERE bc."bookId" = b."id" AND bc."role" = 'AUTHOR') AS authors,
             count(l."id")::bigint AS "loanCount"
        FROM loans l
        JOIN book_copies c ON c."id" = l."copyId"
        JOIN books b ON b."id" = c."bookId"
       WHERE l."loanedAt" BETWEEN ${range.from} AND ${range.to}
         AND b."deletedAt" IS NULL
       GROUP BY b."id", b."title"
       ORDER BY "loanCount" DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      authors: r.authors ?? [],
      loanCount: Number(r.loanCount),
    }));
  }

  /** محبوب‌ترین موضوعات (قانون ۴). */
  async popularCategories(range: DashboardRange, limit = 8) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; loanCount: bigint }>
    >`
      SELECT cat."id", cat."name", count(l."id")::bigint AS "loanCount"
        FROM loans l
        JOIN book_copies c ON c."id" = l."copyId"
        JOIN book_categories bcat ON bcat."bookId" = c."bookId"
        JOIN categories cat ON cat."id" = bcat."categoryId"
       WHERE l."loanedAt" BETWEEN ${range.from} AND ${range.to}
         AND cat."deletedAt" IS NULL
       GROUP BY cat."id", cat."name"
       ORDER BY "loanCount" DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({ id: r.id, name: r.name, loanCount: Number(r.loanCount) }));
  }

  /** فعال‌ترین اعضا (قانون ۴). */
  async topMembers(range: DashboardRange, limit = 10) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; memberCode: string; fullName: string; loanCount: bigint }>
    >`
      SELECT m."id", m."memberCode",
             m."firstName" || ' ' || m."lastName" AS "fullName",
             count(l."id")::bigint AS "loanCount"
        FROM loans l
        JOIN members m ON m."id" = l."memberId"
       WHERE l."loanedAt" BETWEEN ${range.from} AND ${range.to}
         AND m."deletedAt" IS NULL
       GROUP BY m."id", m."memberCode", m."firstName", m."lastName"
       ORDER BY "loanCount" DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      memberCode: r.memberCode,
      fullName: r.fullName,
      loanCount: Number(r.loanCount),
    }));
  }

  /** محبوب‌ترین نویسندگان. */
  async topAuthors(range: DashboardRange, limit = 8) {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; fullName: string; loanCount: bigint }>
    >`
      SELECT p."id", p."fullName", count(l."id")::bigint AS "loanCount"
        FROM loans l
        JOIN book_copies c ON c."id" = l."copyId"
        JOIN book_contributors bc ON bc."bookId" = c."bookId" AND bc."role" IN ('AUTHOR','CO_AUTHOR')
        JOIN persons p ON p."id" = bc."personId"
       WHERE l."loanedAt" BETWEEN ${range.from} AND ${range.to}
         AND p."deletedAt" IS NULL
       GROUP BY p."id", p."fullName"
       ORDER BY "loanCount" DESC
       LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      loanCount: Number(r.loanCount),
    }));
  }

  /** آخرین فعالیت‌ها — Activity Feed داشبورد (قانون ۵۹). */
  async recentActivity(limit = 15) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'checkout', 'return', 'renew', 'create', 'delete',
            'create_copies', 'reserve', 'pay_fine', 'move_copies',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, action: true, entityType: true, entityId: true,
        entityLabel: true, userLabel: true, createdAt: true,
      },
    });
    return rows;
  }

  /** کتاب‌هایی که موعدشان نزدیک است — کتابدار باید یادآوری کند. */
  async dueSoon(days = 3, limit = 20) {
    const until = new Date(Date.now() + days * 86_400_000);
    return this.prisma.loan.findMany({
      where: { status: 'ACTIVE', dueAt: { gte: new Date(), lte: until } },
      orderBy: { dueAt: 'asc' },
      take: limit,
      select: {
        id: true, loanNumber: true, dueAt: true,
        member: { select: { id: true, memberCode: true, firstName: true, lastName: true, mobile: true } },
        copy: { select: { barcode: true, book: { select: { id: true, title: true } } } },
      },
    });
  }

  /** بازه‌های زمانی متعارف داشبورد (قانون ۱۰۷). */
  static resolveRange(preset: string, from?: Date, to?: Date): DashboardRange {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

    switch (preset) {
      case 'today':
        return { from: startOfDay, to: now, label: 'امروز' };
      case 'week':
        return { from: new Date(now.getTime() - 7 * 86_400_000), to: now, label: 'هفته گذشته' };
      case 'month':
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, label: 'ماه جاری' };
      case 'year':
        return { from: new Date(now.getFullYear(), 0, 1), to: now, label: 'سال جاری' };
      case 'custom':
        return {
          from: from ?? new Date(now.getTime() - 30 * 86_400_000),
          to: to ?? now,
          label: 'بازه دلخواه',
        };
      default:
        // پیش‌فرض: ۳۰ روز گذشته — بازه‌ای که هم داده کافی دارد هم به‌روز است
        return { from: new Date(now.getTime() - 30 * 86_400_000), to: now, label: '۳۰ روز گذشته' };
    }
  }
}
