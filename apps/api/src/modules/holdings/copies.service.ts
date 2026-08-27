import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  buildPageMeta,
  normalizeDigits,
  normalizePageQuery,
  type CopyStatus,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface CreateCopiesInput {
  bookId: string;
  /** چند نسخه ساخته شود */
  count: number;
  locationId?: string | null;
  positionCode?: string | null;
  /**
   * شماره‌های دستی (قانون ۸). اگر خالی باشد، سیستم تولید می‌کند.
   * طول آرایه باید با `count` برابر باشد.
   */
  accessionNumbers?: string[];
  barcodes?: string[];
  assetNumbers?: string[];
  libraryCodes?: string[];
  condition?: 'NEW' | 'GOOD' | 'FAIR' | 'POOR';
  isLoanable?: boolean;
  isReference?: boolean;
  acquisitionSource?: 'PURCHASE' | 'DONATION' | 'TRANSFER' | 'EXCHANGE' | 'LEGAL_DEPOSIT' | 'INTER_LIBRARY' | 'OTHER';
  acquiredAt?: Date | null;
  donorId?: string | null;
  donorName?: string | null;
  supplier?: string | null;
  purchasePrice?: number | null;
  internalNote?: string | null;
}

export interface CopyListQuery {
  page?: number;
  pageSize?: number;
  bookId?: string;
  locationId?: string;
  /** شامل زیردرخت مکان — «همه نسخه‌های بخش ادبیات» */
  locationSubtree?: boolean;
  status?: CopyStatus[];
  condition?: string;
  acquisitionSource?: string;
  donorId?: string;
  q?: string;
  overdueOnly?: boolean;
  sort?: 'accessionNumber' | 'createdAt' | 'status';
  order?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

/**
 * نسخه‌های فیزیکی — تنها موجودیتی که واقعاً روی قفسه است و امانت داده می‌شود.
 */
@Injectable()
export class CopiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  // ── ثبت نسخه ───────────────────────────────────────────────────────────

