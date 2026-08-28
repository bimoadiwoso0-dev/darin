import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  buildPageMeta,
  normalizePageQuery,
  persianNormalize,
  toCanonicalIsbn13,
  type ContributorRole,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface ContributorInput {
  personId?: string;
  /** اگر شناسه نداشته باشیم، پدیدآورنده با این نام ساخته یا پیدا می‌شود */
  fullName?: string;
  role: ContributorRole;
  position?: number;
}

export interface BookInput {
  title: string;
  subtitle?: string | null;
  titleEn?: string | null;
  originalTitle?: string | null;
  publisherId?: string | null;
  publisherName?: string | null;
  publicationPlace?: string | null;
  publicationYear?: number | null;
  publicationCalendar?: 'SOLAR_HIJRI' | 'GREGORIAN' | 'LUNAR_HIJRI';
  edition?: number | null;
  editionNote?: string | null;
  isbn?: string | null;
  issn?: string | null;
  nationalBibNumber?: string | null;
  language?: string;
  pageCount?: number | null;
  format?: string | null;
  bindingType?: string | null;
  summary?: string | null;
  description?: string | null;
  keywords?: string[];
  ageRating?: string | null;
  deweyCode?: string | null;
  congressCode?: string | null;
  seriesId?: string | null;
  seriesOrder?: number | null;
  parentBookId?: string | null;
  volumeNumber?: number | null;
  volumeTitle?: string | null;
  totalVolumes?: number | null;
  coverImageId?: string | null;
  internalNote?: string | null;
  contributors?: ContributorInput[];
  categoryIds?: string[];
  primaryCategoryId?: string | null;
  tagNames?: string[];
}

export interface BookListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  publisherId?: string;
  personId?: string;
  categoryId?: string;
  seriesId?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  /** فقط عنوان‌هایی که حداقل یک نسخه موجود دارند */
  availableOnly?: boolean;
  hasCopies?: boolean;
  sort?: 'title' | 'createdAt' | 'publicationYear' | 'copies';
  order?: 'asc' | 'desc';
  includeDeleted?: boolean;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  publisherName: string | null;
  publicationYear: number | null;
  isbn13: string | null;
  copyCount: number;
  /** دلیل شباهت — به کتابدار می‌گوید چرا این مورد پیشنهاد شده */
  reason: 'ISBN' | 'TITLE_AUTHOR' | 'TITLE';
  confidence: number;
}

/**
 * رکورد کتاب‌شناختی — قلب سیستم.
 *
 * این سرویس فقط با «عنوان» کار می‌کند. نسخه‌های فیزیکی در `CopiesService`
 * مدیریت می‌شوند (ADR-01).
 */
