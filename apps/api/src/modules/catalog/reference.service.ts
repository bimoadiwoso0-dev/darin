import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  buildPageMeta,
  normalizePageQuery,
  persianNormalize,
  type ContributorRole,
  type Paginated,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  kind: 'SUBJECT' | 'GENRE';
  depth: number;
  colorHex: string | null;
  bookCount: number;
  children: CategoryNode[];
}

/**
 * داده‌های مرجع کاتالوگ: پدیدآورندگان، ناشران، دسته‌بندی‌ها، مجموعه‌ها، برچسب‌ها.
 *
 * چرا یک سرویس برای همه؟ چون الگوی هر پنج مورد یکسان است (CRUD + جستجو +
 * شمارش کتاب) و پنج کلاس تقریباً یکسان فقط تکرار کد بود. جایی که رفتار
 * واقعاً متفاوت است — درخت دسته‌بندی — متدهای اختصاصی خودش را دارد.
 */
@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ═══ پدیدآورندگان (نویسنده / مترجم / ویراستار) ══════════════════════════

  /**
   * فهرست پدیدآورندگان.
   * `role` فیلتر می‌کند تا صفحه «نویسندگان» و صفحه «مترجمان» از یک جدول
   * ساخته شوند بدون آنکه داده تکرار شود (ADR-02).
   */
  async listPersons(query: {
    page?: number;
    pageSize?: number;
    q?: string;
    role?: ContributorRole;
    sort?: 'name' | 'books';
    order?: 'asc' | 'desc';
  }): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.PersonWhereInput = { deletedAt: null };

    if (query.q) {
      const normalized = persianNormalize(query.q);
      if (normalized) where.nameNormalized = { contains: normalized };
    }
    if (query.role) where.contributions = { some: { role: query.role } };

    const [rows, total] = await Promise.all([
      this.prisma.person.findMany({
        where,
        skip,
        take,
        orderBy:
          query.sort === 'books'
            ? [{ contributions: { _count: query.order ?? 'desc' } }]
            : [{ nameNormalized: query.order ?? 'asc' }],
        select: {
          id: true, fullName: true, latinName: true, nationality: true,
          birthDate: true, deathDate: true, photoId: true,
          _count: { select: { contributions: true } },
        },
      }),
      this.prisma.person.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, bookCount: r._count.contributions, _count: undefined })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findPerson(id: string) {
    const person = await this.prisma.person.findFirst({ where: { id, deletedAt: null } });
    if (!person) throw DomainError.notFound('پدیدآورنده');

    // کتاب‌های این شخص، گروه‌بندی‌شده بر اساس نقش — «۱۲ کتاب به‌عنوان نویسنده،
    // ۳ کتاب به‌عنوان مترجم» اطلاعات مفیدتری از یک فهرست تخت است.
    const [contributions, roleCounts] = await Promise.all([
      this.prisma.bookContributor.findMany({
        where: { personId: id, book: { deletedAt: null } },
        orderBy: { book: { publicationYear: 'desc' } },
        take: 100,
        select: {
          role: true,
          book: {
            select: {
              id: true, title: true, publicationYear: true, coverImageId: true,
              publisher: { select: { name: true } },
              _count: { select: { copies: { where: { deletedAt: null } } } },
            },
          },
        },
      }),
      this.prisma.bookContributor.groupBy({
        by: ['role'],
        where: { personId: id, book: { deletedAt: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      ...person,
      books: contributions.map((c) => ({
        ...c.book,
        role: c.role,
        copyCount: c.book._count.copies,
        _count: undefined,
      })),
      roleCounts: Object.fromEntries(roleCounts.map((r) => [r.role, r._count._all])),
      totalBooks: contributions.length,
    };
  }

  async createPerson(
    input: {
      fullName: string; latinName?: string | null; birthDate?: Date | null;
      deathDate?: Date | null; biography?: string | null; website?: string | null;
      nationality?: string | null; photoId?: string | null; note?: string | null;
    },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    // هشدار همنام: مانع ثبت نمی‌شویم (دو نویسنده می‌توانند همنام باشند)،
    // اما رکورد موجود در پاسخ برمی‌گردد تا UI بتواند هشدار بدهد.
    const normalized = persianNormalize(input.fullName);
    const existing = await this.prisma.person.findFirst({
      where: { nameNormalized: normalized, deletedAt: null },
      select: { id: true, fullName: true },
    });

    const person = await this.prisma.person.create({
      data: {
        fullName: input.fullName.trim(),
        latinName: input.latinName?.trim() || null,
        birthDate: input.birthDate ?? null,
        deathDate: input.deathDate ?? null,
        biography: input.biography ?? null,
        website: input.website?.trim() || null,
        nationality: input.nationality?.trim() || null,
        photoId: input.photoId ?? null,
        note: input.note ?? null,
      },
    });

    await this.audit.record({
      action: 'create', entityType: 'Person', entityId: person.id,
      entityLabel: person.fullName, user, ip,
    });

    return { ...person, possibleDuplicate: existing };
  }

  async updatePerson(
    id: string,
    input: Partial<{
      fullName: string; latinName: string | null; birthDate: Date | null;
      deathDate: Date | null; biography: string | null; website: string | null;
      nationality: string | null; photoId: string | null; note: string | null;
    }>,
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const before = await this.prisma.person.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw DomainError.notFound('پدیدآورنده');

    const updated = await this.prisma.person.update({
      where: { id },
      data: {
        fullName: input.fullName?.trim(),
        latinName: input.latinName === undefined ? undefined : input.latinName?.trim() || null,
        birthDate: input.birthDate === undefined ? undefined : input.birthDate,
        deathDate: input.deathDate === undefined ? undefined : input.deathDate,
        biography: input.biography === undefined ? undefined : input.biography,
        website: input.website === undefined ? undefined : input.website?.trim() || null,
        nationality: input.nationality === undefined ? undefined : input.nationality,
        photoId: input.photoId === undefined ? undefined : input.photoId,
        note: input.note === undefined ? undefined : input.note,
      },
    });

    await this.audit.recordUpdate({
      entityType: 'Person', entityId: id, entityLabel: before.fullName,
      before: before,
      after: input,
      user, ip,
    });
    return updated;
  }

  async deletePerson(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const person = await this.prisma.person.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, fullName: true, _count: { select: { contributions: true } } },
    });
    if (!person) throw DomainError.notFound('پدیدآورنده');

    if (person._count.contributions > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `«${person.fullName}» به ${person._count.contributions} کتاب متصل است و قابل حذف نیست.`,
      );
    }

    await this.prisma.person.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'delete', entityType: 'Person', entityId: id,
      entityLabel: person.fullName, user, ip,
    });
  }

  /**
   * ادغام دو رکورد پدیدآورنده تکراری.
   *
   * پس از Import اطلاعات قدیمی، معمولاً «حافظ» و «حافظ شیرازی» دو رکورد
   * جدا شده‌اند. این متد همه کتاب‌های رکورد تکراری را به رکورد اصلی منتقل
   * و رکورد تکراری را بایگانی می‌کند.
   */
  async mergePersons(
    keepId: string,
    mergeId: string,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ movedBooks: number }> {
    if (keepId === mergeId) {
      throw DomainError.validation({ mergeId: ['نمی‌توان یک رکورد را با خودش ادغام کرد.'] });
    }

    const [keep, merge] = await Promise.all([
      this.prisma.person.findFirst({ where: { id: keepId, deletedAt: null } }),
      this.prisma.person.findFirst({ where: { id: mergeId, deletedAt: null } }),
    ]);
    if (!keep || !merge) throw DomainError.notFound('پدیدآورنده');

    const moved = await this.prisma.$transaction(async (tx) => {
      const links = await tx.bookContributor.findMany({
        where: { personId: mergeId },
        select: { id: true, bookId: true, role: true, position: true },
      });

      let count = 0;
      for (const link of links) {
        // اگر رکورد مقصد از قبل همان نقش را در همان کتاب دارد، لینک تکراری
        // فقط حذف می‌شود (قید یکتایی اجازه دو ردیف یکسان را نمی‌دهد).
        const clash = await tx.bookContributor.findUnique({
          where: {
            bookId_personId_role: { bookId: link.bookId, personId: keepId, role: link.role },
          },
          select: { id: true },
        });
        if (clash) {
          await tx.bookContributor.delete({ where: { id: link.id } });
        } else {
          await tx.bookContributor.update({
            where: { id: link.id },
            data: { personId: keepId },
          });
          count++;
        }
      }

      await tx.person.update({
        where: { id: mergeId },
        data: {
          deletedAt: new Date(),
          note: `${merge.note ?? ''}\n[ادغام‌شده در ${keep.fullName} — ${new Date().toISOString()}]`.trim(),
        },
      });
      return count;
    });

    await this.audit.record({
      action: 'merge',
      entityType: 'Person',
      entityId: keepId,
      entityLabel: `${merge.fullName} → ${keep.fullName}`,
      oldData: { mergedId: mergeId, mergedName: merge.fullName },
      newData: { keepId, movedBooks: moved },
      user,
      ip,
    });

    return { movedBooks: moved };
  }

  // ═══ ناشران ════════════════════════════════════════════════════════════

  async listPublishers(query: { page?: number; pageSize?: number; q?: string }) {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.PublisherWhereInput = { deletedAt: null };
    if (query.q) {
      const normalized = persianNormalize(query.q);
      if (normalized) where.nameNormalized = { contains: normalized };
    }

    const [rows, total] = await Promise.all([
      this.prisma.publisher.findMany({
        where, skip, take,
        orderBy: { nameNormalized: 'asc' },
        select: {
          id: true, name: true, latinName: true, city: true, phone: true,
          email: true, website: true, logoId: true,
          _count: { select: { books: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.publisher.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, bookCount: r._count.books, _count: undefined })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async upsertPublisher(
    id: string | null,
    input: {
      name: string; latinName?: string | null; city?: string | null; address?: string | null;
      phone?: string | null; email?: string | null; website?: string | null;
      logoId?: string | null; note?: string | null;
    },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const data = {
      name: input.name.trim(),
      latinName: input.latinName?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address ?? null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      website: input.website?.trim() || null,
      logoId: input.logoId ?? null,
      note: input.note ?? null,
    };

    const publisher = id
      ? await this.prisma.publisher.update({ where: { id }, data })
      : await this.prisma.publisher.create({ data });

    await this.audit.record({
      action: id ? 'update' : 'create',
      entityType: 'Publisher', entityId: publisher.id,
      entityLabel: publisher.name, newData: data, user, ip,
    });
    return publisher;
  }

  async deletePublisher(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const publisher = await this.prisma.publisher.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, _count: { select: { books: { where: { deletedAt: null } } } } },
    });
    if (!publisher) throw DomainError.notFound('ناشر');
    if (publisher._count.books > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `«${publisher.name}» ناشر ${publisher._count.books} کتاب است و قابل حذف نیست.`,
      );
    }
    await this.prisma.publisher.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'delete', entityType: 'Publisher', entityId: id,
      entityLabel: publisher.name, user, ip,
    });
  }

  // ═══ درخت دسته‌بندی (قانون ۲۹) ═════════════════════════════════════════

  async categoryTree(kind?: 'SUBJECT' | 'GENRE'): Promise<CategoryNode[]> {
    const [categories, counts] = await Promise.all([
      this.prisma.category.findMany({
        where: { deletedAt: null, ...(kind ? { kind } : {}) },
        orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { nameNormalized: 'asc' }],
        select: {
          id: true, parentId: true, name: true, code: true, kind: true,
          depth: true, colorHex: true,
        },
      }),
      this.prisma.bookCategory.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
        where: { book: { deletedAt: null } },
      }),
    ]);

    const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const byId = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const c of categories) {
      byId.set(c.id, {
        ...c,
        kind: c.kind,
        bookCount: countByCategory.get(c.id) ?? 0,
        children: [],
      });
    }
    for (const c of categories) {
      const node = byId.get(c.id)!;
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // شمارش تجمعی: «ادبیات» باید شامل کتاب‌های «غزل» هم باشد
    const rollUp = (node: CategoryNode): number => {
      node.bookCount += node.children.reduce((sum, c) => sum + rollUp(c), 0);
      return node.bookCount;
    };
    roots.forEach(rollUp);

    return roots;
  }

  async createCategory(
    input: {
      name: string; parentId?: string | null; kind?: 'SUBJECT' | 'GENRE';
      code?: string | null; colorHex?: string | null; description?: string | null;
      sortOrder?: number;
    },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const parent = input.parentId
      ? await this.prisma.category.findFirst({
          where: { id: input.parentId, deletedAt: null },
          select: { id: true, path: true, depth: true, kind: true },
        })
      : null;
    if (input.parentId && !parent) throw DomainError.notFound('دسته والد');

    // درخت موضوع و درخت ژانر نباید در هم بروند
    const kind = input.kind ?? (parent?.kind) ?? 'SUBJECT';
    if (parent && parent.kind !== kind) {
      throw DomainError.validation({
        kind: ['نوع دسته باید با نوع دسته والد یکسان باشد.'],
      });
    }
    if ((parent?.depth ?? -1) + 1 > 6) {
      throw DomainError.validation({
        parentId: ['عمق درخت دسته‌بندی نمی‌تواند بیش از ۷ سطح باشد.'],
      });
    }

    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          name: input.name.trim(),
          parentId: input.parentId ?? null,
          kind,
          code: input.code?.trim() || null,
          colorHex: input.colorHex ?? null,
          description: input.description ?? null,
          sortOrder: input.sortOrder ?? 0,
          depth: parent ? parent.depth + 1 : 0,
        },
      });
      return tx.category.update({
        where: { id: created.id },
        data: { path: `${parent?.path ?? '.'}${created.id}.` },
      });
    });

    await this.audit.record({
      action: 'create', entityType: 'Category', entityId: category.id,
      entityLabel: category.name, user, ip,
    });
    return category;
  }

  /** جابه‌جایی دسته در درخت — `path` همه نوادگان بازسازی می‌شود. */
  async moveCategory(id: string, newParentId: string | null, user: AuthenticatedUser, ip?: string) {
    const node = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!node) throw DomainError.notFound('دسته');

    const newParent = newParentId
      ? await this.prisma.category.findFirst({ where: { id: newParentId, deletedAt: null } })
      : null;
    if (newParentId && !newParent) throw DomainError.notFound('دسته والد');

    if (newParentId === id || (newParent && newParent.path.includes(`.${id}.`))) {
      throw DomainError.validation({
        parentId: ['نمی‌توان یک دسته را زیرمجموعه خودش یا زیرمجموعه‌هایش قرار داد.'],
      });
    }

    const newPath = `${newParent?.path ?? '.'}${node.id}.`;
    const newDepth = newParent ? newParent.depth + 1 : 0;
    const shift = newDepth - node.depth;

    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id },
        data: { parentId: newParentId, path: newPath, depth: newDepth },
      });
      await tx.$executeRaw`
        UPDATE categories
           SET "path"  = ${newPath} || substring("path" from ${node.path.length + 1}),
               "depth" = "depth" + ${shift}
         WHERE "path" LIKE ${node.path + '%'} AND "id" <> ${id}
      `;
    });

    await this.audit.record({
      action: 'move', entityType: 'Category', entityId: id,
      entityLabel: node.name, newData: { parentId: newParentId }, user, ip,
    });

    return this.prisma.category.findUnique({ where: { id } });
  }

  async updateCategory(
    id: string,
    input: Partial<{ name: string; code: string | null; colorHex: string | null; description: string | null; sortOrder: number }>,
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const before = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw DomainError.notFound('دسته');

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        code: input.code === undefined ? undefined : input.code?.trim() || null,
        colorHex: input.colorHex === undefined ? undefined : input.colorHex,
        description: input.description === undefined ? undefined : input.description,
        sortOrder: input.sortOrder,
      },
    });

    await this.audit.recordUpdate({
      entityType: 'Category', entityId: id, entityLabel: before.name,
      before: before,
      after: input, user, ip,
    });
    return updated;
  }

  async deleteCategory(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const [category, childCount, bookCount] = await Promise.all([
      this.prisma.category.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } }),
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.bookCategory.count({ where: { categoryId: id } }),
    ]);
    if (!category) throw DomainError.notFound('دسته');

    if (childCount > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `«${category.name}» ${childCount} زیردسته دارد. ابتدا زیردسته‌ها را حذف یا جابه‌جا کنید.`,
      );
    }
    if (bookCount > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `${bookCount} کتاب در دسته «${category.name}» قرار دارند. ابتدا دسته آنها را تغییر دهید.`,
      );
    }

    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'delete', entityType: 'Category', entityId: id,
      entityLabel: category.name, user, ip,
    });
  }

  // ═══ مجموعه‌ها (Series) ════════════════════════════════════════════════

  async listSeries(query: { page?: number; pageSize?: number; q?: string }) {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.SeriesWhereInput = { deletedAt: null };
    if (query.q) {
      const normalized = persianNormalize(query.q);
      if (normalized) where.titleNormalized = { contains: normalized };
    }

    const [rows, total] = await Promise.all([
      this.prisma.series.findMany({
        where, skip, take,
        orderBy: { titleNormalized: 'asc' },
        select: {
          id: true, title: true, description: true, totalPlanned: true,
          _count: { select: { books: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.series.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, bookCount: r._count.books, _count: undefined })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findSeries(id: string) {
    const series = await this.prisma.series.findFirst({
      where: { id, deletedAt: null },
      include: {
        books: {
          where: { deletedAt: null },
          orderBy: [{ seriesOrder: 'asc' }, { publicationYear: 'asc' }],
          select: {
            id: true, title: true, seriesOrder: true, publicationYear: true, coverImageId: true,
            _count: { select: { copies: { where: { deletedAt: null } } } },
          },
        },
      },
    });
    if (!series) throw DomainError.notFound('مجموعه');
    return {
      ...series,
      books: series.books.map((b) => ({ ...b, copyCount: b._count.copies, _count: undefined })),
    };
  }

  async upsertSeries(
    id: string | null,
    input: { title: string; description?: string | null; totalPlanned?: number | null },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const data = {
      title: input.title.trim(),
      description: input.description ?? null,
      totalPlanned: input.totalPlanned ?? null,
    };
    const series = id
      ? await this.prisma.series.update({ where: { id }, data })
      : await this.prisma.series.create({ data });

    await this.audit.record({
      action: id ? 'update' : 'create', entityType: 'Series',
      entityId: series.id, entityLabel: series.title, user, ip,
    });
    return series;
  }

  async deleteSeries(id: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const series = await this.prisma.series.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, title: true, _count: { select: { books: { where: { deletedAt: null } } } } },
    });
    if (!series) throw DomainError.notFound('مجموعه');
    if (series._count.books > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `مجموعه «${series.title}» شامل ${series._count.books} کتاب است و قابل حذف نیست.`,
      );
    }
    await this.prisma.series.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'delete', entityType: 'Series', entityId: id, entityLabel: series.title, user, ip,
    });
  }

  // ═══ برچسب‌ها و اهداکنندگان ════════════════════════════════════════════

  async listTags(q?: string) {
    const where: Prisma.TagWhereInput = {};
    if (q) {
      const normalized = persianNormalize(q);
      if (normalized) where.nameNormalized = { contains: normalized };
    }
    const tags = await this.prisma.tag.findMany({
      where,
      take: 200,
      orderBy: { books: { _count: 'desc' } },
      select: { id: true, name: true, colorHex: true, _count: { select: { books: true } } },
    });
    return tags.map((t) => ({ ...t, bookCount: t._count.books, _count: undefined }));
  }

  async listDonors(query: { page?: number; pageSize?: number; q?: string }) {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where: Prisma.DonorWhereInput = { deletedAt: null };
    if (query.q) {
      const normalized = persianNormalize(query.q);
      if (normalized) where.nameNormalized = { contains: normalized };
    }

    const [rows, total] = await Promise.all([
      this.prisma.donor.findMany({
        where, skip, take,
        orderBy: { nameNormalized: 'asc' },
        select: {
          id: true, fullName: true, phone: true, email: true, note: true,
          _count: { select: { copies: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.donor.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({ ...r, donatedCount: r._count.copies, _count: undefined })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async upsertDonor(
    id: string | null,
    input: { fullName: string; phone?: string | null; email?: string | null; address?: string | null; note?: string | null },
    user: AuthenticatedUser,
    ip?: string,
  ) {
    const data = {
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address ?? null,
      note: input.note ?? null,
    };
    const donor = id
      ? await this.prisma.donor.update({ where: { id }, data })
      : await this.prisma.donor.create({ data });

    await this.audit.record({
      action: id ? 'update' : 'create', entityType: 'Donor',
      entityId: donor.id, entityLabel: donor.fullName, user, ip,
    });
    return donor;
  }
}
