import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  ON_SHELF_STATUSES,
  buildPageMeta,
  normalizeDigits,
  normalizePageQuery,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface ScanResult {
  barcode: string;
  result: 'FOUND' | 'MOVED' | 'UNEXPECTED' | 'UNKNOWN' | 'DUPLICATE';
  /** پیام فارسی که مستقیماً به کتابدار نشان داده می‌شود */
  message: string;
  copy: {
    id: string;
    accessionNumber: string;
    title: string;
    expectedLocation: string | null;
    status: string;
  } | null;
  progress: { scanned: number; expected: number; found: number };
}

export interface DiscrepancyReport {
  session: {
    id: string; name: string; status: string;
    startedAt: Date | null; completedAt: Date | null;
    scopeLocation: string | null;
  };
  summary: {
    expected: number;
    scanned: number;
    found: number;
    missing: number;
    moved: number;
    unexpected: number;
    unknown: number;
    completionRate: number;
  };
  missing: Array<{
    copyId: string; accessionNumber: string; barcode: string;
    title: string; expectedLocation: string | null; status: string;
  }>;
  moved: Array<{
    copyId: string; accessionNumber: string; title: string;
    expectedLocation: string | null; foundLocation: string | null;
  }>;
  unexpected: Array<{
    copyId: string | null; barcode: string; title: string | null;
    homeLocation: string | null;
  }>;
  unknown: Array<{ barcode: string; scannedAt: Date }>;
}

