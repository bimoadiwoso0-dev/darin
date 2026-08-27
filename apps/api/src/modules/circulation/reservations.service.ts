import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, buildPageMeta, normalizePageQuery, type Paginated } from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { LoanPolicyService } from './loan-policy.service';

/**
 * رزرو کتاب (قانون ۲۰).
 *
 * ── چرا رزرو در سطح «عنوان» است، نه «نسخه» ──────────────────────────────
 * عضو می‌گوید «کتاب صد سال تنهایی را می‌خواهم»، نه «نسخه شماره ۳ را».
 * اگر رزرو به نسخه خاصی وصل می‌شد، عضو باید منتظر همان نسخه می‌ماند حتی
 * وقتی نسخه دیگری زودتر برمی‌گشت.
 *
 * وقتی نسخه‌ای از آن عنوان بازگردانده می‌شود، `LoansService.returnLoan`
 * آن را برای نفر اول صف کنار می‌گذارد (`RESERVED_HOLD`).
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: LoanPolicyService,
  ) {}

  async create(
    input: { bookId: string; memberId: string; note?: string; priority?: number },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const [book, member] = await Promise.all([
      this.prisma.book.findFirst({
        where: { id: input.bookId, deletedAt: null },
        select: { id: true, title: true },
      }),
      this.prisma.member.findFirst({
        where: { id: input.memberId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, memberCode: true, status: true },
      }),
    ]);
    if (!book) throw DomainError.notFound('کتاب');
    if (!member) throw DomainError.notFound('عضو');

    if (member.status === 'BLOCKED' || member.status === 'SUSPENDED') {
      throw new DomainError(
        ERROR_CODES.MEMBER_NOT_ACTIVE,
        'عضویت این شخص فعال نیست و امکان رزرو ندارد.',
      );
    }

    const policy = await this.policy.forMember(member.id);
    if (!policy.canReserve) {
      throw DomainError.forbidden('نوع عضویت این شخص امکان رزرو ندارد.');
    }

    const activeCount = await this.prisma.reservation.count({
      where: { memberId: member.id, status: { in: ['PENDING', 'READY'] } },
    });
    if (activeCount >= policy.maxReservations) {
      throw new DomainError(
        ERROR_CODES.RESERVATION_LIMIT_REACHED,
        `سقف مجاز رزرو ${policy.maxReservations} کتاب است و این عضو ${activeCount} رزرو فعال دارد.`,
      );
    }

    // عضوی که خودش نسخه‌ای از این عنوان را در امانت دارد، نباید رزرو کند
    const alreadyHas = await this.prisma.loan.findFirst({
      where: {
        memberId: member.id,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        copy: { bookId: book.id },
      },
      select: { id: true },
    });
    if (alreadyHas) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'این عضو هم‌اکنون نسخه‌ای از این کتاب را در امانت دارد.',
      );
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      // قید یکتای جزئی `reservations_one_active_per_member_book` این حالت را
      // در سطح دیتابیس هم می‌بندد؛ این بررسی فقط برای پیام بهتر است.
      const duplicate = await tx.reservation.findFirst({
        where: { bookId: book.id, memberId: member.id, status: { in: ['PENDING', 'READY'] } },
        select: { id: true, queuePosition: true },
      });
      if (duplicate) {
        throw new DomainError(
          ERROR_CODES.ALREADY_RESERVED,
          `این عضو قبلاً این کتاب را رزرو کرده است (جایگاه ${duplicate.queuePosition} در صف).`,
        );
      }

      const last = await tx.reservation.findFirst({
        where: { bookId: book.id, status: { in: ['PENDING', 'READY'] } },
        orderBy: { queuePosition: 'desc' },
        select: { queuePosition: true },
      });

      return tx.reservation.create({
        data: {
          bookId: book.id,
          memberId: member.id,
          status: 'PENDING',
          queuePosition: (last?.queuePosition ?? 0) + 1,
          priority: input.priority ?? 0,
          note: input.note ?? null,
          createdById: user.sub,
        },
      });
    });

    // اگر نسخه‌ای همین حالا موجود است، رزرو بی‌درنگ آماده می‌شود
    const availableNow = await this.tryFulfillImmediately(reservation.id, book.id, policy.reservationHoldDays);

    await this.audit.record({
      action: 'reserve',
      entityType: 'Reservation',
      entityId: reservation.id,
      entityLabel: `«${book.title}» برای ${member.firstName} ${member.lastName} (${member.memberCode})`,
      newData: { queuePosition: reservation.queuePosition, readyImmediately: availableNow },
      user,
      ip,
    });

    return this.findOne(reservation.id);
  }

  /**
   * اگر نسخه آزادی از این عنوان وجود دارد، همان لحظه کنار گذاشته می‌شود.
   * بدون این، عضو بی‌دلیل در صف می‌ماند در حالی که کتاب روی قفسه است.
   */
  private async tryFulfillImmediately(
    reservationId: string,
    bookId: string,
    holdDays: number,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        select: { queuePosition: true, status: true },
      });
      // فقط نفر اول صف حق دارد نسخه آزاد را بگیرد
      if (!reservation || reservation.status !== 'PENDING' || reservation.queuePosition !== 1) {
        return false;
      }

      const free = await tx.bookCopy.findFirst({
        where: { bookId, deletedAt: null, status: 'AVAILABLE', isLoanable: true },
        select: { id: true },
      });
      if (!free) return false;

      const claimed = await tx.$executeRaw`
        UPDATE book_copies SET "status" = 'RESERVED_HOLD', "updatedAt" = now()
         WHERE "id" = ${free.id}::uuid AND "status" = 'AVAILABLE'
      `;
      if (claimed === 0) return false;

      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'READY',
          readyAt: new Date(),
          expiresAt: new Date(Date.now() + holdDays * 86_400_000),
          holdCopyId: free.id,
        },
      });
      return true;
    });
  }

  async cancel(id: string, reason: string | undefined, user: AuthenticatedUser, ip?: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        book: { select: { id: true, title: true } },
        member: { select: { firstName: true, lastName: true } },
      },
    });
    if (!reservation) throw DomainError.notFound('رزرو');
    if (reservation.status === 'CANCELLED' || reservation.status === 'FULFILLED') {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, 'این رزرو قبلاً بسته شده است.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          holdCopyId: null,
          note: reason ? `${reservation.note ?? ''}\nلغو: ${reason}`.trim() : undefined,
        },
      });

      // نسخه کنارگذاشته‌شده باید آزاد شود یا به نفر بعدی برسد
      if (reservation.holdCopyId) {
        await this.passHoldToNextInQueue(tx, reservation.bookId, reservation.holdCopyId);
      }
      await this.compactQueue(tx, reservation.bookId);
    });

    await this.audit.record({
      action: 'cancel_reservation',
      entityType: 'Reservation',
      entityId: id,
      entityLabel: `«${reservation.book.title}» — ${reservation.member.firstName} ${reservation.member.lastName}`,
      newData: { reason },
      user,
      ip,
    });
  }

  /**
   * انقضای رزروهای آماده‌ای که عضو برای دریافتشان مراجعه نکرده.
   * هر شب اجرا می‌شود؛ نسخه به نفر بعدی صف می‌رسد یا آزاد می‌شود.
   */
  async expireStaleHolds(): Promise<number> {
    const expired = await this.prisma.reservation.findMany({
      where: { status: 'READY', expiresAt: { lt: new Date() } },
      select: { id: true, bookId: true, holdCopyId: true },
    });

    for (const r of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: r.id },
          data: { status: 'EXPIRED', holdCopyId: null },
        });
        if (r.holdCopyId) {
          await this.passHoldToNextInQueue(tx, r.bookId, r.holdCopyId);
        }
        await this.compactQueue(tx, r.bookId);
      });
    }

    if (expired.length > 0) {
      this.logger.log(`${expired.length} رزرو منقضی شد`);
    }
    return expired.length;
  }

  async list(query: {
    page?: number;
    pageSize?: number;
    bookId?: string;
    memberId?: string;
    status?: Array<'PENDING' | 'READY' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED'>;
    readyOnly?: boolean;
  }): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.ReservationWhereInput = {};
    if (query.bookId) where.bookId = query.bookId;
    if (query.memberId) where.memberId = query.memberId;
    if (query.readyOnly) where.status = 'READY';
    else if (query.status?.length) where.status = { in: query.status };

    const [rows, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where, skip, take,
        orderBy: [{ status: 'asc' }, { queuePosition: 'asc' }, { reservedAt: 'asc' }],
        select: {
          id: true, status: true, queuePosition: true, reservedAt: true,
          readyAt: true, expiresAt: true, note: true,
          book: {
            select: {
              id: true, title: true, coverImageId: true,
              _count: { select: { copies: { where: { deletedAt: null, status: 'AVAILABLE' } } } },
            },
          },
          member: {
            select: { id: true, memberCode: true, firstName: true, lastName: true, mobile: true },
          },
          holdCopy: { select: { id: true, barcode: true, location: { select: { fullCode: true } } } },
        },
      }),
      this.prisma.reservation.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        memberName: `${r.member.firstName} ${r.member.lastName}`,
        availableCopies: r.book._count.copies,
        book: { ...r.book, _count: undefined },
      })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findOne(id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: {
        book: {
          select: {
            id: true, title: true, coverImageId: true,
            contributors: {
              where: { role: 'AUTHOR' }, take: 2,
              select: { person: { select: { fullName: true } } },
            },
          },
        },
        member: {
          select: { id: true, memberCode: true, firstName: true, lastName: true, mobile: true },
        },
        holdCopy: {
          select: { id: true, barcode: true, accessionNumber: true, location: { select: { fullCode: true } } },
        },
      },
    });
    if (!reservation) throw DomainError.notFound('رزرو');

    const ahead = await this.prisma.reservation.count({
      where: {
        bookId: reservation.bookId,
        status: { in: ['PENDING', 'READY'] },
        queuePosition: { lt: reservation.queuePosition },
      },
    });

    return {
      ...reservation,
      memberName: `${reservation.member.firstName} ${reservation.member.lastName}`,
      peopleAhead: ahead,
    };
  }

  /** صف انتظار یک عنوان — نمایش در صفحه کتاب. */
  async queueForBook(bookId: string) {
    return this.prisma.reservation.findMany({
      where: { bookId, status: { in: ['PENDING', 'READY'] } },
      orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }],
      select: {
        id: true, status: true, queuePosition: true, reservedAt: true, expiresAt: true,
        member: { select: { id: true, memberCode: true, firstName: true, lastName: true } },
      },
    });
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  /** نسخه کنارگذاشته‌شده را به نفر بعدی صف می‌دهد، یا آزادش می‌کند. */
  private async passHoldToNextInQueue(
    tx: Prisma.TransactionClient,
    bookId: string,
    copyId: string,
  ): Promise<void> {
    const next = await tx.reservation.findFirst({
      where: { bookId, status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { reservedAt: 'asc' }],
      select: { id: true, memberId: true, book: { select: { title: true } } },
    });

    if (!next) {
      await tx.bookCopy.update({ where: { id: copyId }, data: { status: 'AVAILABLE' } });
      return;
    }

    const holdDays = this.policy.defaults().reservationHoldDays;
    const expiresAt = new Date(Date.now() + holdDays * 86_400_000);

    await tx.reservation.update({
      where: { id: next.id },
      data: { status: 'READY', readyAt: new Date(), expiresAt, holdCopyId: copyId },
    });
    await tx.notification.create({
      data: {
        memberId: next.memberId,
        channel: 'IN_APP',
        type: 'RESERVATION_READY',
        title: 'کتاب رزروشده آماده است',
        body: `کتاب «${next.book.title}» آماده تحویل است.`,
        payload: { reservationId: next.id, bookId },
        status: 'PENDING',
      },
    });
  }

  /**
   * فشرده‌سازی صف پس از لغو یا انقضا.
   * بدون این، جایگاه‌ها به شکل ۱، ۳، ۴ در می‌آیند و عضو نمی‌فهمد چند نفر جلوتر است.
   */
  private async compactQueue(tx: Prisma.TransactionClient, bookId: string): Promise<void> {
    const active = await tx.reservation.findMany({
      where: { bookId, status: { in: ['PENDING', 'READY'] } },
      orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }, { reservedAt: 'asc' }],
      select: { id: true, queuePosition: true },
    });
    for (const [index, r] of active.entries()) {
      const position = index + 1;
      if (r.queuePosition !== position) {
        await tx.reservation.update({ where: { id: r.id }, data: { queuePosition: position } });
      }
    }
  }
}
