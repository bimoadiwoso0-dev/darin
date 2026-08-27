import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  buildPageMeta,
  normalizeDigits,
  normalizePageQuery,
  type LoanStatus,
  type Paginated,
} from '@darin/shared';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { LoanPolicyService, type PolicyViolation } from './loan-policy.service';

export interface CheckoutInput {
  memberId: string;
  /** بارکد یا شماره ثبت نسخه‌ها — کتابدار اسکن می‌کند */
  barcodes: string[];
  /** یا مستقیماً شناسه نسخه‌ها */
  copyIds?: string[];
  /** مدت دلخواه (اگر کتابدار بخواهد از پیش‌فرض عدول کند) */
  loanDays?: number;
  note?: string;
  /** نادیده‌گرفتن محدودیت‌های قابل عبور — نیازمند مجوز `loans.override` */
  override?: boolean;
}

export interface CheckoutResult {
  batchId: string;
  loans: Array<{
    id: string;
    loanNumber: string;
    dueAt: Date;
    copy: { id: string; barcode: string; accessionNumber: string };
    book: { id: string; title: string };
  }>;
  warnings: string[];
}

export interface ReturnResult {
  loanId: string;
  loanNumber: string;
  bookTitle: string;
  copyBarcode: string;
  returnedAt: Date;
  wasOverdue: boolean;
  overdueDays: number;
  fine: { id: string; amount: number } | null;
  /** اگر عضوی این عنوان را رزرو کرده باشد، نسخه برایش کنار گذاشته می‌شود */
  heldForReservation: {
    reservationId: string;
    memberName: string;
    memberCode: string;
    expiresAt: Date;
  } | null;
  /** محل بازگرداندن کتاب به قفسه — کتابدار باید بداند کجا بگذاردش */
  shelfLocation: string | null;
}

/**
 * موتور امانت.
 *
 * ── تضمین‌های همروندی (ADR-07، قانون ۷۹) ───────────────────────────────
 * دو کتابدار ممکن است هم‌زمان یک نسخه را امانت بدهند. سه لایه دفاع داریم:
 *
 *  ۱. **UPDATE شرطی**: وضعیت نسخه با
 *     `UPDATE ... WHERE id = ? AND status = 'AVAILABLE'` تغییر می‌کند.
 *     اگر تعداد ردیف‌های تغییریافته صفر باشد، یعنی رقیب زودتر رسیده.
 *  ۲. **Partial Unique Index** روی `loans(copyId) WHERE status IN (ACTIVE, OVERDUE)`
 *     — حتی اگر لایه اول دور زده شود، دیتابیس اجازه نمی‌دهد.
 *  ۳. **تراکنش**: کل عملیات اتمیک است؛ حالت نیمه‌کاره ممکن نیست (قانون ۷۸).
 */
