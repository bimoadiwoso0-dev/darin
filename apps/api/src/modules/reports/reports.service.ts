import { Injectable } from '@nestjs/common';
import { buildPageMeta, normalizePageQuery, type Paginated } from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface ReportQuery {
  page?: number;
  pageSize?: number;
  from?: Date;
  to?: Date;
  locationId?: string;
  categoryId?: string;
  memberId?: string;
  /** برای خروجی گرفتن: بدون صفحه‌بندی، تا سقف امن */
  unpaged?: boolean;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: 'collection' | 'circulation' | 'members' | 'finance' | 'operations';
  /** ستون‌های خروجی — هم برای جدول UI و هم برای Excel/CSV */
  columns: Array<{ key: string; label: string; type?: 'number' | 'date' | 'money' | 'text' }>;
}

/**
 * گزارش‌ها (قانون ۳۸).
 *
 * ── چرا فهرست گزارش‌ها داده است، نه کد ────────────────────────────────────
 * هر گزارش یک `ReportDefinition` دارد که ستون‌ها و برچسب‌هایشان را توصیف
 * می‌کند. همین تعریف، هم جدول UI را می‌سازد، هم سرستون فایل Excel را، و هم
 * فهرست گزارش‌های در دسترس را. افزودن گزارش جدید = یک تعریف + یک متد،
 * بدون دست زدن به UI یا کد خروجی (قانون ۱۰۴).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  static readonly DEFINITIONS: ReportDefinition[] = [
    {
      key: 'available-books',
      title: 'کتاب‌های موجود',
      description: 'نسخه‌هایی که هم‌اکنون روی قفسه و قابل امانت‌اند',
      group: 'collection',
      columns: [
        { key: 'accessionNumber', label: 'شماره ثبت' },
        { key: 'barcode', label: 'بارکد' },
        { key: 'title', label: 'عنوان' },
        { key: 'authors', label: 'پدیدآورندگان' },
        { key: 'publisher', label: 'ناشر' },
        { key: 'locationCode', label: 'محل قرارگیری' },
        { key: 'condition', label: 'وضعیت ظاهری' },
      ],
    },
    {
      key: 'loaned-books',
      title: 'کتاب‌های امانت داده شده',
      description: 'نسخه‌هایی که در حال حاضر نزد اعضا هستند',
      group: 'circulation',
      columns: [
        { key: 'loanNumber', label: 'شماره امانت' },
        { key: 'title', label: 'عنوان' },
        { key: 'barcode', label: 'بارکد' },
        { key: 'memberCode', label: 'کد عضویت' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'mobile', label: 'موبایل' },
        { key: 'loanedAt', label: 'تاریخ امانت', type: 'date' },
        { key: 'dueAt', label: 'موعد بازگشت', type: 'date' },
      ],
    },
    {
      key: 'overdue',
      title: 'کتاب‌های دیرکردی',
      description: 'امانت‌هایی که از موعد گذشته و بازگردانده نشده‌اند',
      group: 'circulation',
      columns: [
        { key: 'loanNumber', label: 'شماره امانت' },
        { key: 'title', label: 'عنوان' },
        { key: 'barcode', label: 'بارکد' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'mobile', label: 'موبایل' },
        { key: 'dueAt', label: 'موعد بازگشت', type: 'date' },
        { key: 'overdueDays', label: 'روز دیرکرد', type: 'number' },
        { key: 'estimatedFine', label: 'جریمه تخمینی', type: 'money' },
      ],
    },
    {
      key: 'lost-damaged',
      title: 'کتاب‌های مفقود و آسیب‌دیده',
      description: 'نسخه‌هایی که نیاز به تعیین تکلیف دارند',
      group: 'collection',
      columns: [
        { key: 'accessionNumber', label: 'شماره ثبت' },
        { key: 'title', label: 'عنوان' },
        { key: 'status', label: 'وضعیت' },
        { key: 'locationCode', label: 'آخرین محل' },
        { key: 'purchasePrice', label: 'قیمت خرید', type: 'money' },
        { key: 'updatedAt', label: 'تاریخ تغییر وضعیت', type: 'date' },
      ],
    },
    {
      key: 'debtor-members',
      title: 'اعضای بدهکار',
      description: 'اعضایی که جریمه تسویه‌نشده دارند',
      group: 'finance',
      columns: [
        { key: 'memberCode', label: 'کد عضویت' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'mobile', label: 'موبایل' },
        { key: 'fineCount', label: 'تعداد جریمه', type: 'number' },
        { key: 'outstanding', label: 'مانده بدهی', type: 'money' },
        { key: 'oldestFine', label: 'قدیمی‌ترین جریمه', type: 'date' },
      ],
    },
    {
      key: 'active-members',
      title: 'اعضای فعال',
      description: 'اعضایی که در بازه انتخابی امانت گرفته‌اند',
      group: 'members',
      columns: [
        { key: 'memberCode', label: 'کد عضویت' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'loanCount', label: 'تعداد امانت', type: 'number' },
        { key: 'currentLoans', label: 'امانت جاری', type: 'number' },
        { key: 'lastLoanAt', label: 'آخرین امانت', type: 'date' },
      ],
    },
    {
      key: 'expiring-memberships',
      title: 'عضویت‌های در حال انقضا',
      description: 'اعضایی که اعتبار عضویتشان به‌زودی تمام می‌شود',
      group: 'members',
      columns: [
        { key: 'memberCode', label: 'کد عضویت' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'mobile', label: 'موبایل' },
        { key: 'expiresAt', label: 'تاریخ انقضا', type: 'date' },
        { key: 'daysRemaining', label: 'روز باقیمانده', type: 'number' },
        { key: 'currentLoans', label: 'امانت جاری', type: 'number' },
      ],
    },
    {
      key: 'acquisitions',
      title: 'گزارش ورود کتاب',
      description: 'نسخه‌های اضافه‌شده به مجموعه در بازه انتخابی',
      group: 'collection',
      columns: [
        { key: 'accessionNumber', label: 'شماره ثبت' },
        { key: 'title', label: 'عنوان' },
        { key: 'source', label: 'نحوه ورود' },
        { key: 'donorName', label: 'اهداکننده' },
        { key: 'purchasePrice', label: 'قیمت', type: 'money' },
        { key: 'createdAt', label: 'تاریخ ثبت', type: 'date' },
      ],
    },
    {
      key: 'shelf-inventory',
      title: 'گزارش قفسه‌ها',
      description: 'تعداد کتاب و میزان اشغال هر قفسه',
      group: 'operations',
      columns: [
        { key: 'fullCode', label: 'کد قفسه' },
        { key: 'name', label: 'نام' },
        { key: 'capacity', label: 'ظرفیت', type: 'number' },
        { key: 'occupied', label: 'اشغال‌شده', type: 'number' },
        { key: 'available', label: 'فضای خالی', type: 'number' },
        { key: 'utilization', label: 'درصد پرشدگی', type: 'number' },
      ],
    },
    {
      key: 'movements',
      title: 'گزارش جابه‌جایی کتاب',
      description: 'تاریخچه انتقال نسخه‌ها بین قفسه‌ها',
      group: 'operations',
      columns: [
        { key: 'accessionNumber', label: 'شماره ثبت' },
        { key: 'title', label: 'عنوان' },
        { key: 'fromCode', label: 'از' },
        { key: 'toCode', label: 'به' },
        { key: 'reason', label: 'علت' },
        { key: 'movedAt', label: 'تاریخ', type: 'date' },
      ],
    },
    {
      key: 'librarian-activity',
      title: 'عملکرد کتابداران',
      description: 'تعداد عملیات هر کاربر در بازه انتخابی',
      group: 'operations',
      columns: [
        { key: 'userLabel', label: 'کاربر' },
        { key: 'checkouts', label: 'امانت', type: 'number' },
        { key: 'returns', label: 'بازگشت', type: 'number' },
        { key: 'catalogEdits', label: 'ویرایش کاتالوگ', type: 'number' },
        { key: 'total', label: 'مجموع', type: 'number' },
      ],
    },
    {
      key: 'fines-collected',
      title: 'جریمه‌های دریافتی',
      description: 'پرداخت‌های ثبت‌شده در بازه انتخابی',
      group: 'finance',
      columns: [
        { key: 'paidAt', label: 'تاریخ پرداخت', type: 'date' },
        { key: 'memberName', label: 'نام عضو' },
        { key: 'reason', label: 'بابت' },
        { key: 'amount', label: 'مبلغ', type: 'money' },
        { key: 'method', label: 'روش پرداخت' },
        { key: 'receivedBy', label: 'دریافت‌کننده' },
      ],
    },
  ];

  listDefinitions(): ReportDefinition[] {
    return ReportsService.DEFINITIONS;
  }

  getDefinition(key: string): ReportDefinition {
    const def = ReportsService.DEFINITIONS.find((d) => d.key === key);
    if (!def) throw DomainError.notFound(`گزارش «${key}»`);
    return def;
  }

  /** اجرای یک گزارش بر اساس کلید. */
  async run(key: string, query: ReportQuery): Promise<Paginated<Record<string, unknown>>> {
    const def = this.getDefinition(key);
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    // برای خروجی گرفتن، سقف امن ۵۰٬۰۰۰ ردیف در یک درخواست
    const limit = query.unpaged ? 50_000 : take;
    const offset = query.unpaged ? 0 : skip;

    const { rows, total } = await this.execute(def.key, query, limit, offset);
    return { data: rows, meta: buildPageMeta(page, query.unpaged ? total || 1 : pageSize, total) };
  }

  private async execute(
    key: string,
    q: ReportQuery,
    limit: number,
    offset: number,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    switch (key) {
      case 'available-books': return this.availableBooks(q, limit, offset);
      case 'loaned-books': return this.loanedBooks(q, limit, offset);
      case 'overdue': return this.overdue(q, limit, offset);
      case 'lost-damaged': return this.lostDamaged(q, limit, offset);
      case 'debtor-members': return this.debtorMembers(q, limit, offset);
      case 'active-members': return this.activeMembers(q, limit, offset);
      case 'expiring-memberships': return this.expiringMemberships(q, limit, offset);
      case 'acquisitions': return this.acquisitions(q, limit, offset);
      case 'shelf-inventory': return this.shelfInventory(q, limit, offset);
      case 'movements': return this.movements(q, limit, offset);
      case 'librarian-activity': return this.librarianActivity(q, limit, offset);
      case 'fines-collected': return this.finesCollected(q, limit, offset);
      default: throw DomainError.notFound(`گزارش «${key}»`);
    }
  }

  // ── پیاده‌سازی گزارش‌ها ────────────────────────────────────────────────

  private async availableBooks(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.BookCopyWhereInput = { deletedAt: null, status: 'AVAILABLE' };
    if (q.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: q.locationId }, select: { path: true },
      });
      if (loc) where.location = { path: { startsWith: loc.path } };
    }
    if (q.categoryId) {
      where.book = { categories: { some: { categoryId: q.categoryId } } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where, take: limit, skip: offset,
        orderBy: [{ location: { fullCode: 'asc' } }, { accessionNumber: 'asc' }],
        select: {
          accessionNumber: true, barcode: true, condition: true,
          location: { select: { fullCode: true } },
          book: {
            select: {
              title: true,
              publisher: { select: { name: true } },
              contributors: {
                where: { role: { in: ['AUTHOR', 'CO_AUTHOR'] } },
                select: { person: { select: { fullName: true } } },
              },
            },
          },
        },
      }),
      this.prisma.bookCopy.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        accessionNumber: r.accessionNumber,
        barcode: r.barcode,
        title: r.book.title,
        authors: r.book.contributors.map((c) => c.person.fullName).join('، '),
        publisher: r.book.publisher?.name ?? '',
        locationCode: r.location?.fullCode ?? '',
        condition: r.condition,
      })),
      total,
    };
  }

  private async loanedBooks(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.LoanWhereInput = { status: { in: ['ACTIVE', 'OVERDUE'] } };
    if (q.memberId) where.memberId = q.memberId;
    if (q.from || q.to) {
      where.loanedAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }

    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({
        where, take: limit, skip: offset, orderBy: { dueAt: 'asc' },
        select: {
          loanNumber: true, loanedAt: true, dueAt: true,
          member: { select: { memberCode: true, firstName: true, lastName: true, mobile: true } },
          copy: { select: { barcode: true, book: { select: { title: true } } } },
        },
      }),
      this.prisma.loan.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        loanNumber: r.loanNumber,
        title: r.copy.book.title,
        barcode: r.copy.barcode,
        memberCode: r.member.memberCode,
        memberName: `${r.member.firstName} ${r.member.lastName}`,
        mobile: r.member.mobile ?? '',
        loanedAt: r.loanedAt,
        dueAt: r.dueAt,
      })),
      total,
    };
  }

  private async overdue(q: ReportQuery, limit: number, offset: number) {
    // جریمه تخمینی از تنظیمات جاری محاسبه می‌شود، نه از رکورد ذخیره‌شده —
    // چون تا زمان بازگشت، جریمه هنوز قطعی نشده است.
    const rows = await this.prisma.$queryRaw<
      Array<{
        loanNumber: string; title: string; barcode: string; memberName: string;
        mobile: string | null; dueAt: Date; overdueDays: number; estimatedFine: string;
      }>
    >`
      SELECT l."loanNumber", b."title", c."barcode",
             m."firstName" || ' ' || m."lastName" AS "memberName",
             m."mobile", l."dueAt",
             GREATEST(0, (CURRENT_DATE - l."dueAt"::date))::int AS "overdueDays",
             (GREATEST(0, (CURRENT_DATE - l."dueAt"::date))
               * coalesce((SELECT (value #>> '{}')::numeric FROM settings
                            WHERE key = 'fine.dailyAmount'), 0))::text AS "estimatedFine"
        FROM loans l
        JOIN book_copies c ON c."id" = l."copyId"
        JOIN books b ON b."id" = c."bookId"
        JOIN members m ON m."id" = l."memberId"
       WHERE l."status" = 'OVERDUE'
         ${q.memberId ? Prisma.sql`AND l."memberId" = ${q.memberId}::uuid` : Prisma.empty}
       ORDER BY "overdueDays" DESC
       LIMIT ${limit} OFFSET ${offset}
    `;
    const total = await this.prisma.loan.count({
      where: { status: 'OVERDUE', ...(q.memberId ? { memberId: q.memberId } : {}) },
    });
    return {
      rows: rows.map((r) => ({ ...r, estimatedFine: Number(r.estimatedFine) })),
      total,
    };
  }

  private async lostDamaged(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.BookCopyWhereInput = {
      deletedAt: null,
      status: { in: ['LOST', 'DAMAGED', 'IN_REPAIR'] },
    };
    // فیلتر مکان: «کدام کتاب‌های بخش ادبیات آسیب دیده‌اند؟»
    if (q.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: q.locationId }, select: { path: true },
      });
      if (loc) where.location = { path: { startsWith: loc.path } };
    }
    if (q.from || q.to) {
      where.updatedAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where, take: limit, skip: offset, orderBy: { updatedAt: 'desc' },
        select: {
          accessionNumber: true, status: true, purchasePrice: true, updatedAt: true,
          location: { select: { fullCode: true } },
          book: { select: { title: true } },
        },
      }),
      this.prisma.bookCopy.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        accessionNumber: r.accessionNumber,
        title: r.book.title,
        status: r.status,
        locationCode: r.location?.fullCode ?? '',
        purchasePrice: r.purchasePrice ? Number(r.purchasePrice) : 0,
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  private async debtorMembers(_q: ReportQuery, limit: number, offset: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        memberCode: string; memberName: string; mobile: string | null;
        fineCount: bigint; outstanding: string; oldestFine: Date;
      }>
    >`
      SELECT m."memberCode",
             m."firstName" || ' ' || m."lastName" AS "memberName",
             m."mobile",
             count(f."id")::bigint AS "fineCount",
             sum(f."amount" - f."paidAmount")::text AS outstanding,
             min(f."issuedAt") AS "oldestFine"
        FROM fines f
        JOIN members m ON m."id" = f."memberId"
       WHERE f."status" IN ('UNPAID','PARTIALLY_PAID') AND m."deletedAt" IS NULL
       GROUP BY m."id", m."memberCode", m."firstName", m."lastName", m."mobile"
       ORDER BY sum(f."amount" - f."paidAmount") DESC
       LIMIT ${limit} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(DISTINCT f."memberId")::bigint AS total FROM fines f
       WHERE f."status" IN ('UNPAID','PARTIALLY_PAID')
    `;
    return {
      rows: rows.map((r) => ({
        ...r,
        fineCount: Number(r.fineCount),
        outstanding: Number(r.outstanding),
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  private async activeMembers(q: ReportQuery, limit: number, offset: number) {
    const from = q.from ?? new Date(Date.now() - 90 * 86_400_000);
    const to = q.to ?? new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        memberCode: string; memberName: string; loanCount: bigint;
        currentLoans: bigint; lastLoanAt: Date;
      }>
    >`
      SELECT m."memberCode",
             m."firstName" || ' ' || m."lastName" AS "memberName",
             count(l."id")::bigint AS "loanCount",
             count(l."id") FILTER (WHERE l."status" IN ('ACTIVE','OVERDUE'))::bigint AS "currentLoans",
             max(l."loanedAt") AS "lastLoanAt"
        FROM loans l
        JOIN members m ON m."id" = l."memberId"
       WHERE l."loanedAt" BETWEEN ${from} AND ${to} AND m."deletedAt" IS NULL
       GROUP BY m."id", m."memberCode", m."firstName", m."lastName"
       ORDER BY "loanCount" DESC
       LIMIT ${limit} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(DISTINCT l."memberId")::bigint AS total
        FROM loans l WHERE l."loanedAt" BETWEEN ${from} AND ${to}
    `;
    return {
      rows: rows.map((r) => ({
        ...r, loanCount: Number(r.loanCount), currentLoans: Number(r.currentLoans),
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  private async expiringMemberships(q: ReportQuery, limit: number, offset: number) {
    const until = q.to ?? new Date(Date.now() + 60 * 86_400_000);
    const where: Prisma.MemberWhereInput = {
      deletedAt: null,
      status: { in: ['ACTIVE', 'EXPIRED'] },
      expiresAt: { lte: until },
    };
    const [rows, total] = await Promise.all([
      this.prisma.member.findMany({
        where, take: limit, skip: offset, orderBy: { expiresAt: 'asc' },
        select: {
          memberCode: true, firstName: true, lastName: true, mobile: true, expiresAt: true,
          _count: { select: { loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } } } } },
        },
      }),
      this.prisma.member.count({ where }),
    ]);
    const now = Date.now();
    return {
      rows: rows.map((r) => ({
        memberCode: r.memberCode,
        memberName: `${r.firstName} ${r.lastName}`,
        mobile: r.mobile ?? '',
        expiresAt: r.expiresAt,
        daysRemaining: r.expiresAt
          ? Math.ceil((r.expiresAt.getTime() - now) / 86_400_000)
          : null,
        currentLoans: r._count.loans,
      })),
      total,
    };
  }

  private async acquisitions(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.BookCopyWhereInput = { deletedAt: null };
    if (q.from || q.to) {
      where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        select: {
          accessionNumber: true, acquisitionSource: true, purchasePrice: true, createdAt: true,
          donor: { select: { fullName: true } },
          book: { select: { title: true } },
        },
      }),
      this.prisma.bookCopy.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        accessionNumber: r.accessionNumber,
        title: r.book.title,
        source: r.acquisitionSource,
        donorName: r.donor?.fullName ?? '',
        purchasePrice: r.purchasePrice ? Number(r.purchasePrice) : 0,
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  private async shelfInventory(q: ReportQuery, limit: number, offset: number) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        fullCode: string; name: string; capacity: number | null; occupied: bigint;
      }>
    >`
      SELECT l."fullCode", l."name", l."capacity",
             coalesce(count(c."id"), 0) AS occupied
        FROM locations l
        LEFT JOIN locations d ON d."path" LIKE l."path" || '%' AND d."deletedAt" IS NULL
        LEFT JOIN book_copies c ON c."locationId" = d."id" AND c."deletedAt" IS NULL
       WHERE l."deletedAt" IS NULL AND l."kind" IN ('SHELF','SHELF_LEVEL')
         ${q.locationId ? Prisma.sql`AND l."path" LIKE (SELECT "path" || '%' FROM locations WHERE "id" = ${q.locationId}::uuid)` : Prisma.empty}
       GROUP BY l."id", l."fullCode", l."name", l."capacity"
       ORDER BY l."fullCode"
       LIMIT ${limit} OFFSET ${offset}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM locations
       WHERE "deletedAt" IS NULL AND "kind" IN ('SHELF','SHELF_LEVEL')
    `;
    return {
      rows: rows.map((r) => {
        const occupied = Number(r.occupied);
        return {
          fullCode: r.fullCode,
          name: r.name,
          capacity: r.capacity ?? 0,
          occupied,
          available: r.capacity === null ? 0 : Math.max(0, r.capacity - occupied),
          utilization: r.capacity ? Math.round((occupied / r.capacity) * 100) : 0,
        };
      }),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  private async movements(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.BookMovementWhereInput = {};
    if (q.from || q.to) {
      where.movedAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.bookMovement.findMany({
        where, take: limit, skip: offset, orderBy: { movedAt: 'desc' },
        select: {
          reason: true, movedAt: true,
          fromLocation: { select: { fullCode: true } },
          toLocation: { select: { fullCode: true } },
          copy: {
            select: { accessionNumber: true, book: { select: { title: true } } },
          },
        },
      }),
      this.prisma.bookMovement.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        accessionNumber: r.copy.accessionNumber,
        title: r.copy.book.title,
        fromCode: r.fromLocation?.fullCode ?? '—',
        toCode: r.toLocation?.fullCode ?? '—',
        reason: r.reason ?? '',
        movedAt: r.movedAt,
      })),
      total,
    };
  }

  private async librarianActivity(q: ReportQuery, limit: number, offset: number) {
    const from = q.from ?? new Date(Date.now() - 30 * 86_400_000);
    const to = q.to ?? new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        userLabel: string; checkouts: bigint; returns: bigint;
        catalogEdits: bigint; total: bigint;
      }>
    >`
      SELECT coalesce("userLabel", 'سیستم') AS "userLabel",
             count(*) FILTER (WHERE action = 'checkout')::bigint AS checkouts,
             count(*) FILTER (WHERE action = 'return')::bigint AS returns,
             count(*) FILTER (WHERE action IN ('create','update','create_copies'))::bigint AS "catalogEdits",
             count(*)::bigint AS total
        FROM audit_logs
       WHERE "createdAt" BETWEEN ${from} AND ${to}
       GROUP BY "userLabel"
       ORDER BY total DESC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return {
      rows: rows.map((r) => ({
        userLabel: r.userLabel,
        checkouts: Number(r.checkouts),
        returns: Number(r.returns),
        catalogEdits: Number(r.catalogEdits),
        total: Number(r.total),
      })),
      total: rows.length,
    };
  }

  private async finesCollected(q: ReportQuery, limit: number, offset: number) {
    const where: Prisma.PaymentWhereInput = {};
    if (q.from || q.to) {
      where.paidAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    const [rows, total, sum] = await Promise.all([
      this.prisma.payment.findMany({
        where, take: limit, skip: offset, orderBy: { paidAt: 'desc' },
        select: {
          amount: true, method: true, paidAt: true,
          fine: {
            select: {
              reason: true,
              member: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      rows: rows.map((r) => ({
        paidAt: r.paidAt,
        memberName: `${r.fine.member.firstName} ${r.fine.member.lastName}`,
        reason: r.fine.reason,
        amount: Number(r.amount),
        method: r.method,
        receivedBy: '',
        _totalCollected: Number(sum._sum.amount ?? 0),
      })),
      total,
    };
  }
}