  /**
   * ثبت یک یا چند نسخه از یک عنوان.
   *
   * کل عملیات در یک تراکنش است: اگر نسخه هفتم به‌خاطر بارکد تکراری شکست
   * بخورد، هیچ‌کدام از شش نسخه قبلی هم ثبت نمی‌شوند و شماره‌ها هدر نمی‌روند.
   */
  async createMany(input: CreateCopiesInput, user: AuthenticatedUser, ip?: string) {
    if (input.count < 1 || input.count > 500) {
      throw DomainError.validation({ count: ['تعداد نسخه باید بین ۱ تا ۵۰۰ باشد.'] });
    }

    const book = await this.prisma.book.findFirst({
      where: { id: input.bookId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!book) throw DomainError.notFound('کتاب');

    this.assertManualNumbersMatchCount(input);

    const branchId = user.branchId ?? (await this.defaultBranchId());

    if (input.locationId) {
      await this.assertLocationUsable(input.locationId, input.count);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const donorId = await this.resolveDonor(tx, input);

      // شماره نسخه از آخرین نسخه همان کتاب ادامه پیدا می‌کند
      const last = await tx.bookCopy.findFirst({
        where: { bookId: input.bookId },
        orderBy: { copyNumber: 'desc' },
        select: { copyNumber: true },
      });
      const startCopyNumber = (last?.copyNumber ?? 0) + 1;

      // شماره‌های خودکار فقط برای فیلدهایی که کاربر دستی پر نکرده
      const autoAccession = input.accessionNumbers?.length
        ? []
        : await this.numbering.nextBatch(tx, 'accession', input.count);
      const autoBarcodes = input.barcodes?.length
        ? []
        : await this.numbering.nextBatch(tx, 'barcode', input.count);
      const autoLibraryCodes = input.libraryCodes?.length
        ? []
        : await this.numbering.nextBatch(tx, 'library_code', input.count);

      const rows: Prisma.BookCopyCreateManyInput[] = [];
      for (let i = 0; i < input.count; i++) {
        rows.push({
          bookId: input.bookId,
          branchId,
          copyNumber: startCopyNumber + i,
          accessionNumber: (input.accessionNumbers?.[i] ?? autoAccession[i]!).trim(),
          barcode: normalizeDigits(input.barcodes?.[i] ?? autoBarcodes[i]!).trim(),
          libraryCode: (input.libraryCodes?.[i] ?? autoLibraryCodes[i] ?? null)?.trim() ?? null,
          assetNumber: input.assetNumbers?.[i]?.trim() ?? null,
          locationId: input.locationId ?? null,
          positionCode: input.positionCode ?? null,
          condition: input.condition ?? 'GOOD',
          isLoanable: input.isReference ? false : (input.isLoanable ?? true),
          isReference: input.isReference ?? false,
          status: input.isReference ? 'NOT_LOANABLE' : 'AVAILABLE',
          acquisitionSource: input.acquisitionSource ?? 'PURCHASE',
          acquiredAt: input.acquiredAt ?? null,
          donorId,
          supplier: input.supplier ?? null,
          purchasePrice: input.purchasePrice ?? null,
          currentValue: input.purchasePrice ?? null,
          internalNote: input.internalNote ?? null,
          createdById: user.sub,
        });
      }

      await tx.bookCopy.createMany({ data: rows });

      return tx.bookCopy.findMany({
        where: {
          bookId: input.bookId,
          copyNumber: { gte: startCopyNumber, lt: startCopyNumber + input.count },
        },
        orderBy: { copyNumber: 'asc' },
        select: {
          id: true, copyNumber: true, accessionNumber: true, barcode: true,
          libraryCode: true, qrToken: true, status: true,
        },
      });
    });

    await this.audit.record({
      action: 'create_copies',
      entityType: 'BookCopy',
      entityId: created[0]?.id,
      entityLabel: `${input.count} نسخه از «${book.title}»`,
      newData: {
        bookId: input.bookId,
        count: input.count,
        accessionNumbers: created.map((c) => c.accessionNumber),
      },
      user,
      ip,
    });

    return created;
  }

  // ── خواندن ─────────────────────────────────────────────────────────────

  async list(query: CopyListQuery): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where = await this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(query),
        select: {
          id: true, copyNumber: true, accessionNumber: true, barcode: true, libraryCode: true,
          assetNumber: true, status: true, condition: true, isLoanable: true, positionCode: true,
          createdAt: true, deletedAt: true,
          book: {
            select: {
              id: true, title: true, volumeNumber: true, volumeTitle: true, isbn13: true,
              contributors: {
                where: { role: 'AUTHOR' },
                take: 2,
                select: { person: { select: { fullName: true } } },
              },
            },
          },
          location: { select: { id: true, name: true, fullCode: true } },
          // امانت باز — برای نمایش «نزد چه کسی است» و «موعد بازگشت»
          loans: {
            where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
            take: 1,
            select: {
              id: true, dueAt: true, status: true,
              member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
            },
          },
        },
      }),
      this.prisma.bookCopy.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, currentLoan: r.loans[0] ?? null, loans: undefined })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findOne(id: string) {
    const copy = await this.prisma.bookCopy.findFirst({
      where: { id },
      include: {
        book: {
          include: {
            publisher: { select: { id: true, name: true } },
            contributors: {
              orderBy: { position: 'asc' },
              include: { person: { select: { id: true, fullName: true } } },
            },
          },
        },
        location: { select: { id: true, name: true, fullCode: true, path: true, kind: true } },
        donor: { select: { id: true, fullName: true } },
        loans: {
          orderBy: { loanedAt: 'desc' },
          take: 25,
          select: {
            id: true, loanNumber: true, status: true, loanedAt: true, dueAt: true,
            returnedAt: true, renewalCount: true,
            member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
          },
        },
        movements: {
          orderBy: { movedAt: 'desc' },
          take: 25,
          include: {
            fromLocation: { select: { name: true, fullCode: true } },
            toLocation: { select: { name: true, fullCode: true } },
          },
        },
      },
    });
    if (!copy) throw DomainError.notFound('نسخه');
    return copy;
  }

  /** یافتن نسخه با بارکد — پرکاربردترین کوئری در میز امانت. */
  async findByBarcode(barcode: string) {
    const normalized = normalizeDigits(barcode).trim();
    if (!normalized) throw DomainError.notFound('نسخه');

    const copy = await this.prisma.bookCopy.findFirst({
      // جستجو روی چند شناسه: کتابدار ممکن است بارکد، شماره ثبت یا کد کتابخانه
      // را اسکن یا تایپ کند و نباید مجبور باشد بداند کدام است.
      where: {
        deletedAt: null,
        OR: [
          { barcode: normalized },
          { accessionNumber: normalized },
          { libraryCode: normalized },
          { assetNumber: normalized },
        ],
      },
      select: {
        id: true, barcode: true, accessionNumber: true, status: true, isLoanable: true,
        positionCode: true,
        book: { select: { id: true, title: true, volumeTitle: true, volumeNumber: true, coverImageId: true } },
        location: { select: { id: true, name: true, fullCode: true } },
        loans: {
          where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
          take: 1,
          select: {
            id: true, dueAt: true, renewalCount: true, status: true,
            member: { select: { id: true, firstName: true, lastName: true, memberCode: true } },
          },
        },
      },
    });
    if (!copy) {
      throw new DomainError(
        ERROR_CODES.NOT_FOUND,
        `نسخه‌ای با شناسه «${barcode}» یافت نشد. بارکد را دوباره اسکن کنید.`,
      );
    }
    return { ...copy, currentLoan: copy.loans[0] ?? null, loans: undefined };
  }

  /** یافتن با توکن QR (قانون ۸۴) — توکن شناسه داخلی رکورد را افشا نمی‌کند. */
  async findByQrToken(qrToken: string) {
    const copy = await this.prisma.bookCopy.findFirst({
      where: { qrToken, deletedAt: null },
      select: { id: true },
    });
    if (!copy) throw DomainError.notFound('نسخه');
    return this.findOne(copy.id);
  }

  // ── ویرایش ─────────────────────────────────────────────────────────────

  async update(
    id: string,
    input: Partial<{
      accessionNumber: string;
      barcode: string;
      libraryCode: string | null;
      assetNumber: string | null;
      condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR';
      isLoanable: boolean;
      isReference: boolean;
      positionCode: string | null;
      acquisitionSource: string;
      acquiredAt: Date | null;
      donorId: string | null;
      supplier: string | null;
      purchasePrice: number | null;
      currentValue: number | null;
      internalNote: string | null;
    }>,
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const before = await this.prisma.bookCopy.findFirst({
      where: { id, deletedAt: null },
      include: { book: { select: { title: true } } },
    });
    if (!before) throw DomainError.notFound('نسخه');

    const updated = await this.prisma.bookCopy.update({
      where: { id },
      data: {
        accessionNumber: input.accessionNumber?.trim(),
        barcode: input.barcode ? normalizeDigits(input.barcode).trim() : undefined,
        libraryCode: input.libraryCode === undefined ? undefined : input.libraryCode?.trim() || null,
        assetNumber: input.assetNumber === undefined ? undefined : input.assetNumber?.trim() || null,
        condition: input.condition,
        isLoanable: input.isLoanable,
        isReference: input.isReference,
        positionCode: input.positionCode === undefined ? undefined : input.positionCode,
        acquisitionSource: input.acquisitionSource as never,
        acquiredAt: input.acquiredAt === undefined ? undefined : input.acquiredAt,
        donorId: input.donorId === undefined ? undefined : input.donorId,
        supplier: input.supplier === undefined ? undefined : input.supplier,
        purchasePrice: input.purchasePrice === undefined ? undefined : input.purchasePrice,
        currentValue: input.currentValue === undefined ? undefined : input.currentValue,
        internalNote: input.internalNote === undefined ? undefined : input.internalNote,
      },
    });

    await this.audit.recordUpdate({
      entityType: 'BookCopy',
      entityId: id,
      entityLabel: `نسخه ${before.accessionNumber} از «${before.book.title}»`,
      before: before as unknown as Record<string, unknown>,
      after: input as Record<string, unknown>,
      user,
      ip,
    });

    return updated;
  }

  /**
   * تغییر وضعیت نسخه (آسیب‌دیده، در تعمیر، مفقود و ...).
   *
   * وضعیت‌های `ON_LOAN` و `AVAILABLE` از این مسیر قابل تنظیم نیستند — آنها
   * فقط توسط ماژول امانت تغییر می‌کنند تا وضعیت نسخه هرگز با وجود یک امانت
   * باز ناسازگار نشود.
   */
  async changeStatus(
    id: string,
    status: CopyStatus,
    reason: string | undefined,
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const MANAGED_BY_CIRCULATION: CopyStatus[] = ['ON_LOAN', 'RESERVED_HOLD'];
    if (MANAGED_BY_CIRCULATION.includes(status)) {
      throw DomainError.validation({
        status: ['این وضعیت فقط از طریق عملیات امانت و رزرو تغییر می‌کند.'],
      });
    }

    const copy = await this.prisma.bookCopy.findFirst({
      where: { id, deletedAt: null },
      include: {
        book: { select: { title: true } },
        loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } }, take: 1, select: { id: true } },
      },
    });
    if (!copy) throw DomainError.notFound('نسخه');

    // نسخه‌ای که در امانت است نمی‌تواند «موجود» شود بدون ثبت بازگشت
    if (copy.loans.length > 0 && status === 'AVAILABLE') {
      throw new DomainError(
        ERROR_CODES.COPY_HAS_OPEN_LOAN,
        'این نسخه در امانت است. ابتدا بازگشت آن را ثبت کنید.',
      );
    }

    const updated = await this.prisma.bookCopy.update({
      where: { id },
      data: {
        status,
        // نسخه مفقود یا از رده خارج دیگر قابل امانت نیست
        isLoanable: ['LOST', 'WITHDRAWN', 'NOT_LOANABLE', 'ARCHIVED'].includes(status)
          ? false
          : undefined,
      },
    });

    await this.audit.record({
      action: 'change_status',
      entityType: 'BookCopy',
      entityId: id,
      entityLabel: `نسخه ${copy.accessionNumber} از «${copy.book.title}»`,
      oldData: { status: copy.status },
      newData: { status, reason },
      user,
      ip,
    });

    return updated;
  }

  /**
   * جابه‌جایی نسخه بین قفسه‌ها (قوانین ۹ و ۸۵) — با ثبت تاریخچه.
   */
  async move(
    copyIds: string[],
    toLocationId: string,
    positionCode: string | null,
    reason: string | undefined,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ moved: number }> {
    if (copyIds.length === 0) return { moved: 0 };
    if (copyIds.length > 2000) {
      throw DomainError.validation({ copyIds: ['حداکثر ۲۰۰۰ نسخه در یک جابه‌جایی مجاز است.'] });
    }

    const target = await this.prisma.location.findFirst({
      where: { id: toLocationId, deletedAt: null },
      select: { id: true, name: true, fullCode: true, capacity: true },
    });
    if (!target) throw DomainError.notFound('مکان مقصد');

    const copies = await this.prisma.bookCopy.findMany({
      where: { id: { in: copyIds }, deletedAt: null },
      select: { id: true, locationId: true, positionCode: true },
    });
    if (copies.length === 0) throw DomainError.notFound('نسخه');

    // بررسی ظرفیت: نسخه‌هایی که از قبل در همین مکان‌اند دوباره شمرده نمی‌شوند
    if (target.capacity !== null) {
      const incoming = copies.filter((c) => c.locationId !== toLocationId).length;
      const current = await this.prisma.bookCopy.count({
        where: { locationId: toLocationId, deletedAt: null },
      });
      if (current + incoming > target.capacity) {
        throw new DomainError(
          ERROR_CODES.LOCATION_CAPACITY_EXCEEDED,
          `ظرفیت «${target.name}» ${target.capacity} جلد است؛ در حال حاضر ${current} جلد دارد و ${incoming} جلد جا نمی‌شود.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bookCopy.updateMany({
        where: { id: { in: copies.map((c) => c.id) } },
        data: { locationId: toLocationId, positionCode },
      });
      // تاریخچه جابه‌جایی — بدون این، «کتاب کجا رفت؟» بی‌پاسخ می‌ماند
      await tx.bookMovement.createMany({
        data: copies.map((c) => ({
          copyId: c.id,
          fromLocationId: c.locationId,
          toLocationId,
          fromPosition: c.positionCode,
          toPosition: positionCode,
          reason: reason ?? null,
          movedById: user.sub,
        })),
      });
    });

    await this.audit.record({
      action: 'move_copies',
      entityType: 'BookCopy',
      entityLabel: `${copies.length} نسخه → ${target.fullCode}`,
      newData: { toLocationId, toLocationCode: target.fullCode, positionCode, reason },
      user,
      ip,
    });

    return { moved: copies.length };
  }

  async remove(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const copy = await this.prisma.bookCopy.findFirst({
      where: { id, deletedAt: null },
      include: {
        book: { select: { title: true } },
        loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } }, take: 1, select: { id: true } },
      },
    });
    if (!copy) throw DomainError.notFound('نسخه');

    if (copy.loans.length > 0) {
      throw new DomainError(ERROR_CODES.COPY_HAS_OPEN_LOAN);
    }

    await this.prisma.bookCopy.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'WITHDRAWN', isLoanable: false },
    });

    await this.audit.record({
      action: 'delete',
      entityType: 'BookCopy',
      entityId: id,
      entityLabel: `نسخه ${copy.accessionNumber} از «${copy.book.title}»`,
      user,
      ip,
    });
  }

  /** تغییر وضعیت گروهی — برای عملیات انبوه (قانون ۱۲۶). */
  async bulkChangeStatus(
    copyIds: string[],
    status: CopyStatus,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ updated: number; skipped: number }> {
    if (['ON_LOAN', 'RESERVED_HOLD'].includes(status)) {
      throw DomainError.validation({
        status: ['این وضعیت فقط از طریق عملیات امانت تغییر می‌کند.'],
      });
    }

    // نسخه‌های در امانت از عملیات گروهی کنار گذاشته می‌شوند، نه اینکه کل
    // عملیات شکست بخورد — کتابدار انتظار دارد بقیه انجام شوند.
    const eligible = await this.prisma.bookCopy.findMany({
      where: {
        id: { in: copyIds },
        deletedAt: null,
        loans: { none: { status: { in: ['ACTIVE', 'OVERDUE'] } } },
      },
      select: { id: true },
    });

    const result = await this.prisma.bookCopy.updateMany({
      where: { id: { in: eligible.map((c) => c.id) } },
      data: {
        status,
        isLoanable: ['LOST', 'WITHDRAWN', 'NOT_LOANABLE', 'ARCHIVED'].includes(status)
          ? false
          : undefined,
      },
    });

    await this.audit.record({
      action: 'bulk_change_status',
      entityType: 'BookCopy',
      entityLabel: `${result.count} نسخه → ${status}`,
      newData: { status, copyIds: copyIds.slice(0, 50), total: copyIds.length },
      user,
      ip,
    });

    return { updated: result.count, skipped: copyIds.length - eligible.length };
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  private assertManualNumbersMatchCount(input: CreateCopiesInput): void {
    const fields: Array<[string, string[] | undefined]> = [
      ['accessionNumbers', input.accessionNumbers],
      ['barcodes', input.barcodes],
      ['assetNumbers', input.assetNumbers],
      ['libraryCodes', input.libraryCodes],
    ];
    for (const [name, values] of fields) {
      if (values && values.length > 0 && values.length !== input.count) {
        throw DomainError.validation({
          [name]: [`تعداد شماره‌های واردشده (${values.length}) با تعداد نسخه‌ها (${input.count}) برابر نیست.`],
        });
      }
      // شماره تکراری داخل خود درخواست — قید دیتابیس این را می‌گیرد ولی
      // پیام آن گنگ است؛ اینجا پیام روشن‌تری می‌دهیم.
      if (values && values.length > 0) {
        const trimmed = values.map((v) => v.trim()).filter(Boolean);
        if (new Set(trimmed).size !== trimmed.length) {
          throw DomainError.validation({ [name]: ['شماره‌های واردشده تکراری هستند.'] });
        }
      }
    }
  }

  private async assertLocationUsable(locationId: string, incoming: number): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, deletedAt: null },
      select: { id: true, name: true, capacity: true },
    });
    if (!location) throw DomainError.notFound('مکان');
    if (location.capacity === null) return;

    const current = await this.prisma.bookCopy.count({
      where: { locationId, deletedAt: null },
    });
    if (current + incoming > location.capacity) {
      throw new DomainError(
        ERROR_CODES.LOCATION_CAPACITY_EXCEEDED,
        `ظرفیت «${location.name}» ${location.capacity} جلد است و در حال حاضر ${current} جلد دارد.`,
      );
    }
  }

  private async resolveDonor(
    tx: Prisma.TransactionClient,
    input: CreateCopiesInput,
  ): Promise<string | null> {
    if (input.donorId) return input.donorId;
    const name = input.donorName?.trim();
    if (!name) return null;

    const existing = await tx.donor.findFirst({
      where: { fullName: name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (await tx.donor.create({ data: { fullName: name }, select: { id: true } })).id;
  }

  private async buildWhere(query: CopyListQuery): Promise<Prisma.BookCopyWhereInput> {
    const where: Prisma.BookCopyWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.bookId) where.bookId = query.bookId;
    if (query.status?.length) where.status = { in: query.status };
    if (query.condition) where.condition = query.condition as never;
    if (query.acquisitionSource) where.acquisitionSource = query.acquisitionSource as never;
    if (query.donorId) where.donorId = query.donorId;

    if (query.locationId) {
      if (query.locationSubtree) {
        const location = await this.prisma.location.findUnique({
          where: { id: query.locationId },
          select: { path: true },
        });
        // کوئری زیردرخت با ایندکس path — نه پیمایش بازگشتی
        if (location) where.location = { path: { startsWith: location.path } };
      } else {
        where.locationId = query.locationId;
      }
    }

    if (query.overdueOnly) {
      where.loans = { some: { status: 'OVERDUE' } };
    }

    if (query.q) {
      const digits = normalizeDigits(query.q).trim();
      where.OR = [
        { barcode: { contains: digits } },
        { accessionNumber: { contains: digits } },
        { libraryCode: { contains: query.q } },
        { assetNumber: { contains: query.q } },
      ];
    }

    return where;
  }

  private buildOrderBy(query: CopyListQuery): Prisma.BookCopyOrderByWithRelationInput[] {
    const dir = query.order ?? 'asc';
    switch (query.sort) {
      case 'accessionNumber': return [{ accessionNumber: dir }];
      case 'status': return [{ status: dir }, { accessionNumber: 'asc' }];
      default: return [{ createdAt: query.order ?? 'desc' }];
    }
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