/**
 * شمارش موجودی (قوانین ۳۹، ۴۰).
 *
 * ── چرا این ماژول برای کتابخانه ۱۰٬۰۰۰ جلدی حیاتی است ────────────────────
 * در هر کتابخانه، بخشی از کتاب‌ها به‌مرور گم یا جابه‌جا می‌شوند بدون آنکه در
 * سیستم ثبت شود. بدون شمارش دوره‌ای، این اختلاف انباشته می‌شود تا جایی که
 * کاتالوگ دیگر واقعیت قفسه را نشان نمی‌دهد.
 *
 * ── گردش کار ──────────────────────────────────────────────────────────────
 *   ۱. کتابدار یک محدوده (مثلاً «بخش ادبیات») انتخاب می‌کند
 *   ۲. سیستم فهرست «انتظار» را از دیتابیس می‌سازد
 *   ۳. کتابدار با بارکدخوان کتاب‌ها را یکی‌یکی اسکن می‌کند
 *   ۴. هر اسکن بی‌درنگ بازخورد می‌دهد: یافت شد / جابه‌جا شده / خارج از محدوده
 *   ۵. در پایان، گزارش مغایرت تولید می‌شود
 *
 * ── نکته طراحی: چرا وضعیت نسخه خودکار تغییر نمی‌کند ─────────────────────
 * کتابی که در شمارش پیدا نشده، لزوماً گم نشده — ممکن است در دست عضوی باشد،
 * در میز امانت، یا کتابدار قفسه‌ای را جا انداخته باشد. بنابراین شمارش فقط
 * **گزارش** می‌دهد؛ تبدیل «پیدا نشده» به «مفقود» یک تصمیم انسانی صریح است.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createSession(
    input: { name: string; scopeLocationId?: string | null; note?: string },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const branchId = user.branchId ?? (await this.defaultBranchId());

    let scopeLabel: string | null = null;
    if (input.scopeLocationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: input.scopeLocationId, deletedAt: null },
        select: { name: true, fullCode: true },
      });
      if (!loc) throw DomainError.notFound('مکان محدوده شمارش');
      scopeLabel = `${loc.name} (${loc.fullCode})`;
    }

    const expectedCount = await this.countExpected(branchId, input.scopeLocationId ?? null);

    const session = await this.prisma.inventorySession.create({
      data: {
        branchId,
        name: input.name.trim(),
        scopeLocationId: input.scopeLocationId ?? null,
        expectedCount,
        note: input.note ?? null,
        status: 'DRAFT',
        startedById: user.sub,
      },
    });

    await this.audit.record({
      action: 'create_inventory_session',
      entityType: 'InventorySession',
      entityId: session.id,
      entityLabel: `${session.name}${scopeLabel ? ` — ${scopeLabel}` : ''}`,
      newData: { expectedCount, scope: scopeLabel },
      user,
      ip,
    });

    return { ...session, scopeLabel };
  }

  async start(id: string, user: AuthenticatedUser, ip?: string) {
    const session = await this.prisma.inventorySession.findUnique({ where: { id } });
    if (!session) throw DomainError.notFound('جلسه شمارش');
    if (session.status !== 'DRAFT') {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'این جلسه شمارش قبلاً شروع یا بسته شده است.',
      );
    }

    // تعداد انتظار دوباره محاسبه می‌شود — ممکن است از زمان ساخت جلسه تا شروع
    // آن، کتاب‌هایی اضافه یا جابه‌جا شده باشند.
    const expectedCount = await this.countExpected(session.branchId, session.scopeLocationId);

    const updated = await this.prisma.inventorySession.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), expectedCount },
    });

    await this.audit.record({
      action: 'start_inventory',
      entityType: 'InventorySession',
      entityId: id,
      entityLabel: session.name,
      user, ip,
    });
    return updated;
  }

  /**
   * ثبت یک اسکن.
   *
   * این متد در حلقه اسکن پشت سر هم صدا زده می‌شود، پس باید سریع باشد:
   * یک کوئری برای یافتن نسخه، یک درج، یک به‌روزرسانی شمارنده.
   */
  async scan(
    sessionId: string,
    rawBarcode: string,
    user: AuthenticatedUser,
  ): Promise<ScanResult> {
    const session = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true, status: true, branchId: true, scopeLocationId: true,
        expectedCount: true, scannedCount: true, foundCount: true,
        scopeLocation: { select: { path: true, fullCode: true } },
      },
    });
    if (!session) throw DomainError.notFound('جلسه شمارش');
    if (session.status !== 'IN_PROGRESS') {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'این جلسه شمارش در حال اجرا نیست.',
      );
    }

    const barcode = normalizeDigits(rawBarcode).trim();
    if (!barcode) {
      throw DomainError.validation({ barcode: ['بارکد خالی است.'] });
    }

    // اسکن تکراری: کتابدار ممکن است یک کتاب را دو بار اسکن کند
    const existing = await this.prisma.inventoryScan.findUnique({
      where: { sessionId_barcode: { sessionId, barcode } },
      select: { id: true, result: true },
    });
    if (existing) {
      return this.buildScanResult(
        barcode, 'DUPLICATE', 'این بارکد قبلاً در همین شمارش ثبت شده است.',
        null, session,
      );
    }

    const copy = await this.prisma.bookCopy.findFirst({
      where: {
        deletedAt: null,
        OR: [{ barcode }, { accessionNumber: barcode }, { libraryCode: barcode }],
      },
      select: {
        id: true, accessionNumber: true, status: true, locationId: true,
        book: { select: { title: true } },
        location: { select: { id: true, path: true, fullCode: true } },
      },
    });

    // ── بارکد ناشناخته ──────────────────────────────────────────────────
    if (!copy) {
      await this.recordScan(sessionId, barcode, null, 'UNKNOWN', null, user.sub);
      return this.buildScanResult(
        barcode, 'UNKNOWN',
        'این بارکد در سیستم ثبت نشده است. ممکن است کتاب هنوز وارد نشده باشد.',
        null, session, 0,
      );
    }

    // ── تعیین اینکه نسخه در محدوده شمارش هست یا نه ──────────────────────
    const scopePath = session.scopeLocation?.path;
    const inScope =
      !scopePath || (copy.location?.path?.startsWith(scopePath) ?? false);

    let result: 'FOUND' | 'MOVED' | 'UNEXPECTED';
    let message: string;

    if (!inScope) {
      // کتابی که به این محدوده تعلق ندارد اما اینجا پیدا شده
      result = 'UNEXPECTED';
      message = `این کتاب متعلق به «${copy.location?.fullCode ?? 'بدون مکان'}» است، نه این محدوده.`;
    } else if (copy.status === 'ON_LOAN') {
      // کتابی که سیستم فکر می‌کند در امانت است اما روی قفسه پیدا شده —
      // یعنی بازگشتش ثبت نشده. این یک مغایرت مهم است.
      result = 'MOVED';
      message = 'این کتاب در سیستم «امانت داده شده» ثبت است اما روی قفسه پیدا شد. بازگشت آن ثبت نشده؟';
    } else {
      result = 'FOUND';
      message = 'یافت شد.';
    }

    await this.recordScan(sessionId, barcode, copy.id, result, copy.locationId, user.sub);

    return this.buildScanResult(barcode, result, message, {
      id: copy.id,
      accessionNumber: copy.accessionNumber,
      title: copy.book.title,
      expectedLocation: copy.location?.fullCode ?? null,
      status: copy.status,
    }, session, 1);
  }

  /** ثبت گروهی اسکن — برای دستگاه‌هایی که آفلاین جمع می‌کنند. */
  async scanBatch(
    sessionId: string,
    barcodes: string[],
    user: AuthenticatedUser,
  ): Promise<{ processed: number; results: Record<string, number> }> {
    if (barcodes.length > 2000) {
      throw DomainError.validation({ barcodes: ['حداکثر ۲۰۰۰ بارکد در یک درخواست.'] });
    }
    const tally: Record<string, number> = {};
    for (const barcode of barcodes) {
      try {
        const r = await this.scan(sessionId, barcode, user);
        tally[r.result] = (tally[r.result] ?? 0) + 1;
      } catch {
        tally['ERROR'] = (tally['ERROR'] ?? 0) + 1;
      }
    }
    return { processed: barcodes.length, results: tally };
  }

  /**
   * گزارش مغایرت (قانون ۴۰).
   *
   * «گم‌شده» = در فهرست انتظار بود ولی اسکن نشد.
   * این محاسبه با یک `LEFT JOIN` انجام می‌شود، نه با مقایسه دو آرایه در
   * حافظه — چون فهرست انتظار می‌تواند ده‌ها هزار ردیف باشد.
   */
  async discrepancyReport(sessionId: string): Promise<DiscrepancyReport> {
    const session = await this.prisma.inventorySession.findUnique({
      where: { id: sessionId },
      include: { scopeLocation: { select: { path: true, fullCode: true, name: true } } },
    });
    if (!session) throw DomainError.notFound('جلسه شمارش');

    const scopePath = session.scopeLocation?.path ?? null;
    const statuses = ON_SHELF_STATUSES;

    const [missing, moved, unexpected, unknown, counts] = await Promise.all([
      // نسخه‌هایی که باید می‌بودند ولی اسکن نشدند
      this.prisma.$queryRaw<
        Array<{
          copyId: string; accessionNumber: string; barcode: string;
          title: string; expectedLocation: string | null; status: string;
        }>
      >`
        SELECT c."id" AS "copyId", c."accessionNumber", c."barcode",
               b."title", l."fullCode" AS "expectedLocation", c."status"::text
          FROM book_copies c
          JOIN books b ON b."id" = c."bookId"
          LEFT JOIN locations l ON l."id" = c."locationId"
         WHERE c."deletedAt" IS NULL
           AND c."branchId" = ${session.branchId}::uuid
           AND c."status" = ANY(${statuses}::"CopyStatus"[])
           ${scopePath ? Prisma.sql`AND l."path" LIKE ${scopePath + '%'}` : Prisma.empty}
           AND NOT EXISTS (
             SELECT 1 FROM inventory_scans s
              WHERE s."sessionId" = ${sessionId}::uuid AND s."copyId" = c."id")
         ORDER BY l."fullCode", c."accessionNumber"
         LIMIT 5000
      `,

      this.prisma.inventoryScan.findMany({
        where: { sessionId, result: 'MOVED' },
        select: {
          copy: {
            select: {
              id: true, accessionNumber: true,
              book: { select: { title: true } },
              location: { select: { fullCode: true } },
            },
          },
          foundLocation: { select: { fullCode: true } },
        },
        take: 2000,
      }),

      this.prisma.inventoryScan.findMany({
        where: { sessionId, result: 'UNEXPECTED' },
        select: {
          barcode: true,
          copy: {
            select: {
              id: true,
              book: { select: { title: true } },
              location: { select: { fullCode: true } },
            },
          },
        },
        take: 2000,
      }),

      this.prisma.inventoryScan.findMany({
        where: { sessionId, result: 'UNKNOWN' },
        select: { barcode: true, scannedAt: true },
        take: 500,
      }),

      this.prisma.inventoryScan.groupBy({
        by: ['result'],
        where: { sessionId },
        _count: { _all: true },
      }),
    ]);

    const byResult = Object.fromEntries(counts.map((c) => [c.result, c._count._all]));
    const found = byResult['FOUND'] ?? 0;
    const movedCount = byResult['MOVED'] ?? 0;
    const scanned = counts.reduce((sum, c) => sum + c._count._all, 0);
    const expected = session.expectedCount;

    return {
      session: {
        id: session.id,
        name: session.name,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        scopeLocation: session.scopeLocation
          ? `${session.scopeLocation.name} (${session.scopeLocation.fullCode})`
          : null,
      },
      summary: {
        expected,
        scanned,
        found,
        missing: missing.length,
        moved: movedCount,
        unexpected: byResult['UNEXPECTED'] ?? 0,
        unknown: byResult['UNKNOWN'] ?? 0,
        completionRate: expected > 0 ? Math.round(((found + movedCount) / expected) * 100) : 0,
      },
      missing,
      moved: moved.map((m) => ({
        copyId: m.copy?.id ?? '',
        accessionNumber: m.copy?.accessionNumber ?? '',
        title: m.copy?.book.title ?? '',
        expectedLocation: m.copy?.location?.fullCode ?? null,
        foundLocation: m.foundLocation?.fullCode ?? null,
      })),
      unexpected: unexpected.map((u) => ({
        copyId: u.copy?.id ?? null,
        barcode: u.barcode,
        title: u.copy?.book.title ?? null,
        homeLocation: u.copy?.location?.fullCode ?? null,
      })),
      unknown,
    };
  }

  /** بستن جلسه و ذخیره آمار نهایی. */
  async complete(id: string, user: AuthenticatedUser, ip?: string) {
    const report = await this.discrepancyReport(id);
    if (report.session.status !== 'IN_PROGRESS') {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, 'این جلسه در حال اجرا نیست.');
    }

    const updated = await this.prisma.inventorySession.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        scannedCount: report.summary.scanned,
        foundCount: report.summary.found,
        missingCount: report.summary.missing,
        movedCount: report.summary.moved,
        unexpectedCount: report.summary.unexpected,
      },
    });

    await this.audit.record({
      action: 'complete_inventory',
      entityType: 'InventorySession',
      entityId: id,
      entityLabel: report.session.name,
      newData: report.summary,
      user, ip,
    });

    this.logger.log(
      `شمارش «${report.session.name}» بسته شد — ${report.summary.found} یافت، ${report.summary.missing} پیدا نشد`,
    );
    return updated;
  }

  async cancel(id: string, user: AuthenticatedUser, ip?: string) {
    const updated = await this.prisma.inventorySession.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    await this.audit.record({
      action: 'cancel_inventory', entityType: 'InventorySession',
      entityId: id, entityLabel: updated.name, user, ip,
    });
    return updated;
  }

  /**
   * اعمال نتیجه شمارش: علامت‌گذاری نسخه‌های پیدانشده به‌عنوان مفقود.
   *
   * این یک عمل **صریح و جداگانه** است، نه بخشی از بستن جلسه — چون تصمیم
   * «این کتاب گم شده» پیامد مالی و کاتالوگی دارد و باید آگاهانه گرفته شود.
   */
  async markMissingAsLost(
    sessionId: string,
    copyIds: string[],
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ updated: number }> {
    if (copyIds.length === 0) return { updated: 0 };

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.bookCopy.updateMany({
        where: {
          id: { in: copyIds },
          deletedAt: null,
          // نسخه‌ای که در امانت است از این مسیر مفقود اعلام نمی‌شود
          status: { notIn: ['ON_LOAN', 'LOST'] },
        },
        data: { status: 'LOST', isLoanable: false },
      });

      await tx.lostReport.createMany({
        data: copyIds.map((copyId) => ({
          copyId,
          status: 'OPEN',
          description: `در شمارش موجودی یافت نشد (جلسه ${sessionId})`,
          reportedById: user.sub,
        })),
        skipDuplicates: true,
      });

      return updated.count;
    });

    await this.audit.record({
      action: 'mark_lost_from_inventory',
      entityType: 'BookCopy',
      entityLabel: `${result} نسخه مفقود اعلام شد`,
      newData: { sessionId, copyIds: copyIds.slice(0, 100), total: copyIds.length },
      user, ip,
    });

    return { updated: result };
  }

  /**
   * اصلاح محل نسخه‌هایی که در جای دیگری پیدا شده‌اند.
   * پس از شمارش، کاتالوگ با واقعیت قفسه همگام می‌شود.
   */
  async applyMovedLocations(
    sessionId: string,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ updated: number }> {
    const scans = await this.prisma.inventoryScan.findMany({
      where: { sessionId, result: { in: ['MOVED', 'UNEXPECTED'] }, copyId: { not: null } },
      select: { copyId: true, foundLocationId: true, copy: { select: { locationId: true } } },
    });

    const toUpdate = scans.filter(
      (s) => s.foundLocationId && s.foundLocationId !== s.copy?.locationId,
    );
    if (toUpdate.length === 0) return { updated: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const scan of toUpdate) {
        await tx.bookCopy.update({
          where: { id: scan.copyId! },
          data: { locationId: scan.foundLocationId },
        });
        await tx.bookMovement.create({
          data: {
            copyId: scan.copyId!,
            fromLocationId: scan.copy?.locationId ?? null,
            toLocationId: scan.foundLocationId,
            reason: 'اصلاح محل بر اساس شمارش موجودی',
            movedById: user.sub,
          },
        });
      }
    });

    await this.audit.record({
      action: 'apply_inventory_locations',
      entityType: 'InventorySession',
      entityId: sessionId,
      entityLabel: `${toUpdate.length} نسخه جابه‌جا شد`,
      user, ip,
    });

    return { updated: toUpdate.length };
  }

  async list(query: { page?: number; pageSize?: number; status?: string }): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.InventorySessionWhereInput = {};
    if (query.status) where.status = query.status as never;

    const [rows, total] = await Promise.all([
      this.prisma.inventorySession.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { scopeLocation: { select: { name: true, fullCode: true } } },
      }),
      this.prisma.inventorySession.count({ where }),
    ]);

    return { data: rows, meta: buildPageMeta(page, pageSize, total) };
  }

  /** پیشرفت زنده — صفحه اسکن هر چند ثانیه آن را می‌خواند. */
  async progress(sessionId: string) {
    const [session, counts] = await Promise.all([
      this.prisma.inventorySession.findUnique({
        where: { id: sessionId },
        select: { id: true, name: true, status: true, expectedCount: true },
      }),
      this.prisma.inventoryScan.groupBy({
        by: ['result'],
        where: { sessionId },
        _count: { _all: true },
      }),
    ]);
    if (!session) throw DomainError.notFound('جلسه شمارش');

    const byResult = Object.fromEntries(counts.map((c) => [c.result, c._count._all]));
    const scanned = counts.reduce((sum, c) => sum + c._count._all, 0);
    const found = (byResult['FOUND'] ?? 0) + (byResult['MOVED'] ?? 0);

    return {
      ...session,
      scanned,
      found,
      unexpected: byResult['UNEXPECTED'] ?? 0,
      unknown: byResult['UNKNOWN'] ?? 0,
      duplicate: byResult['DUPLICATE'] ?? 0,
      remaining: Math.max(0, session.expectedCount - found),
      completionRate:
        session.expectedCount > 0 ? Math.round((found / session.expectedCount) * 100) : 0,
    };
  }

  /** آخرین اسکن‌ها — نمایش زنده در صفحه شمارش. */
  async recentScans(sessionId: string, limit = 20) {
    return this.prisma.inventoryScan.findMany({
      where: { sessionId },
      orderBy: { scannedAt: 'desc' },
      take: limit,
      select: {
        id: true, barcode: true, result: true, scannedAt: true,
        copy: {
          select: {
            accessionNumber: true,
            book: { select: { title: true } },
            location: { select: { fullCode: true } },
          },
        },
      },
    });
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  /** تعداد نسخه‌هایی که باید در این محدوده روی قفسه باشند. */
  private async countExpected(branchId: string, scopeLocationId: string | null): Promise<number> {
    const where: Prisma.BookCopyWhereInput = {
      branchId,
      deletedAt: null,
      // نسخه‌ای که در امانت است نباید روی قفسه باشد، پس جزء «انتظار» نیست
      status: { in: ON_SHELF_STATUSES },
    };

    if (scopeLocationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: scopeLocationId }, select: { path: true },
      });
      if (loc) where.location = { path: { startsWith: loc.path } };
    }

    return this.prisma.bookCopy.count({ where });
  }

  private async recordScan(
    sessionId: string,
    barcode: string,
    copyId: string | null,
    result: 'FOUND' | 'MOVED' | 'UNEXPECTED' | 'UNKNOWN',
    foundLocationId: string | null,
    userId: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.inventoryScan.create({
        data: { sessionId, barcode, copyId, result, foundLocationId, scannedById: userId },
      }),
      this.prisma.inventorySession.update({
        where: { id: sessionId },
        data: {
          scannedCount: { increment: 1 },
          ...(result === 'FOUND' ? { foundCount: { increment: 1 } } : {}),
          ...(result === 'MOVED' ? { movedCount: { increment: 1 } } : {}),
          ...(result === 'UNEXPECTED' ? { unexpectedCount: { increment: 1 } } : {}),
        },
      }),
    ]);
  }

  private buildScanResult(
    barcode: string,
    result: ScanResult['result'],
    message: string,
    copy: ScanResult['copy'],
    session: { expectedCount: number; scannedCount: number; foundCount: number },
    foundDelta = 0,
  ): ScanResult {
    return {
      barcode,
      result,
      message,
      copy,
      progress: {
        scanned: session.scannedCount + 1,
        expected: session.expectedCount,
        found: session.foundCount + foundDelta,
      },
    };
  }

  private async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isDefault: true }, select: { id: true },
    });
    if (!branch) throw new DomainError(ERROR_CODES.SETUP_REQUIRED, 'شعبه پیش‌فرض تعریف نشده است.');
    return branch.id;
  }
}