@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── خواندن ─────────────────────────────────────────────────────────────

  async list(query: BookListQuery): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where = this.buildWhere(query);

    const orderBy = this.buildOrderBy(query);

    const [rows, total] = await Promise.all([
      this.prisma.book.findMany({
        where,
        skip,
        take,
        orderBy,
        select: {
          id: true, title: true, subtitle: true, publicationYear: true, isbn13: true,
          language: true, edition: true, coverImageId: true, volumeNumber: true,
          volumeTitle: true, parentBookId: true, createdAt: true, deletedAt: true,
          publisher: { select: { id: true, name: true } },
          series: { select: { id: true, title: true } },
          // فقط پدیدآورندگان اصلی برای فهرست — بقیه در صفحه جزئیات
          contributors: {
            where: { role: { in: ['AUTHOR', 'CO_AUTHOR', 'TRANSLATOR'] } },
            orderBy: { position: 'asc' },
            take: 4,
            select: { role: true, person: { select: { id: true, fullName: true } } },
          },
          categories: {
            where: { isPrimary: true },
            take: 1,
            select: { category: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.book.count({ where }),
    ]);

    // شمارش نسخه‌ها در یک کوئری گروهی روی همین ۲۰ کتاب — نه `_count` رابطه‌ای.
    // توضیح در `copyCounts`.
    const countsByBook = await this.copyCounts(rows.map((r) => r.id));

    return {
      data: rows.map((r) => ({
        ...r,
        copyCount: countsByBook.get(r.id)?.total ?? 0,
        availableCount: countsByBook.get(r.id)?.available ?? 0,
      })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findOne(id: string) {
    const book = await this.prisma.book.findFirst({
      where: { id },
      include: {
        publisher: true,
        series: true,
        parentBook: { select: { id: true, title: true, totalVolumes: true } },
        volumes: {
          where: { deletedAt: null },
          orderBy: { volumeNumber: 'asc' },
          select: {
            id: true, volumeNumber: true, volumeTitle: true, isbn13: true, pageCount: true,
            _count: { select: { copies: { where: { deletedAt: null } } } },
          },
        },
        contributors: {
          orderBy: [{ role: 'asc' }, { position: 'asc' }],
          include: { person: { select: { id: true, fullName: true, latinName: true } } },
        },
        categories: { include: { category: { select: { id: true, name: true, path: true } } } },
        tags: { include: { tag: { select: { id: true, name: true, colorHex: true } } } },
      },
    });
    if (!book) throw DomainError.notFound('کتاب');

    const [copyStats, activeLoans] = await Promise.all([
      this.prisma.bookCopy.groupBy({
        by: ['status'],
        where: { bookId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.loan.count({
        where: { copy: { bookId: id }, status: { in: ['ACTIVE', 'OVERDUE'] } },
      }),
    ]);

    return {
      ...book,
      statusBreakdown: Object.fromEntries(copyStats.map((s) => [s.status, s._count._all])),
      totalCopies: copyStats.reduce((sum, s) => sum + s._count._all, 0),
      availableCopies: copyStats.find((s) => s.status === 'AVAILABLE')?._count._all ?? 0,
      activeLoans,
    };
  }

  // ── نوشتن ──────────────────────────────────────────────────────────────

  async create(input: BookInput, user: AuthenticatedUser, ip?: string) {
    const isbn13 = input.isbn ? toCanonicalIsbn13(input.isbn) : null;
    if (input.isbn && input.isbn.trim() && !isbn13) {
      throw DomainError.validation({ isbn: ['شابک واردشده معتبر نیست. رقم کنترل مطابقت ندارد.'] });
    }

    if (input.parentBookId) {
      const parent = await this.prisma.book.findFirst({
        where: { id: input.parentBookId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw DomainError.notFound('کتاب والد (اثر چندجلدی)');
    }

    const book = await this.prisma.$transaction(async (tx) => {
      const publisherId = await this.resolvePublisher(tx, input);
      const contributors = await this.resolveContributors(tx, input.contributors ?? []);

      const created = await tx.book.create({
        data: {
          ...this.scalarFields(input),
          // `scalarFields` برای مسیر ویرایش نوشته شده و همه فیلدهایش اختیاری‌اند؛
          // در مسیر ثبت، عنوان الزامی است و صریحاً تعیین می‌شود.
          title: input.title.trim(),
          isbn13,
          isbnRaw: input.isbn?.trim() || null,
          publisherId,
          createdById: user.sub,
          contributors: { create: contributors },
          categories: this.categoryCreateData(input),
        },
        select: { id: true, title: true },
      });

      if (input.tagNames?.length) await this.syncTags(tx, created.id, input.tagNames);
      return created;
    });

    await this.audit.record({
      action: 'create',
      entityType: 'Book',
      entityId: book.id,
      entityLabel: book.title,
      newData: { title: input.title, isbn13, publicationYear: input.publicationYear },
      user,
      ip,
    });

    return this.findOne(book.id);
  }

  async update(id: string, input: Partial<BookInput>, user: AuthenticatedUser, ip?: string) {
    const before = await this.prisma.book.findFirst({
      where: { id, deletedAt: null },
      include: { contributors: true, categories: true },
    });
    if (!before) throw DomainError.notFound('کتاب');

    let isbn13 = before.isbn13;
    if (input.isbn !== undefined) {
      isbn13 = input.isbn ? toCanonicalIsbn13(input.isbn) : null;
      if (input.isbn && input.isbn.trim() && !isbn13) {
        throw DomainError.validation({ isbn: ['شابک واردشده معتبر نیست.'] });
      }
    }

    // جلد نمی‌تواند والد خودش یا یکی از جلدهای خودش باشد
    if (input.parentBookId) {
      if (input.parentBookId === id) {
        throw DomainError.validation({ parentBookId: ['کتاب نمی‌تواند جلد خودش باشد.'] });
      }
      const wouldCycle = await this.prisma.book.findFirst({
        where: { id: input.parentBookId, parentBookId: id },
        select: { id: true },
      });
      if (wouldCycle) {
        throw DomainError.validation({
          parentBookId: ['این انتخاب باعث ایجاد حلقه در ساختار جلدها می‌شود.'],
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const publisherId =
        input.publisherId !== undefined || input.publisherName
          ? await this.resolvePublisher(tx, input)
          : undefined;

      await tx.book.update({
        where: { id },
        data: {
          ...this.scalarFields(input),
          ...(input.isbn !== undefined ? { isbn13, isbnRaw: input.isbn?.trim() || null } : {}),
          ...(publisherId !== undefined ? { publisherId } : {}),
        },
      });

      // پدیدآورندگان: جایگزینی کامل — ساده‌تر و قابل‌اعتمادتر از محاسبه تفاوت،
      // و Trigger دیتابیس بردار جستجو را خودکار بازسازی می‌کند.
      if (input.contributors) {
        const resolved = await this.resolveContributors(tx, input.contributors);
        await tx.bookContributor.deleteMany({ where: { bookId: id } });
        if (resolved.length > 0) {
          await tx.bookContributor.createMany({
            data: resolved.map((c) => ({ ...c, bookId: id })),
          });
        }
      }

      if (input.categoryIds || input.primaryCategoryId !== undefined) {
        await tx.bookCategory.deleteMany({ where: { bookId: id } });
        const data = this.categoryCreateData(input);
        if (data?.create?.length) {
          await tx.bookCategory.createMany({
            data: data.create.map((c) => ({ ...c, bookId: id })),
          });
        }
      }

      if (input.tagNames) await this.syncTags(tx, id, input.tagNames);
    });

    await this.audit.recordUpdate({
      entityType: 'Book',
      entityId: id,
      entityLabel: before.title,
      before: before as unknown as Record<string, unknown>,
      after: { ...this.scalarFields(input), isbn13 } as Record<string, unknown>,
      user,
      ip,
    });

    return this.findOne(id);
  }

  /**
   * حذف نرم کتاب.
   * کتابی که نسخه فیزیکی دارد حذف نمی‌شود — ابتدا باید نسخه‌ها تعیین تکلیف
   * شوند، وگرنه نسخه‌ها به رکوردی حذف‌شده اشاره می‌کنند (قانون ۳۵).
   */
  async remove(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const book = await this.prisma.book.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, title: true, _count: { select: { copies: { where: { deletedAt: null } } } } },
    });
    if (!book) throw DomainError.notFound('کتاب');

    if (book._count.copies > 0) {
      throw new DomainError(
        ERROR_CODES.BOOK_HAS_COPIES,
        `این کتاب ${book._count.copies} نسخه فیزیکی دارد و قابل حذف نیست. ابتدا نسخه‌ها را حذف یا بایگانی کنید.`,
      );
    }

    await this.prisma.book.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'delete',
      entityType: 'Book',
      entityId: id,
      entityLabel: book.title,
      user,
      ip,
    });
  }

  async restore(id: string, user: AuthenticatedUser, ip?: string) {
    const book = await this.prisma.book.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!book) throw DomainError.notFound('کتاب حذف‌شده');
    await this.prisma.book.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.record({
      action: 'restore', entityType: 'Book', entityId: id, entityLabel: book.title, user, ip,
    });
    return this.findOne(id);
  }

  // ── تشخیص تکراری (قانون ۴۱) ────────────────────────────────────────────

  /**
   * پیش از ثبت کتاب جدید، موارد مشابه را پیدا می‌کند.
   *
   * فلسفه: سیستم **هشدار می‌دهد، مانع نمی‌شود** (قانون ۱۲۵). یک کتابخانه
   * ممکن است عمداً دو چاپ متفاوت از یک عنوان را جدا ثبت کند. تصمیم با
   * کتابدار است، نه با نرم‌افزار.
   */
  async findDuplicates(input: {
    isbn?: string | null;
    title: string;
    authorName?: string | null;
    publisherId?: string | null;
  }): Promise<DuplicateCandidate[]> {
    const results = new Map<string, Omit<DuplicateCandidate, 'copyCount'>>();

    // ۱. تطابق ISBN — قطعی‌ترین نشانه
    const isbn13 = input.isbn ? toCanonicalIsbn13(input.isbn) : null;
    if (isbn13) {
      const byIsbn = await this.prisma.book.findMany({
        where: { isbn13, deletedAt: null },
        select: this.duplicateSelect(),
        take: 5,
      });
      for (const b of byIsbn) {
        results.set(b.id, this.toDuplicate(b, 'ISBN', 1.0));
      }
    }

    // ۲. تشابه عنوان با ایندکس trigram
    const normalizedTitle = persianNormalize(input.title);
    if (normalizedTitle.length >= 3) {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; similarity: number }>
      >`
        SELECT b."id", similarity(b."titleNormalized", ${normalizedTitle}) AS similarity
          FROM books b
         WHERE b."deletedAt" IS NULL
           AND b."titleNormalized" % ${normalizedTitle}
         ORDER BY similarity DESC
         LIMIT 10
      `;

      const ids = rows.filter((r) => r.similarity >= 0.45).map((r) => r.id);
      if (ids.length > 0) {
        const books = await this.prisma.book.findMany({
          where: { id: { in: ids } },
          select: this.duplicateSelect(),
        });
        const simById = new Map(rows.map((r) => [r.id, r.similarity]));
        const authorNormalized = input.authorName ? persianNormalize(input.authorName) : null;

        for (const b of books) {
          if (results.has(b.id)) continue;

          // اگر نویسنده هم بخورد، اطمینان بالاتر می‌رود
          const authorMatches = authorNormalized
            ? b.contributors.some((c) =>
                persianNormalize(c.person.fullName).includes(authorNormalized) ||
                authorNormalized.includes(persianNormalize(c.person.fullName)),
              )
            : false;

          const titleSim = simById.get(b.id) ?? 0;
          results.set(
            b.id,
            this.toDuplicate(
              b,
              authorMatches ? 'TITLE_AUTHOR' : 'TITLE',
              authorMatches ? Math.min(0.95, titleSim + 0.25) : titleSim,
            ),
          );
        }
      }
    }

    const top = [...results.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    const counts = await this.copyCounts(top.map((c) => c.id));
    return top.map((c) => ({ ...c, copyCount: counts.get(c.id)?.total ?? 0 }));
  }

  // ── عملیات گروهی (قوانین ۶۰ و ۶۱) ──────────────────────────────────────

  async bulkUpdate(
    bookIds: string[],
    changes: { categoryId?: string; addTagNames?: string[]; language?: string },
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ updated: number }> {
    if (bookIds.length === 0) return { updated: 0 };
    if (bookIds.length > 2000) {
      throw DomainError.validation({ bookIds: ['حداکثر ۲۰۰۰ کتاب در یک عملیات گروهی مجاز است.'] });
    }

    await this.prisma.$transaction(async (tx) => {
      if (changes.language) {
        await tx.book.updateMany({
          where: { id: { in: bookIds }, deletedAt: null },
          data: { language: changes.language },
        });
      }

      if (changes.categoryId) {
        // دسته موجود به‌عنوان دسته فرعی افزوده می‌شود؛ «موضوع اصلی» هر کتاب
        // دست‌نخورده می‌ماند چون تغییر گروهی آن معمولاً خطای کاربر است.
        await tx.bookCategory.createMany({
          data: bookIds.map((bookId) => ({ bookId, categoryId: changes.categoryId!, isPrimary: false })),
          skipDuplicates: true,
        });
      }

      if (changes.addTagNames?.length) {
        for (const name of changes.addTagNames) {
          const tag = await tx.tag.upsert({
            where: { name: name.trim() },
            create: { name: name.trim() },
            update: {},
            select: { id: true },
          });
          await tx.bookTag.createMany({
            data: bookIds.map((bookId) => ({ bookId, tagId: tag.id })),
            skipDuplicates: true,
          });
        }
      }
    });

    await this.audit.record({
      action: 'bulk_update',
      entityType: 'Book',
      entityLabel: `${bookIds.length} کتاب`,
      newData: changes,
      user,
      ip,
    });

    return { updated: bookIds.length };
  }

  /** کتاب‌های مرتبط — پایه سیستم پیشنهاد (قانون ۳۰). */
  async related(id: string, limit = 8) {
    const book = await this.prisma.book.findFirst({
      where: { id },
      select: {
        categories: { select: { categoryId: true } },
        contributors: { where: { role: 'AUTHOR' }, select: { personId: true } },
        seriesId: true,
      },
    });
    if (!book) throw DomainError.notFound('کتاب');

    const categoryIds = book.categories.map((c) => c.categoryId);
    const personIds = book.contributors.map((c) => c.personId);

    // اولویت: هم‌مجموعه‌ای > هم‌نویسنده > هم‌موضوع
    const candidates = await this.prisma.book.findMany({
      where: {
        id: { not: id },
        deletedAt: null,
        OR: [
          ...(book.seriesId ? [{ seriesId: book.seriesId }] : []),
          ...(personIds.length ? [{ contributors: { some: { personId: { in: personIds } } } }] : []),
          ...(categoryIds.length ? [{ categories: { some: { categoryId: { in: categoryIds } } } }] : []),
        ],
      },
      select: {
        id: true, title: true, coverImageId: true, publicationYear: true, seriesId: true,
        publisher: { select: { name: true } },
        contributors: {
          where: { role: 'AUTHOR' },
          take: 2,
          select: { personId: true, person: { select: { fullName: true } } },
        },
        categories: { select: { categoryId: true } },
      },
      take: limit * 4,
    });

    const scored = candidates.map((c) => {
      let score = 0;
      if (book.seriesId && c.seriesId === book.seriesId) score += 5;
      if (c.contributors.some((a) => personIds.includes(a.personId))) score += 3;
      score += c.categories.filter((cc) => categoryIds.includes(cc.categoryId)).length;
      return { ...c, score };
    });

    const top = scored.sort((a, b) => b.score - a.score).slice(0, limit);
    // شمارش فقط برای همان چند کتابی که واقعاً برگردانده می‌شوند
    const counts = await this.copyCounts(top.map((c) => c.id));
    return top.map((c) => ({ ...c, availableCount: counts.get(c.id)?.available ?? 0 }));
  }

  // ── کمکی‌های داخلی ─────────────────────────────────────────────────────

  private buildWhere(query: BookListQuery): Prisma.BookWhereInput {
    const where: Prisma.BookWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.publisherId) where.publisherId = query.publisherId;
    if (query.seriesId) where.seriesId = query.seriesId;
    if (query.language) where.language = query.language;
    if (query.personId) where.contributors = { some: { personId: query.personId } };

    if (query.categoryId) {
      // زیردرخت دسته هم شامل می‌شود: «ادبیات» باید کتاب‌های «غزل» را هم بیاورد
      where.categories = {
        some: {
          OR: [
            { categoryId: query.categoryId },
            { category: { path: { contains: `.${query.categoryId}.` } } },
          ],
        },
      };
    }

    if (query.yearFrom || query.yearTo) {
      where.publicationYear = {
        ...(query.yearFrom ? { gte: query.yearFrom } : {}),
        ...(query.yearTo ? { lte: query.yearTo } : {}),
      };
    }

    /*
     * فیلتر موجودی.
     *
     * `hasCopies === false` باید «کتاب‌های بدون نسخه فیزیکی» را بدهد، نه
     * اینکه مثل `undefined` نادیده گرفته شود. با `else if (query.hasCopies)`
     * حالت `false` بی‌صدا از فیلتر می‌افتاد و گزینه «بدون نسخه فیزیکی» در
     * رابط کاربری همه کتاب‌ها را برمی‌گرداند — فیلتری که وجود داشت اما
     * کار نمی‌کرد.
     */
    if (query.availableOnly) {
      where.copies = { some: { deletedAt: null, status: 'AVAILABLE' } };
    } else if (query.hasCopies === true) {
      where.copies = { some: { deletedAt: null } };
    } else if (query.hasCopies === false) {
      where.copies = { none: { deletedAt: null } };
    }

    if (query.q) {
      const normalized = persianNormalize(query.q);
      const digits = query.q.replace(/\D/g, '');
      // نکته: شرط ISBN فقط وقتی افزوده می‌شود که ورودی واقعاً رقم داشته باشد —
      // `contains: ''` در Prisma با همه‌چیز تطابق می‌کند و فیلتر را بی‌اثر می‌کند.
      const clauses: Prisma.BookWhereInput[] = [];
      if (normalized) {
        clauses.push({ titleNormalized: { contains: normalized } });
        // جستجو با نام پدیدآورنده — کتابدار «کافکا» را تایپ می‌کند و انتظار
        // دارد آثارش را ببیند، نه اینکه مجبور باشد بداند نام در عنوان نیست.
        clauses.push({
          contributors: { some: { person: { nameNormalized: { contains: normalized } } } },
        });
        clauses.push({ publisher: { nameNormalized: { contains: normalized } } });
      }
      if (digits.length >= 3) clauses.push({ isbn13: { contains: digits } });
      if (clauses.length > 0) where.OR = clauses;
    }

    return where;
  }

  private buildOrderBy(query: BookListQuery): Prisma.BookOrderByWithRelationInput[] {
    const dir = query.order ?? 'desc';
    switch (query.sort) {
      case 'title': return [{ titleNormalized: dir }];
      case 'publicationYear': return [{ publicationYear: dir }, { titleNormalized: 'asc' }];
      case 'copies': return [{ copies: { _count: dir } }];
      default: return [{ createdAt: dir }];
    }
  }

  /**
   * تعداد کل نسخه‌ها و نسخه‌های موجود، برای مجموعه‌ای از کتاب‌ها، در یک کوئری.
   *
   * ── چرا `_count` رابطه‌ای Prisma استفاده نمی‌شود ────────────────────────
   * `_count: { select: { copies: … } }` این SQL را می‌سازد:
   *
   *   LEFT JOIN (SELECT "bookId", COUNT(*) FROM book_copies
   *              WHERE "deletedAt" IS NULL GROUP BY "bookId") …
   *   ORDER BY … LIMIT 20
   *
   * یعنی برای نمایش ۲۰ ردیف، اول کل جدول نسخه‌ها گروه‌بندی می‌شود و بعد
   * `LIMIT` اعمال می‌گردد. با ۱۲۲٬۰۰۰ نسخه اندازه‌گیری شد: ۱۶۶ میلی‌ثانیه
   * برای هر بار باز کردن فهرست کتاب‌ها — و این هزینه با رشد کتابخانه خطی
   * بالا می‌رود، حتی اگر کاربر همیشه فقط صفحه اول را ببیند.
   *
   * `groupBy` روی همان ۲۰ شناسه، از ایندکس `book_copies_bookId_idx`
   * استفاده می‌کند و مستقل از اندازه جدول است: ۲.۹ میلی‌ثانیه.
   */
  private async copyCounts(
    bookIds: string[],
  ): Promise<Map<string, { total: number; available: number }>> {
    const counts = new Map<string, { total: number; available: number }>();
    if (bookIds.length === 0) return counts;

    const rows = await this.prisma.bookCopy.groupBy({
      by: ['bookId', 'status'],
      where: { bookId: { in: bookIds }, deletedAt: null },
      _count: { _all: true },
    });

    for (const row of rows) {
      const entry = counts.get(row.bookId) ?? { total: 0, available: 0 };
      entry.total += row._count._all;
      if (row.status === 'AVAILABLE') entry.available += row._count._all;
      counts.set(row.bookId, entry);
    }
    return counts;
  }

  private scalarFields(input: Partial<BookInput>) {
    return {
      title: input.title?.trim(),
      subtitle: input.subtitle ?? undefined,
      titleEn: input.titleEn ?? undefined,
      originalTitle: input.originalTitle ?? undefined,
      publicationPlace: input.publicationPlace ?? undefined,
      publicationYear: input.publicationYear ?? undefined,
      publicationCalendar: input.publicationCalendar,
      edition: input.edition ?? undefined,
      editionNote: input.editionNote ?? undefined,
      issn: input.issn ?? undefined,
      nationalBibNumber: input.nationalBibNumber ?? undefined,
      language: input.language,
      pageCount: input.pageCount ?? undefined,
      format: input.format as never,
      bindingType: input.bindingType as never,
      summary: input.summary ?? undefined,
      description: input.description ?? undefined,
      keywords: input.keywords,
      ageRating: input.ageRating ?? undefined,
      deweyCode: input.deweyCode ?? undefined,
      congressCode: input.congressCode ?? undefined,
      seriesId: input.seriesId ?? undefined,
      seriesOrder: input.seriesOrder ?? undefined,
      parentBookId: input.parentBookId ?? undefined,
      volumeNumber: input.volumeNumber ?? undefined,
      volumeTitle: input.volumeTitle ?? undefined,
      totalVolumes: input.totalVolumes ?? undefined,
      coverImageId: input.coverImageId ?? undefined,
      internalNote: input.internalNote ?? undefined,
    };
  }

  /** ناشر را با شناسه پیدا می‌کند، یا با نام می‌سازد (ورود سریع کتابدار). */
  private async resolvePublisher(
    tx: Prisma.TransactionClient,
    input: Partial<BookInput>,
  ): Promise<string | null> {
    if (input.publisherId) return input.publisherId;
    if (input.publisherId === null) return null;

    const name = input.publisherName?.trim();
    if (!name) return null;

    const normalized = persianNormalize(name);
    const existing = await tx.publisher.findFirst({
      where: { nameNormalized: normalized, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.publisher.create({ data: { name }, select: { id: true } });
    return created.id;
  }

  /**
   * پدیدآورندگان را به شناسه تبدیل می‌کند.
   * اگر کتابدار فقط نام تایپ کرده باشد، رکورد استنادی موجود پیدا می‌شود
   * (با تطابق نام نرمال‌شده) یا رکورد جدید ساخته می‌شود — این کار از ساخته
   * شدن «حافظ» و «حافظ شیرازی» به‌عنوان دو نفر مجزا جلوگیری می‌کند.
   */
  private async resolveContributors(
    tx: Prisma.TransactionClient,
    contributors: ContributorInput[],
  ): Promise<Array<{ personId: string; role: ContributorRole; position: number }>> {
    const out: Array<{ personId: string; role: ContributorRole; position: number }> = [];
    const seen = new Set<string>();

    for (const [index, c] of contributors.entries()) {
      let personId = c.personId;

      if (!personId) {
        const name = c.fullName?.trim();
        if (!name) continue;
        const normalized = persianNormalize(name);
        const existing = await tx.person.findFirst({
          where: { nameNormalized: normalized, deletedAt: null },
          select: { id: true },
        });
        personId = existing?.id ?? (await tx.person.create({ data: { fullName: name } })).id;
      }

      // یک شخص نمی‌تواند دو بار با یک نقش ثبت شود (قید یکتایی دیتابیس)
      const key = `${personId}:${c.role}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ personId, role: c.role, position: c.position ?? index });
    }
    return out;
  }

  private categoryCreateData(input: Partial<BookInput>) {
    const ids = new Set(input.categoryIds ?? []);
    if (input.primaryCategoryId) ids.add(input.primaryCategoryId);
    if (ids.size === 0) return undefined;
    return {
      create: [...ids].map((categoryId) => ({
        categoryId,
        isPrimary: categoryId === input.primaryCategoryId,
      })),
    };
  }

  private async syncTags(
    tx: Prisma.TransactionClient,
    bookId: string,
    tagNames: string[],
  ): Promise<void> {
    await tx.bookTag.deleteMany({ where: { bookId } });
    const names = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))].slice(0, 30);
    for (const name of names) {
      const tag = await tx.tag.upsert({
        where: { name },
        create: { name },
        update: {},
        select: { id: true },
      });
      await tx.bookTag.create({ data: { bookId, tagId: tag.id } });
    }
  }

  private duplicateSelect() {
    return {
      id: true, title: true, publicationYear: true, isbn13: true,
      publisher: { select: { name: true } },
      contributors: {
        where: { role: { in: ['AUTHOR', 'CO_AUTHOR'] as ContributorRole[] } },
        select: { person: { select: { fullName: true } } },
      },
    } satisfies Prisma.BookSelect;
  }

  /** نامزد تکراری بدون `copyCount` — شمارش در پایان و فقط برای بازماندگان. */
  private toDuplicate(
    b: {
      id: string; title: string; publicationYear: number | null; isbn13: string | null;
      publisher: { name: string } | null;
    },
    reason: DuplicateCandidate['reason'],
    confidence: number,
  ): Omit<DuplicateCandidate, 'copyCount'> {
    return {
      id: b.id,
      title: b.title,
      publisherName: b.publisher?.name ?? null,
      publicationYear: b.publicationYear,
      isbn13: b.isbn13,
      reason,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}
