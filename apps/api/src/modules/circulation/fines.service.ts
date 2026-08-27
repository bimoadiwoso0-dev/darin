import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  SETTING_KEYS,
  buildPageMeta,
  normalizePageQuery,
  type FineStatus,
  type FineType,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

/**
 * جریمه و پرداخت (قانون ۲۱).
 *
 * ── دقت مالی ─────────────────────────────────────────────────────────────
 * تمام مبالغ `Decimal(14,2)` هستند و محاسبات با `Prisma.Decimal` انجام
 * می‌شود، نه با `number` جاوااسکریپت. یک `0.1 + 0.2 = 0.30000000000000004`
 * در حساب مالی کتابخانه قابل قبول نیست.
 *
 * ── تغییرناپذیری ─────────────────────────────────────────────────────────
 * جریمه و پرداخت هرگز حذف نمی‌شوند. جریمه اشتباه «بخشیده» می‌شود (WAIVED)
 * با ثبت دلیل و کاربر — تا سابقه مالی همیشه قابل حسابرسی بماند.
 */
@Injectable()
export class FinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: {
    page?: number;
    pageSize?: number;
    memberId?: string;
    loanId?: string;
    status?: FineStatus[];
    type?: FineType;
    unpaidOnly?: boolean;
    from?: Date;
    to?: Date;
  }): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.FineWhereInput = {};
    if (query.memberId) where.memberId = query.memberId;
    if (query.loanId) where.loanId = query.loanId;
    if (query.type) where.type = query.type;
    if (query.unpaidOnly) where.status = { in: ['UNPAID', 'PARTIALLY_PAID'] };
    else if (query.status?.length) where.status = { in: query.status };
    if (query.from || query.to) {
      where.issuedAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [rows, total, totals] = await Promise.all([
      this.prisma.fine.findMany({
        where, skip, take,
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true, type: true, status: true, amount: true, paidAmount: true, currency: true,
          reason: true, overdueDays: true, issuedAt: true, settledAt: true, waiveReason: true,
          member: {
            select: { id: true, memberCode: true, firstName: true, lastName: true, mobile: true },
          },
          loan: {
            select: {
              id: true, loanNumber: true, dueAt: true, returnedAt: true,
              copy: { select: { barcode: true, book: { select: { id: true, title: true } } } },
            },
          },
        },
      }),
      this.prisma.fine.count({ where }),
      // جمع کل — کتابدار باید بداند مجموع بدهی این فیلتر چقدر است
      this.prisma.fine.aggregate({ where, _sum: { amount: true, paidAmount: true } }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        paidAmount: Number(r.paidAmount),
        remaining: Number(r.amount) - Number(r.paidAmount),
        memberName: `${r.member.firstName} ${r.member.lastName}`,
      })),
      meta: {
        ...buildPageMeta(page, pageSize, total),
        totalAmount: Number(totals._sum.amount ?? 0),
        totalPaid: Number(totals._sum.paidAmount ?? 0),
        totalOutstanding: Number(totals._sum.amount ?? 0) - Number(totals._sum.paidAmount ?? 0),
      } as never,
    };
  }

  async findOne(id: string) {
    const fine = await this.prisma.fine.findUnique({
      where: { id },
      include: {
        member: { select: { id: true, memberCode: true, firstName: true, lastName: true } },
        loan: {
          select: {
            id: true, loanNumber: true, loanedAt: true, dueAt: true, returnedAt: true,
            copy: { select: { barcode: true, book: { select: { id: true, title: true } } } },
          },
        },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!fine) throw DomainError.notFound('جریمه');
    return {
      ...fine,
      amount: Number(fine.amount),
      paidAmount: Number(fine.paidAmount),
      remaining: Number(fine.amount) - Number(fine.paidAmount),
      payments: fine.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
    };
  }

  /** ثبت جریمه دستی (آسیب، مفقودی، حق عضویت). */
  async create(
    input: {
      memberId: string;
      loanId?: string | null;
      type: FineType;
      amount: number;
      reason: string;
      note?: string | null;
      dueAt?: Date | null;
    },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: { id: input.memberId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, memberCode: true },
    });
    if (!member) throw DomainError.notFound('عضو');

    if (input.amount <= 0) {
      throw DomainError.validation({ amount: ['مبلغ جریمه باید بزرگ‌تر از صفر باشد.'] });
    }

    const fine = await this.prisma.fine.create({
      data: {
        memberId: input.memberId,
        loanId: input.loanId ?? null,
        type: input.type,
        amount: new Prisma.Decimal(input.amount),
        currency: this.settings.get(SETTING_KEYS.LIBRARY_CURRENCY),
        reason: input.reason.trim(),
        note: input.note ?? null,
        dueAt: input.dueAt ?? null,
        createdById: user.sub,
      },
    });

    await this.prisma.notification.create({
      data: {
        memberId: member.id,
        channel: 'IN_APP',
        type: 'FINE_ISSUED',
        title: 'ثبت جریمه',
        body: `جریمه‌ای به مبلغ ${input.amount.toLocaleString('fa-IR')} بابت «${input.reason}» ثبت شد.`,
        payload: { fineId: fine.id },
        status: 'PENDING',
      },
    });

    await this.audit.record({
      action: 'create_fine',
      entityType: 'Fine',
      entityId: fine.id,
      entityLabel: `${input.amount.toLocaleString('fa-IR')} — ${member.firstName} ${member.lastName} (${member.memberCode})`,
      newData: { type: input.type, amount: input.amount, reason: input.reason },
      user,
      ip,
    });

    return this.findOne(fine.id);
  }

  /**
   * ثبت پرداخت.
   *
   * تراکنش شامل: ثبت پرداخت + به‌روزرسانی `paidAmount` و وضعیت جریمه.
   * قید دیتابیس `paidAmount <= amount` آخرین خط دفاع در برابر پرداخت اضافی است.
   */
  async pay(
    fineId: string,
    input: { amount: number; method: 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE'; reference?: string; note?: string },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const fine = await this.prisma.fine.findUnique({
      where: { id: fineId },
      select: {
        id: true, amount: true, paidAmount: true, status: true,
        member: { select: { firstName: true, lastName: true, memberCode: true } },
      },
    });
    if (!fine) throw DomainError.notFound('جریمه');

    if (fine.status === 'PAID' || fine.status === 'WAIVED') {
      throw new DomainError(ERROR_CODES.FINE_ALREADY_SETTLED);
    }

    const remaining = new Prisma.Decimal(fine.amount).minus(fine.paidAmount);
    const payment = new Prisma.Decimal(input.amount);

    if (payment.lessThanOrEqualTo(0)) {
      throw DomainError.validation({ amount: ['مبلغ پرداخت باید بزرگ‌تر از صفر باشد.'] });
    }
    if (payment.greaterThan(remaining)) {
      throw new DomainError(
        ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
        `مانده بدهی ${remaining.toFixed(0)} است و مبلغ واردشده از آن بیشتر است.`,
      );
    }

    const newPaid = new Prisma.Decimal(fine.paidAmount).plus(payment);
    const fullySettled = newPaid.greaterThanOrEqualTo(fine.amount);

    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          fineId,
          amount: payment,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          receivedById: user.sub,
        },
      }),
      this.prisma.fine.update({
        where: { id: fineId },
        data: {
          paidAmount: newPaid,
          status: fullySettled ? 'PAID' : 'PARTIALLY_PAID',
          settledAt: fullySettled ? new Date() : null,
        },
      }),
    ]);

    await this.audit.record({
      action: 'pay_fine',
      entityType: 'Fine',
      entityId: fineId,
      entityLabel: `${payment.toFixed(0)} از ${fine.member.firstName} ${fine.member.lastName} (${fine.member.memberCode})`,
      oldData: { paidAmount: Number(fine.paidAmount), status: fine.status },
      newData: {
        paidAmount: Number(newPaid),
        status: fullySettled ? 'PAID' : 'PARTIALLY_PAID',
        method: input.method,
      },
      user,
      ip,
    });

    return this.findOne(fineId);
  }

  /** بخشش جریمه — نیازمند دلیل، چون یک تصمیم مالی است که باید قابل حسابرسی باشد. */
  async waive(fineId: string, reason: string, user: AuthenticatedUser, ip?: string) {
    const fine = await this.prisma.fine.findUnique({
      where: { id: fineId },
      select: {
        id: true, amount: true, paidAmount: true, status: true,
        member: { select: { firstName: true, lastName: true, memberCode: true } },
      },
    });
    if (!fine) throw DomainError.notFound('جریمه');
    if (fine.status === 'PAID' || fine.status === 'WAIVED') {
      throw new DomainError(ERROR_CODES.FINE_ALREADY_SETTLED);
    }
    if (!reason.trim()) {
      throw DomainError.validation({ reason: ['برای بخشش جریمه باید دلیل ثبت شود.'] });
    }

    await this.prisma.fine.update({
      where: { id: fineId },
      data: {
        status: 'WAIVED',
        waivedById: user.sub,
        waiveReason: reason.trim(),
        settledAt: new Date(),
      },
    });

    await this.audit.record({
      action: 'waive_fine',
      entityType: 'Fine',
      entityId: fineId,
      entityLabel: `${Number(fine.amount).toLocaleString('fa-IR')} — ${fine.member.firstName} ${fine.member.lastName}`,
      oldData: { status: fine.status },
      newData: { status: 'WAIVED', reason },
      user,
      ip,
    });

    return this.findOne(fineId);
  }

  /** خلاصه مالی یک عضو — نمایش در پروفایل و پیش از امانت. */
  async memberSummary(memberId: string) {
    const [outstanding, paid, waived, count] = await Promise.all([
      this.prisma.fine.aggregate({
        where: { memberId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
        _sum: { amount: true, paidAmount: true },
      }),
      this.prisma.fine.aggregate({
        where: { memberId, status: 'PAID' },
        _sum: { amount: true },
      }),
      this.prisma.fine.aggregate({
        where: { memberId, status: 'WAIVED' },
        _sum: { amount: true },
      }),
      this.prisma.fine.count({ where: { memberId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } }),
    ]);

    return {
      outstandingAmount:
        Number(outstanding._sum.amount ?? 0) - Number(outstanding._sum.paidAmount ?? 0),
      outstandingCount: count,
      totalPaid: Number(paid._sum.amount ?? 0),
      totalWaived: Number(waived._sum.amount ?? 0),
    };
  }

  /** پرداخت یکجای همه بدهی‌های یک عضو — سناریوی پرتکرار میز امانت. */
  async settleAllForMember(
    memberId: string,
    method: 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE',
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ settled: number; totalAmount: number }> {
    const outstanding = await this.prisma.fine.findMany({
      where: { memberId, status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
      select: { id: true, amount: true, paidAmount: true },
    });
    if (outstanding.length === 0) return { settled: 0, totalAmount: 0 };

    let total = new Prisma.Decimal(0);
    await this.prisma.$transaction(async (tx) => {
      for (const fine of outstanding) {
        const remaining = new Prisma.Decimal(fine.amount).minus(fine.paidAmount);
        if (remaining.lessThanOrEqualTo(0)) continue;
        total = total.plus(remaining);

        await tx.payment.create({
          data: { fineId: fine.id, amount: remaining, method, receivedById: user.sub },
        });
        await tx.fine.update({
          where: { id: fine.id },
          data: { paidAmount: fine.amount, status: 'PAID', settledAt: new Date() },
        });
      }
    });

    await this.audit.record({
      action: 'settle_all_fines',
      entityType: 'Fine',
      entityLabel: `تسویه کامل ${outstanding.length} جریمه — مبلغ ${total.toFixed(0)}`,
      newData: { memberId, count: outstanding.length, total: Number(total), method },
      user,
      ip,
    });

    return { settled: outstanding.length, totalAmount: Number(total) };
  }
}