@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly policy: LoanPolicyService,
  ) {}

  // ═══ امانت دادن ════════════════════════════════════════════════════════

  async checkout(input: CheckoutInput, user: AuthenticatedUser, ip?: string): Promise<CheckoutResult> {
    const member = await this.prisma.member.findFirst({
      where: { id: input.memberId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, memberCode: true, branchId: true },
    });
    if (!member) throw DomainError.notFound('عضو');

    const copies = await this.resolveCopies(input);
    if (copies.length === 0) {
      throw DomainError.validation({ barcodes: ['هیچ نسخه‌ای انتخاب نشده است.'] });
    }

    const policy = await this.policy.forMember(member.id);

    // ── بررسی قوانین پیش از تراکنش ──────────────────────────────────────
    const violations = await this.policy.checkMemberEligibility(
      member.id,
      copies.length,
      policy,
    );
    const blocking = violations.filter((v) => !v.overridable || !input.override);
    if (blocking.length > 0) {
      const canOverride = violations.every((v) => v.overridable);
      throw new DomainError(
        blocking[0]!.code as never,
        blocking.map((v) => v.message).join(' '),
        {
          violations,
          // به UI می‌گوید آیا دکمه «نادیده بگیر و ادامه بده» را نشان بدهد
          overridable: canOverride && user.permissions.includes('loans.override'),
        },
      );
    }

    // ── بررسی وضعیت هر نسخه ─────────────────────────────────────────────
    const warnings: string[] = violations.map((v) => v.message);
    for (const copy of copies) {
      if (!copy.isLoanable) {
        throw new DomainError(
          ERROR_CODES.COPY_NOT_LOANABLE,
          `نسخه «${copy.book.title}» (${copy.accessionNumber}) قابل امانت نیست.`,
        );
      }
      if (copy.status !== 'AVAILABLE' && copy.status !== 'RESERVED_HOLD') {
        throw new DomainError(
          ERROR_CODES.COPY_NOT_AVAILABLE,
          `نسخه «${copy.book.title}» (${copy.accessionNumber}) در وضعیت «${copy.status}» است و قابل امانت نیست.`,
        );
      }
      // نسخه‌ای که برای عضو دیگری کنار گذاشته شده
      if (copy.status === 'RESERVED_HOLD') {
        const hold = await this.prisma.reservation.findFirst({
          where: { holdCopyId: copy.id, status: 'READY' },
          select: { memberId: true, member: { select: { firstName: true, lastName: true } } },
        });
        if (hold && hold.memberId !== member.id) {
          throw new DomainError(
            ERROR_CODES.RESERVED_FOR_ANOTHER_MEMBER,
            `نسخه «${copy.book.title}» برای ${hold.member.firstName} ${hold.member.lastName} کنار گذاشته شده است.`,
          );
        }
      }
    }

    const loanDays = input.loanDays ?? policy.loanDays;
    const batchId = randomUUID();
    const now = new Date();
    const dueAt = this.policy.computeDueDate(now, loanDays);

    // ── تراکنش ──────────────────────────────────────────────────────────
    const created = await this.prisma.$transaction(async (tx) => {
      const loans: CheckoutResult['loans'] = [];

      for (const copy of copies) {
        // لایه دفاع ۱: UPDATE شرطی. اگر نسخه بین بررسی بالا و اینجا توسط
        // کتابدار دیگری امانت داده شده باشد، اینجا صفر ردیف تغییر می‌کند.
        const claimed = await tx.$executeRaw`
          UPDATE book_copies
             SET "status" = 'ON_LOAN', "updatedAt" = now()
           WHERE "id" = ${copy.id}::uuid
             AND "status" IN ('AVAILABLE', 'RESERVED_HOLD')
             AND "deletedAt" IS NULL
        `;
        if (claimed === 0) {
          throw new DomainError(
            ERROR_CODES.COPY_NOT_AVAILABLE,
            `نسخه «${copy.book.title}» (${copy.accessionNumber}) هم‌اکنون توسط کاربر دیگری امانت داده شد. لطفاً دوباره بررسی کنید.`,
          );
        }

        const loanNumber = await this.numbering.next(tx, 'loan_number');
        const loan = await tx.loan.create({
          data: {
            loanNumber,
            branchId: member.branchId,
            memberId: member.id,
            copyId: copy.id,
            status: 'ACTIVE',
            loanedAt: now,
            dueAt,
            originalDueAt: dueAt,
            checkoutBatchId: batchId,
            loanedById: user.sub,
            note: input.note ?? null,
          },
          select: { id: true, loanNumber: true, dueAt: true },
        });

        // اگر این امانت، رزرو خود همین عضو را محقق می‌کند، رزرو بسته می‌شود
        await tx.reservation.updateMany({
          where: {
            bookId: copy.book.id,
            memberId: member.id,
            status: { in: ['PENDING', 'READY'] },
          },
          data: { status: 'FULFILLED', fulfilledLoanId: loan.id, holdCopyId: null },
        });

        loans.push({
          ...loan,
          copy: { id: copy.id, barcode: copy.barcode, accessionNumber: copy.accessionNumber },
          book: { id: copy.book.id, title: copy.book.title },
        });
      }

      return loans;
    });

    await this.audit.record({
      action: 'checkout',
      entityType: 'Loan',
      entityId: created[0]?.id,
      entityLabel: `${created.length} کتاب به ${member.firstName} ${member.lastName} (${member.memberCode})`,
      newData: {
        batchId,
        memberId: member.id,
        dueAt,
        loans: created.map((l) => ({ loanNumber: l.loanNumber, title: l.book.title })),
        overridden: input.override === true && violations.length > 0,
      },
      user,
      ip,
    });

    return { batchId, loans: created, warnings };
  }

  // ═══ بازگشت ════════════════════════════════════════════════════════════

  /**
   * ثبت بازگشت با بارکد — سریع‌ترین مسیر برای کتابدار (قانون ۹۰).
   * فقط یک اسکن لازم است؛ سیستم خودش امانت باز را پیدا می‌کند.
   */
  async returnByBarcode(
    barcode: string,
    options: { condition?: 'GOOD' | 'DAMAGED'; note?: string },
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<ReturnResult> {
    const normalized = normalizeDigits(barcode).trim();
    const copy = await this.prisma.bookCopy.findFirst({
      where: {
        deletedAt: null,
        OR: [{ barcode: normalized }, { accessionNumber: normalized }, { libraryCode: normalized }],
      },
      select: { id: true, book: { select: { title: true } } },
    });
    if (!copy) {
      throw new DomainError(
        ERROR_CODES.NOT_FOUND,
        `نسخه‌ای با شناسه «${barcode}» یافت نشد.`,
      );
    }

    const loan = await this.prisma.loan.findFirst({
      where: { copyId: copy.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
      select: { id: true },
    });
    if (!loan) {
      throw new DomainError(
        ERROR_CODES.LOAN_ALREADY_RETURNED,
        `کتاب «${copy.book.title}» در امانت نیست.`,
      );
    }

    return this.returnLoan(loan.id, options, user, ip);
  }

  /**
   * ثبت بازگشت.
   *
   * تراکنش شامل: بستن امانت + آزادسازی نسخه + محاسبه جریمه + فعال‌سازی
   * رزرو بعدی. یا همه با هم انجام می‌شوند یا هیچ‌کدام (قانون ۷۸).
   */
  async returnLoan(
    loanId: string,
    options: { condition?: 'GOOD' | 'DAMAGED'; note?: string },
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<ReturnResult> {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
        copy: {
          select: {
            id: true, barcode: true, accessionNumber: true, bookId: true,
            location: { select: { fullCode: true, name: true } },
            book: { select: { id: true, title: true } },
          },
        },
      },
    });
    if (!loan) throw DomainError.notFound('امانت');
    if (loan.status === 'RETURNED') {
      throw new DomainError(ERROR_CODES.LOAN_ALREADY_RETURNED);
    }

    const now = new Date();
    const policy = await this.policy.forMember(loan.memberId);
    const { overdueDays, amount } = this.policy.computeFine(loan.dueAt, now, policy);
    const damaged = options.condition === 'DAMAGED';

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: loanId },
        data: {
          status: 'RETURNED',
          returnedAt: now,
          returnedById: user.sub,
          note: options.note ? `${loan.note ?? ''}\n${options.note}`.trim() : undefined,
        },
      });

      // ── رزرو بعدی این عنوان ────────────────────────────────────────────
      // نسخه فقط وقتی «موجود» می‌شود که کسی در صف انتظار نباشد؛ در غیر این
      // صورت برای نفر اول صف کنار گذاشته می‌شود.
      let held: ReturnResult['heldForReservation'] = null;

      const nextReservation = damaged
        ? null
        : await tx.reservation.findFirst({
            where: { bookId: loan.copy.bookId, status: 'PENDING' },
            orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { reservedAt: 'asc' }],
            select: {
              id: true,
              member: { select: { firstName: true, lastName: true, memberCode: true } },
            },
          });

      if (nextReservation) {
        const expiresAt = new Date(now.getTime() + policy.reservationHoldDays * 86_400_000);
        await tx.reservation.update({
          where: { id: nextReservation.id },
          data: {
            status: 'READY',
            readyAt: now,
            expiresAt,
            holdCopyId: loan.copyId,
          },
        });
        await tx.bookCopy.update({
          where: { id: loan.copyId },
          data: { status: 'RESERVED_HOLD' },
        });
        held = {
          reservationId: nextReservation.id,
          memberName: `${nextReservation.member.firstName} ${nextReservation.member.lastName}`,
          memberCode: nextReservation.member.memberCode,
          expiresAt,
        };
      } else {
        await tx.bookCopy.update({
          where: { id: loan.copyId },
          data: {
            status: damaged ? 'DAMAGED' : 'AVAILABLE',
            condition: damaged ? 'POOR' : undefined,
            isLoanable: damaged ? false : undefined,
          },
        });
      }

      // ── جریمه دیرکرد ────────────────────────────────────────────────────
      let fine: { id: string; amount: number } | null = null;
      if (amount > 0) {
        const created = await tx.fine.create({
          data: {
            memberId: loan.memberId,
            loanId: loan.id,
            type: 'LATE_RETURN',
            amount,
            overdueDays,
            reason: `دیرکرد ${overdueDays} روزه در بازگرداندن «${loan.copy.book.title}»`,
            createdById: user.sub,
          },
          select: { id: true, amount: true },
        });
        fine = { id: created.id, amount: Number(created.amount) };

        // اعلان درون‌برنامه‌ای برای عضو
        await tx.notification.create({
          data: {
            memberId: loan.memberId,
            channel: 'IN_APP',
            type: 'FINE_ISSUED',
            title: 'ثبت جریمه دیرکرد',
            body: `بابت ${overdueDays} روز تأخیر در بازگرداندن «${loan.copy.book.title}» مبلغ ${amount.toLocaleString('fa-IR')} جریمه ثبت شد.`,
            payload: { fineId: created.id, loanId: loan.id },
            status: 'PENDING',
          },
        });
      }

      if (held) {
        await tx.notification.create({
          data: {
            memberId: (await tx.reservation.findUniqueOrThrow({
              where: { id: held.reservationId },
              select: { memberId: true },
            })).memberId,
            channel: 'IN_APP',
            type: 'RESERVATION_READY',
            title: 'کتاب رزروشده آماده است',
            body: `کتاب «${loan.copy.book.title}» آماده تحویل است. مهلت مراجعه تا ${held.expiresAt.toLocaleDateString('fa-IR')}.`,
            payload: { reservationId: held.reservationId, bookId: loan.copy.bookId },
            status: 'PENDING',
          },
        });
      }

      return { fine, held };
    });

    await this.audit.record({
      action: 'return',
      entityType: 'Loan',
      entityId: loanId,
      entityLabel: `«${loan.copy.book.title}» از ${loan.member.firstName} ${loan.member.lastName}`,
      oldData: { status: loan.status, dueAt: loan.dueAt },
      newData: {
        status: 'RETURNED',
        returnedAt: now,
        overdueDays,
        fineAmount: result.fine?.amount ?? 0,
        damaged,
      },
      user,
      ip,
    });

    return {
      loanId,
      loanNumber: loan.loanNumber,
      bookTitle: loan.copy.book.title,
      copyBarcode: loan.copy.barcode,
      returnedAt: now,
      wasOverdue: overdueDays > 0,
      overdueDays,
      fine: result.fine,
      heldForReservation: result.held,
      shelfLocation: loan.copy.location
        ? `${loan.copy.location.name} (${loan.copy.location.fullCode})`
        : null,
    };
  }

  // ═══ تمدید ═════════════════════════════════════════════════════════════

  /**
   * تمدید امانت (قانون ۱۹).
   *
   * چهار قانون قابل تنظیم بررسی می‌شوند:
   *  ۱. سقف تعداد تمدید
   *  ۲. کتاب رزروشده قابل تمدید نیست (حق نفر بعدی صف)
   *  ۳. امانت دیرکرددار قابل تمدید نیست
   *  ۴. عضو بدهکار نمی‌تواند تمدید کند
   */
  async renew(
    loanId: string,
    options: { days?: number; override?: boolean },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        copy: { select: { bookId: true, book: { select: { title: true } } } },
        member: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!loan) throw DomainError.notFound('امانت');
    if (loan.status === 'RETURNED') throw new DomainError(ERROR_CODES.LOAN_ALREADY_RETURNED);

    const policy = await this.policy.forMember(loan.memberId);
    const violations: PolicyViolation[] = [];

    if (loan.renewalCount >= policy.maxRenewals) {
      violations.push({
        code: ERROR_CODES.RENEWAL_LIMIT_REACHED,
        message: `این امانت ${loan.renewalCount} بار تمدید شده و به سقف مجاز (${policy.maxRenewals}) رسیده است.`,
        overridable: true,
      });
    }

    if (loan.status === 'OVERDUE' || loan.dueAt < new Date()) {
      violations.push({
        code: ERROR_CODES.RENEWAL_BLOCKED_BY_OVERDUE,
        message: 'این امانت دیرکرد دارد و قابل تمدید نیست؛ ابتدا کتاب را بازگردانید.',
        overridable: true,
      });
    }

    if (policy.reservationBlocksRenewal) {
      const waiting = await this.prisma.reservation.count({
        where: {
          bookId: loan.copy.bookId,
          status: 'PENDING',
          memberId: { not: loan.memberId },
        },
      });
      if (waiting > 0) {
        violations.push({
          code: ERROR_CODES.RENEWAL_BLOCKED_BY_RESERVATION,
          message: `${waiting} نفر این کتاب را رزرو کرده‌اند و تمدید ممکن نیست.`,
          // حق نفر بعدی صف؛ حتی کتابدار هم نباید ساده از آن عبور کند
          overridable: false,
        });
      }
    }

    const debt = await this.policy.outstandingDebt(loan.memberId);
    if (policy.blockIfUnpaidFines && debt > policy.unpaidFineThreshold) {
      violations.push({
        code: ERROR_CODES.MEMBER_HAS_UNPAID_FINES,
        message: `بدهی این عضو ${debt.toLocaleString('fa-IR')} است.`,
        overridable: true,
      });
    }

    const blocking = violations.filter((v) => !v.overridable || !options.override);
    if (blocking.length > 0) {
      throw new DomainError(
        blocking[0]!.code as never,
        blocking.map((v) => v.message).join(' '),
        {
          violations,
          overridable:
            violations.every((v) => v.overridable) && user.permissions.includes('loans.override'),
        },
      );
    }

    const days = options.days ?? policy.renewalDays;
    // تمدید از **موعد فعلی** ادامه پیدا می‌کند، نه از امروز — وگرنه عضوی که
    // زودتر تمدید می‌کند روزهای باقیمانده‌اش را از دست می‌دهد.
    const base = loan.dueAt > new Date() ? loan.dueAt : new Date();
    const newDueAt = this.policy.computeDueDate(base, days);

    // قفل خوش‌بینانه: شرط `renewalCount` تضمین می‌کند دو درخواست تمدید هم‌زمان
    // باعث دو بار افزایش موعد نشوند.
    const updated = await this.prisma.loan.updateMany({
      where: { id: loanId, renewalCount: loan.renewalCount, status: { in: ['ACTIVE', 'OVERDUE'] } },
      data: {
        dueAt: newDueAt,
        renewalCount: loan.renewalCount + 1,
        lastRenewedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    if (updated.count === 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'این امانت هم‌زمان توسط کاربر دیگری تغییر کرد. لطفاً صفحه را تازه کنید.',
      );
    }

    await this.audit.record({
      action: 'renew',
      entityType: 'Loan',
      entityId: loanId,
      entityLabel: `«${loan.copy.book.title}» — ${loan.member.firstName} ${loan.member.lastName}`,
      oldData: { dueAt: loan.dueAt, renewalCount: loan.renewalCount },
      newData: { dueAt: newDueAt, renewalCount: loan.renewalCount + 1 },
      user,
      ip,
    });

    return {
      loanId,
      previousDueAt: loan.dueAt,
      dueAt: newDueAt,
      renewalCount: loan.renewalCount + 1,
      remainingRenewals: Math.max(0, policy.maxRenewals - loan.renewalCount - 1),
    };
  }

  // ═══ خواندن ════════════════════════════════════════════════════════════

  async list(query: {
    page?: number;
    pageSize?: number;
    memberId?: string;
    copyId?: string;
    bookId?: string;
    status?: LoanStatus[];
    overdueOnly?: boolean;
    dueBefore?: Date;
    from?: Date;
    to?: Date;
    q?: string;
    sort?: 'loanedAt' | 'dueAt' | 'returnedAt';
    order?: 'asc' | 'desc';
  }): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.LoanWhereInput = {};

    if (query.memberId) where.memberId = query.memberId;
    if (query.copyId) where.copyId = query.copyId;
    if (query.bookId) where.copy = { bookId: query.bookId };
    if (query.status?.length) where.status = { in: query.status };
    if (query.overdueOnly) where.status = 'OVERDUE';
    if (query.dueBefore) where.dueAt = { lte: query.dueBefore };
    if (query.from || query.to) {
      where.loanedAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.q) {
      const digits = normalizeDigits(query.q).trim();
      where.OR = [
        { loanNumber: { contains: digits } },
        { copy: { barcode: { contains: digits } } },
        { member: { memberCode: { contains: query.q, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.LoanOrderByWithRelationInput =
      query.sort === 'dueAt'
        ? { dueAt: query.order ?? 'asc' }
        : query.sort === 'returnedAt'
          ? { returnedAt: query.order ?? 'desc' }
          : { loanedAt: query.order ?? 'desc' };

    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({
        where, skip, take, orderBy,
        select: {
          id: true, loanNumber: true, status: true, loanedAt: true, dueAt: true,
          returnedAt: true, renewalCount: true,
          member: {
            select: { id: true, memberCode: true, firstName: true, lastName: true, mobile: true },
          },
          copy: {
            select: {
              id: true, barcode: true, accessionNumber: true,
              book: { select: { id: true, title: true, volumeTitle: true } },
              location: { select: { fullCode: true } },
            },
          },
          fines: {
            where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } },
            select: { id: true, amount: true, paidAmount: true },
          },
        },
      }),
      this.prisma.loan.count({ where }),
    ]);

    const now = Date.now();
    return {
      data: rows.map((r) => ({
        ...r,
        memberName: `${r.member.firstName} ${r.member.lastName}`,
        // روزهای باقیمانده/گذشته — UI با همین عدد رنگ ردیف را تعیین می‌کند
        daysRemaining: Math.ceil((r.dueAt.getTime() - now) / 86_400_000),
        outstandingFine: r.fines.reduce(
          (sum, f) => sum + (Number(f.amount) - Number(f.paidAmount)),
          0,
        ),
      })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findOne(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        member: {
          select: {
            id: true, memberCode: true, firstName: true, lastName: true,
            mobile: true, email: true, status: true,
          },
        },
        copy: {
          include: {
            book: {
              select: {
                id: true, title: true, volumeTitle: true, coverImageId: true,
                contributors: {
                  where: { role: 'AUTHOR' }, take: 2,
                  select: { person: { select: { fullName: true } } },
                },
              },
            },
            location: { select: { id: true, name: true, fullCode: true } },
          },
        },
        fines: { include: { payments: true } },
      },
    });
    if (!loan) throw DomainError.notFound('امانت');
    return loan;
  }

  /**
   * علامت‌گذاری امانت‌های سررسیدگذشته.
   * هر شب اجرا می‌شود. `OVERDUE` یک وضعیت ذخیره‌شده است نه محاسبه‌شده، تا
   * بتوان روی آن ایندکس زد و گزارش‌های دیرکرد سریع بمانند.
   */
  async markOverdueLoans(): Promise<number> {
    const result = await this.prisma.loan.updateMany({
      where: { status: 'ACTIVE', dueAt: { lt: new Date() } },
      data: { status: 'OVERDUE' },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} امانت به وضعیت دیرکرد تغییر یافت`);
    }
    return result.count;
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  private async resolveCopies(input: CheckoutInput) {
    const barcodes = (input.barcodes ?? [])
      .map((b) => normalizeDigits(b).trim())
      .filter(Boolean);
    const ids = input.copyIds ?? [];

    if (barcodes.length === 0 && ids.length === 0) return [];
    if (barcodes.length + ids.length > 50) {
      throw DomainError.validation({
        barcodes: ['حداکثر ۵۰ کتاب در یک عملیات امانت مجاز است.'],
      });
    }

    const copies = await this.prisma.bookCopy.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...(barcodes.length
            ? [
                { barcode: { in: barcodes } },
                { accessionNumber: { in: barcodes } },
                { libraryCode: { in: barcodes } },
              ]
            : []),
        ],
      },
      select: {
        id: true, barcode: true, accessionNumber: true, status: true, isLoanable: true,
        book: { select: { id: true, title: true } },
      },
    });

    // بارکدی که هیچ نسخه‌ای ندارد باید صریحاً گزارش شود، نه بی‌صدا نادیده گرفته شود
    const found = new Set(
      copies.flatMap((c) => [c.barcode, c.accessionNumber]),
    );
    const missing = barcodes.filter((b) => !found.has(b));
    if (missing.length > 0) {
      throw new DomainError(
        ERROR_CODES.NOT_FOUND,
        `این شناسه‌ها یافت نشدند: ${missing.join('، ')}`,
        { missing },
      );
    }

    return copies;
  }
}
