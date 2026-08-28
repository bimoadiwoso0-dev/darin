import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  SETTING_KEYS,
  buildPageMeta,
  normalizeDigits,
  normalizePageQuery,
  persianNormalize,
  type MemberStatus,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface MemberInput {
  memberCode?: string;
  firstName: string;
  lastName: string;
  nationalId?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  postalCode?: string | null;
  birthDate?: Date | null;
  gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
  photoId?: string | null;
  membershipTypeId?: string | null;
  status?: MemberStatus;
  expiresAt?: Date | null;
  referrerName?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  note?: string | null;
}

export interface MemberListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: MemberStatus[];
  membershipTypeId?: string;
  /** فقط اعضایی که کتاب دیرکرددار دارند */
  hasOverdue?: boolean;
  /** فقط اعضایی که جریمه پرداخت‌نشده دارند */
  hasUnpaidFines?: boolean;
  /** عضویت‌هایی که تا N روز آینده منقضی می‌شوند */
  expiringWithinDays?: number;
  sort?: 'name' | 'memberCode' | 'joinedAt' | 'expiresAt';
  order?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
  ) {}

  // ── خواندن ─────────────────────────────────────────────────────────────

  async list(query: MemberListQuery): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(query),
        select: {
          id: true, memberCode: true, firstName: true, lastName: true, mobile: true,
          email: true, status: true, joinedAt: true, expiresAt: true, photoId: true,
          membershipType: { select: { id: true, name: true } },
          _count: { select: { loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } } } } },
        },
      }),
      this.prisma.member.count({ where }),
    ]);

    // بدهی و دیرکرد هر عضو با دو کوئری گروهی — نه دو کوئری به‌ازای هر ردیف
    const ids = rows.map((r) => r.id);
    const [overdue, debts] = await Promise.all([
      this.overdueCounts(ids),
      this.outstandingDebts(ids),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        fullName: `${r.firstName} ${r.lastName}`,
        activeLoans: r._count.loans,
        overdueLoans: overdue.get(r.id) ?? 0,
        outstandingDebt: debts.get(r.id) ?? 0,
        _count: undefined,
      })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  /** پروفایل کامل عضو (قانون ۱۵). */
  async findOne(id: string) {
    const member = await this.prisma.member.findFirst({
      where: { id },
      include: {
        membershipType: true,
        branch: { select: { id: true, name: true } },
      },
    });
    if (!member) throw DomainError.notFound('عضو');

    const [currentLoans, history, reservations, fines, stats] = await Promise.all([
      this.prisma.loan.findMany({
        where: { memberId: id, status: { in: ['ACTIVE', 'OVERDUE'] } },
        orderBy: { dueAt: 'asc' },
        select: {
          id: true, loanNumber: true, loanedAt: true, dueAt: true, status: true, renewalCount: true,
          copy: {
            select: {
              id: true, barcode: true, accessionNumber: true,
              book: { select: { id: true, title: true, volumeTitle: true, coverImageId: true } },
              location: { select: { fullCode: true } },
            },
          },
        },
      }),
      this.prisma.loan.findMany({
        where: { memberId: id, status: 'RETURNED' },
        orderBy: { returnedAt: 'desc' },
        take: 30,
        select: {
          id: true, loanNumber: true, loanedAt: true, dueAt: true, returnedAt: true,
          copy: { select: { book: { select: { id: true, title: true } } } },
        },
      }),
      this.prisma.reservation.findMany({
        where: { memberId: id, status: { in: ['PENDING', 'READY'] } },
        orderBy: { reservedAt: 'asc' },
        select: {
          id: true, status: true, queuePosition: true, reservedAt: true, expiresAt: true,
          book: { select: { id: true, title: true } },
        },
      }),
      this.prisma.fine.findMany({
        where: { memberId: id },
        orderBy: { issuedAt: 'desc' },
        take: 40,
        select: {
          id: true, type: true, status: true, amount: true, paidAmount: true,
          reason: true, issuedAt: true, overdueDays: true,
        },
      }),
      this.memberStats(id),
    ]);

    const outstandingDebt = fines
      .filter((f) => f.status === 'UNPAID' || f.status === 'PARTIALLY_PAID')
      .reduce((sum, f) => sum + (Number(f.amount) - Number(f.paidAmount)), 0);

    return {
      ...member,
      fullName: `${member.firstName} ${member.lastName}`,
      currentLoans,
      loanHistory: history,
      reservations,
      fines,
      outstandingDebt,
      stats,
      /** قوانین مؤثر برای این عضو — نوع عضویت بر تنظیمات عمومی اولویت دارد */
      effectivePolicy: this.effectivePolicy(member.membershipType),
    };
  }

  /** جستجوی سریع عضو — میز امانت با کد عضویت، نام یا موبایل جستجو می‌کند. */
  async quickSearch(query: string, limit = 10) {
    const raw = query.trim();
    if (!raw) return [];

    const normalized = persianNormalize(raw);
    const digits = normalizeDigits(raw).replace(/\D/g, '');

    const members = await this.prisma.member.findMany({
      where: {
        deletedAt: null,
        OR: [
          { memberCode: { equals: raw, mode: 'insensitive' } },
          ...(normalized ? [{ nameNormalized: { contains: normalized } }] : []),
          ...(digits.length >= 4
            ? [
                { mobile: { contains: digits } },
                { phone: { contains: digits } },
                { nationalId: { contains: digits } },
              ]
            : []),
        ],
      },
      take: limit,
      select: {
        id: true, memberCode: true, firstName: true, lastName: true, mobile: true,
        status: true, expiresAt: true, photoId: true,
        _count: { select: { loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } } } } },
      },
      orderBy: { nameNormalized: 'asc' },
    });

    return members.map((m) => ({
      ...m,
      fullName: `${m.firstName} ${m.lastName}`,
      activeLoans: m._count.loans,
      _count: undefined,
    }));
  }

  /** یافتن عضو با توکن QR کارت عضویت. */
  async findByQrToken(qrToken: string) {
    const member = await this.prisma.member.findFirst({
      where: { qrToken, deletedAt: null },
      select: { id: true },
    });
    if (!member) throw DomainError.notFound('عضو');
    return this.findOne(member.id);
  }

  // ── نوشتن ──────────────────────────────────────────────────────────────

  async create(input: MemberInput, user: AuthenticatedUser, ip?: string) {
    const nationalId = input.nationalId ? normalizeDigits(input.nationalId).trim() : null;
    if (nationalId && !isValidIranianNationalId(nationalId)) {
      throw DomainError.validation({ nationalId: ['کد ملی واردشده معتبر نیست.'] });
    }

    if (nationalId) {
      const clash = await this.prisma.member.findFirst({
        where: { nationalId, deletedAt: null },
        select: { id: true, memberCode: true, firstName: true, lastName: true },
      });
      if (clash) {
        throw new DomainError(
          ERROR_CODES.DUPLICATE_NATIONAL_ID,
          `عضو دیگری با همین کد ملی ثبت شده است: ${clash.firstName} ${clash.lastName} (${clash.memberCode})`,
          { memberId: clash.id },
        );
      }
    }

    const branchId = user.branchId ?? (await this.defaultBranchId());
    const membershipTypeId = input.membershipTypeId ?? (await this.defaultMembershipTypeId());
    const expiresAt = input.expiresAt ?? (await this.computeExpiry(membershipTypeId));

    const member = await this.prisma.$transaction(async (tx) => {
      // کد عضویت دستی مقدم است (کتابخانه ممکن است کدگذاری خودش را داشته باشد)
      const memberCode = input.memberCode?.trim()
        ? input.memberCode.trim()
        : await this.numbering.next(tx, 'member_code');

      return tx.member.create({
        data: {
          branchId,
          memberCode,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          nationalId,
          phone: input.phone ? normalizeDigits(input.phone).trim() : null,
          mobile: input.mobile ? normalizeDigits(input.mobile).trim() : null,
          email: input.email?.trim() || null,
          address: input.address ?? null,
          postalCode: input.postalCode ? normalizeDigits(input.postalCode).trim() : null,
          birthDate: input.birthDate ?? null,
          gender: input.gender ?? 'UNSPECIFIED',
          photoId: input.photoId ?? null,
          membershipTypeId,
          status: input.status ?? 'ACTIVE',
          expiresAt,
          referrerName: input.referrerName ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          note: input.note ?? null,
          createdById: user.sub,
        },
      });
    });

    await this.audit.record({
      action: 'create',
      entityType: 'Member',
      entityId: member.id,
      entityLabel: `${member.firstName} ${member.lastName} (${member.memberCode})`,
      newData: { memberCode: member.memberCode, status: member.status },
      user,
      ip,
    });

    return this.findOne(member.id);
  }

  async update(id: string, input: Partial<MemberInput>, user: AuthenticatedUser, ip?: string) {
    const before = await this.prisma.member.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw DomainError.notFound('عضو');

    let nationalId: string | null | undefined;
    if (input.nationalId !== undefined) {
      nationalId = input.nationalId ? normalizeDigits(input.nationalId).trim() : null;
      if (nationalId && !isValidIranianNationalId(nationalId)) {
        throw DomainError.validation({ nationalId: ['کد ملی واردشده معتبر نیست.'] });
      }
      if (nationalId) {
        const clash = await this.prisma.member.findFirst({
          where: { nationalId, id: { not: id }, deletedAt: null },
          select: { memberCode: true },
        });
        if (clash) {
          throw new DomainError(
            ERROR_CODES.DUPLICATE_NATIONAL_ID,
            `عضو دیگری با کد عضویت ${clash.memberCode} همین کد ملی را دارد.`,
          );
        }
      }
    }

    const updated = await this.prisma.member.update({
      where: { id },
      data: {
        memberCode: input.memberCode?.trim(),
        firstName: input.firstName?.trim(),
        lastName: input.lastName?.trim(),
        ...(nationalId !== undefined ? { nationalId } : {}),
        phone: input.phone === undefined ? undefined : input.phone ? normalizeDigits(input.phone).trim() : null,
        mobile: input.mobile === undefined ? undefined : input.mobile ? normalizeDigits(input.mobile).trim() : null,
        email: input.email === undefined ? undefined : input.email?.trim() || null,
        address: input.address === undefined ? undefined : input.address,
        postalCode: input.postalCode === undefined ? undefined : input.postalCode,
        birthDate: input.birthDate === undefined ? undefined : input.birthDate,
        gender: input.gender,
        photoId: input.photoId === undefined ? undefined : input.photoId,
        membershipTypeId: input.membershipTypeId === undefined ? undefined : input.membershipTypeId,
        status: input.status,
        expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt,
        referrerName: input.referrerName === undefined ? undefined : input.referrerName,
        emergencyContactName: input.emergencyContactName === undefined ? undefined : input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone === undefined ? undefined : input.emergencyContactPhone,
        note: input.note === undefined ? undefined : input.note,
      },
    });

    await this.audit.recordUpdate({
      entityType: 'Member',
      entityId: id,
      entityLabel: `${before.firstName} ${before.lastName} (${before.memberCode})`,
      before: before,
      after: input,
      user,
      ip,
    });

    return this.findOne(updated.id);
  }

  /** تمدید عضویت. */
  async renewMembership(id: string, months: number | undefined, user: AuthenticatedUser, ip?: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, deletedAt: null },
      include: { membershipType: true },
    });
    if (!member) throw DomainError.notFound('عضو');

    const days = months
      ? months * 30
      : (member.membershipType?.durationDays ??
         this.settings.get(SETTING_KEYS.MEMBERSHIP_DURATION_DAYS));

    // اگر عضویت هنوز اعتبار دارد، از تاریخ انقضای فعلی ادامه می‌دهیم تا
    // روزهای باقیمانده عضو از بین نرود.
    const base =
      member.expiresAt && member.expiresAt > new Date() ? member.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + days * 86_400_000);

    const updated = await this.prisma.member.update({
      where: { id },
      data: {
        expiresAt,
        status: member.status === 'EXPIRED' ? 'ACTIVE' : member.status,
      },
    });

    await this.audit.record({
      action: 'renew_membership',
      entityType: 'Member',
      entityId: id,
      entityLabel: `${member.firstName} ${member.lastName} (${member.memberCode})`,
      oldData: { expiresAt: member.expiresAt },
      newData: { expiresAt, days },
      user,
      ip,
    });

    return updated;
  }

  /**
   * حذف نرم عضو.
   * عضوی که کتاب امانت‌گرفته یا بدهی دارد حذف نمی‌شود — سابقه مالی و امانت
   * باید حفظ شود (قانون ۳۵).
   */
  async remove(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const member = await this.prisma.member.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, memberCode: true,
        _count: {
          select: {
            loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } } },
            fines: { where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } },
          },
        },
      },
    });
    if (!member) throw DomainError.notFound('عضو');

    if (member._count.loans > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `این عضو ${member._count.loans} کتاب امانت‌گرفته دارد. ابتدا کتاب‌ها باید بازگردانده شوند.`,
      );
    }
    if (member._count.fines > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `این عضو ${member._count.fines} جریمه تسویه‌نشده دارد. ابتدا جریمه‌ها را تسویه یا بخشش کنید.`,
      );
    }

    await this.prisma.member.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' },
    });

    await this.audit.record({
      action: 'delete',
      entityType: 'Member',
      entityId: id,
      entityLabel: `${member.firstName} ${member.lastName} (${member.memberCode})`,
      user,
      ip,
    });
  }

  /** اطلاعات کارت عضویت (قانون ۱۶). */
  async cardData(id: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, memberCode: true, firstName: true, lastName: true, photoId: true,
        qrToken: true, joinedAt: true, expiresAt: true, status: true,
        membershipType: { select: { name: true } },
      },
    });
    if (!member) throw DomainError.notFound('عضو');

    return {
      ...member,
      fullName: `${member.firstName} ${member.lastName}`,
      libraryName: this.settings.get(SETTING_KEYS.LIBRARY_NAME),
      /** محتوای بارکد کارت — کد عضویت است تا با بارکدخوان قابل اسکن باشد */
      barcodeValue: member.memberCode,
      /** محتوای QR — توکن امن، نه شناسه داخلی */
      qrValue: member.qrToken,
    };
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  private async memberStats(memberId: string) {
    const [totalLoans, returnedOnTime, totalFines, topCategories] = await Promise.all([
      this.prisma.loan.count({ where: { memberId } }),
      this.prisma.loan.count({
        where: { memberId, status: 'RETURNED', returnedAt: { not: null } },
      }),
      this.prisma.fine.aggregate({ where: { memberId }, _sum: { amount: true } }),
      // موضوعات محبوب این عضو — پایه پیشنهاد کتاب
      this.prisma.$queryRaw<Array<{ name: string; count: bigint }>>`
        SELECT cat."name", count(*)::bigint AS count
          FROM loans l
          JOIN book_copies bc ON bc."id" = l."copyId"
          JOIN book_categories bcat ON bcat."bookId" = bc."bookId"
          JOIN categories cat ON cat."id" = bcat."categoryId"
         WHERE l."memberId" = ${memberId}::uuid
         GROUP BY cat."name"
         ORDER BY count DESC
         LIMIT 5
      `,
    ]);

    return {
      totalLoans,
      returnedCount: returnedOnTime,
      totalFinesAmount: Number(totalFines._sum.amount ?? 0),
      favoriteCategories: topCategories.map((c) => ({ name: c.name, count: Number(c.count) })),
    };
  }

  /** قوانین مؤثر: نوع عضویت اگر مقدار داشته باشد، وگرنه تنظیمات عمومی. */
  private effectivePolicy(type: {
    maxLoans: number | null;
    loanDays: number | null;
    maxRenewals: number | null;
    maxReservations: number | null;
    dailyFineAmount: Prisma.Decimal | null;
    canReserve: boolean;
  } | null) {
    return {
      maxLoans: type?.maxLoans ?? this.settings.get(SETTING_KEYS.LOAN_MAX_ITEMS),
      loanDays: type?.loanDays ?? this.settings.get(SETTING_KEYS.LOAN_PERIOD_DAYS),
      maxRenewals: type?.maxRenewals ?? this.settings.get(SETTING_KEYS.LOAN_MAX_RENEWALS),
      maxReservations:
        type?.maxReservations ?? this.settings.get(SETTING_KEYS.RESERVATION_MAX_PER_MEMBER),
      dailyFineAmount:
        type?.dailyFineAmount !== null && type?.dailyFineAmount !== undefined
          ? Number(type.dailyFineAmount)
          : this.settings.get(SETTING_KEYS.FINE_DAILY_AMOUNT),
      canReserve: type?.canReserve ?? true,
    };
  }

  private async overdueCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.loan.groupBy({
      by: ['memberId'],
      where: { memberId: { in: ids }, status: 'OVERDUE' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.memberId, r._count._all]));
  }

  private async outstandingDebts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ memberId: string; debt: string }>>`
      SELECT "memberId", sum("amount" - "paidAmount")::text AS debt
        FROM fines
       WHERE "memberId" = ANY(${ids}::uuid[])
         AND "status" IN ('UNPAID', 'PARTIALLY_PAID')
       GROUP BY "memberId"
    `;
    return new Map(rows.map((r) => [r.memberId, Number(r.debt)]));
  }

  private buildWhere(query: MemberListQuery): Prisma.MemberWhereInput {
    const where: Prisma.MemberWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.status?.length) where.status = { in: query.status };
    if (query.membershipTypeId) where.membershipTypeId = query.membershipTypeId;
    if (query.hasOverdue) where.loans = { some: { status: 'OVERDUE' } };
    if (query.hasUnpaidFines) {
      where.fines = { some: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } };
    }
    if (query.expiringWithinDays !== undefined) {
      where.expiresAt = {
        gte: new Date(),
        lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000),
      };
    }
    if (query.q) {
      const normalized = persianNormalize(query.q);
      const digits = normalizeDigits(query.q).replace(/\D/g, '');
      where.OR = [
        ...(normalized ? [{ nameNormalized: { contains: normalized } }] : []),
        { memberCode: { contains: query.q, mode: 'insensitive' as const } },
        ...(digits.length >= 4
          ? [{ mobile: { contains: digits } }, { nationalId: { contains: digits } }]
          : []),
      ];
    }
    return where;
  }

  private buildOrderBy(query: MemberListQuery): Prisma.MemberOrderByWithRelationInput[] {
    const dir = query.order ?? 'asc';
    switch (query.sort) {
      case 'memberCode': return [{ memberCode: dir }];
      case 'joinedAt': return [{ joinedAt: query.order ?? 'desc' }];
      case 'expiresAt': return [{ expiresAt: dir }];
      default: return [{ nameNormalized: dir }];
    }
  }

  private async computeExpiry(membershipTypeId: string | null): Promise<Date> {
    let days = this.settings.get(SETTING_KEYS.MEMBERSHIP_DURATION_DAYS);
    if (membershipTypeId) {
      const type = await this.prisma.membershipType.findUnique({
        where: { id: membershipTypeId },
        select: { durationDays: true },
      });
      if (type?.durationDays) days = type.durationDays;
    }
    return new Date(Date.now() + days * 86_400_000);
  }

  private async defaultMembershipTypeId(): Promise<string | null> {
    const type = await this.prisma.membershipType.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return type?.id ?? null;
  }

  private async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!branch) throw new DomainError(ERROR_CODES.SETUP_REQUIRED, 'شعبه پیش‌فرض تعریف نشده است.');
    return branch.id;
  }
}

/**
 * اعتبارسنجی کد ملی ایرانی با الگوریتم رقم کنترل.
 *
 * چرا مهم است: کد ملی کلید یکتای شناسایی عضو است. اگر کد نامعتبر ثبت شود،
 * بعداً هنگام ثبت عضو واقعی با آن کد، تعارض ایجاد می‌شود.
 */
export function isValidIranianNationalId(value: string): boolean {
  const id = normalizeDigits(value).replace(/\D/g, '');
  if (!/^\d{10}$/.test(id)) return false;

  // کدهایی مثل 1111111111 از نظر ریاضی معتبرند اما واقعی نیستند
  if (/^(\d)\1{9}$/.test(id)) return false;

  const check = Number(id[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(id[i]) * (10 - i);
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}
