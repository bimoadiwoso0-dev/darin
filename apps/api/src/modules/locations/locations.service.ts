import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  LOCATION_KIND_ORDER,
  persianNormalize,
  type LocationKind,
} from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface CreateLocationInput {
  branchId?: string;
  parentId: string | null;
  kind: LocationKind;
  name: string;
  code: string;
  capacity?: number | null;
  sortOrder?: number;
  note?: string | null;
}

export interface LocationNode {
  id: string;
  parentId: string | null;
  kind: LocationKind;
  name: string;
  code: string;
  fullCode: string;
  depth: number;
  capacity: number | null;
  sortOrder: number;
  qrToken: string;
  copyCount: number;
  children: LocationNode[];
}

export interface ShelfOccupancy {
  id: string;
  name: string;
  fullCode: string;
  kind: LocationKind;
  capacity: number | null;
  occupied: number;
  available: number | null;
  /** درصد پرشدگی — برای رنگ‌بندی نقشه قفسه */
  utilization: number | null;
}

/**
 * مدیریت درخت مکان (ADR-03).
 *
 * ── چرا Materialized Path ──────────────────────────────────────────────
 * سؤال پرتکرار سیستم «همه کتاب‌های بخش ادبیات کدام‌اند؟» است. با درخت
 * والد-فرزندی ساده، پاسخ نیازمند پیمایش بازگشتی یا `WITH RECURSIVE` است.
 * با ستون `path` (مثل `.a1.b3.c7.`) همان سؤال یک `LIKE '.a1.b3.%'` روی
 * ایندکس `text_pattern_ops` است — در ۵۰۰٬۰۰۰ نسخه هم زیر ۱۰ms.
 *
 * هزینه: جابه‌جایی یک زیردرخت باید `path` همه نوادگان را به‌روز کند. چون
 * جابه‌جایی قفسه عملیات نادری است (برخلاف جستجو که هزاران بار در روز است)،
 * این معامله به‌صرفه است.
 */
@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateLocationInput, userId?: string): Promise<LocationNode> {
    const branchId = input.branchId ?? (await this.defaultBranchId());
    const parent = input.parentId
      ? await this.prisma.location.findFirst({
          where: { id: input.parentId, deletedAt: null },
        })
      : null;

    if (input.parentId && !parent) throw DomainError.notFound('مکان والد');
    this.assertValidHierarchy(parent?.kind ?? null, input.kind);

    const code = input.code.trim().toUpperCase();
    const fullCode = parent ? `${parent.fullCode}-${code}` : code;

    const duplicate = await this.prisma.location.findFirst({
      where: { branchId, fullCode, deletedAt: null },
      select: { id: true },
    });
    if (duplicate) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `مکانی با کد «${fullCode}» از قبل وجود دارد.`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const node = await tx.location.create({
        data: {
          branchId,
          parentId: input.parentId,
          kind: input.kind,
          name: input.name.trim(),
          code,
          fullCode,
          depth: parent ? parent.depth + 1 : 0,
          capacity: input.capacity ?? null,
          sortOrder: input.sortOrder ?? 0,
          note: input.note ?? null,
        },
      });
      // `path` فقط پس از ساخته شدن رکورد قابل محاسبه است (به id خودش نیاز دارد)
      return tx.location.update({
        where: { id: node.id },
        data: { path: `${parent?.path ?? '.'}${node.id}.` },
      });
    });

    void userId;
    return this.toNode(created, 0, []);
  }

  async update(
    id: string,
    input: Partial<Pick<CreateLocationInput, 'name' | 'code' | 'capacity' | 'sortOrder' | 'note'>>,
  ): Promise<LocationNode> {
    const existing = await this.prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw DomainError.notFound('مکان');

    const codeChanged = input.code !== undefined && input.code.trim().toUpperCase() !== existing.code;

    if (!codeChanged) {
      const updated = await this.prisma.location.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          capacity: input.capacity === undefined ? undefined : input.capacity,
          sortOrder: input.sortOrder,
          note: input.note === undefined ? undefined : input.note,
        },
      });
      return this.toNode(updated, 0, []);
    }

    // تغییر کد → `fullCode` این گره و **تمام نوادگانش** باید بازسازی شود،
    // چون کد کامل روی برچسب کتاب‌ها چاپ می‌شود و باید همیشه درست باشد.
    const newCode = input.code!.trim().toUpperCase();
    const parent = existing.parentId
      ? await this.prisma.location.findUnique({ where: { id: existing.parentId } })
      : null;
    const newFullCode = parent ? `${parent.fullCode}-${newCode}` : newCode;

    const clash = await this.prisma.location.findFirst({
      where: { branchId: existing.branchId, fullCode: newFullCode, id: { not: id }, deletedAt: null },
      select: { id: true },
    });
    if (clash) {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, `کد «${newFullCode}» قبلاً استفاده شده است.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const node = await tx.location.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          code: newCode,
          fullCode: newFullCode,
          capacity: input.capacity === undefined ? undefined : input.capacity,
          sortOrder: input.sortOrder,
          note: input.note === undefined ? undefined : input.note,
        },
      });
      await this.rebuildDescendantCodes(tx, node.id, existing.fullCode, newFullCode);
      return node;
    });

    return this.toNode(updated, 0, []);
  }

  /** جابه‌جایی یک زیردرخت زیر والد جدید. */
  async move(id: string, newParentId: string | null): Promise<LocationNode> {
    const node = await this.prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!node) throw DomainError.notFound('مکان');

    const newParent = newParentId
      ? await this.prisma.location.findFirst({ where: { id: newParentId, deletedAt: null } })
      : null;
    if (newParentId && !newParent) throw DomainError.notFound('مکان والد جدید');

    // جلوگیری از چرخه: نمی‌توان یک گره را زیر نوه خودش برد
    if (newParent && newParent.path.includes(`.${id}.`)) {
      throw new DomainError(ERROR_CODES.CIRCULAR_LOCATION);
    }
    if (newParentId === id) throw new DomainError(ERROR_CODES.CIRCULAR_LOCATION);

    this.assertValidHierarchy(newParent?.kind ?? null, node.kind);

    const newFullCode = newParent ? `${newParent.fullCode}-${node.code}` : node.code;
    const newPath = `${newParent?.path ?? '.'}${node.id}.`;
    const newDepth = newParent ? newParent.depth + 1 : 0;
    const depthShift = newDepth - node.depth;

    const updated = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.location.update({
        where: { id },
        data: { parentId: newParentId, fullCode: newFullCode, path: newPath, depth: newDepth },
      });

      // نوادگان: path، fullCode و depth همگی با یک UPDATE بازنویسی می‌شوند
      await tx.$executeRaw`
        UPDATE locations
           SET "path"     = ${newPath} || substring("path" from ${node.path.length + 1}),
               "fullCode" = ${newFullCode} || substring("fullCode" from ${node.fullCode.length + 1}),
               "depth"    = "depth" + ${depthShift}
         WHERE "path" LIKE ${node.path + '%'} AND "id" <> ${id}
      `;
      return moved;
    });

    return this.toNode(updated, 0, []);
  }

  /**
   * حذف مکان.
   * مکانی که کتاب یا زیرمجموعه دارد حذف نمی‌شود — در غیر این صورت نسخه‌ها
   * «بی‌مکان» می‌شدند و کتابدار نمی‌دانست کجا دنبالشان بگردد.
   */
  async remove(id: string): Promise<void> {
    const [childCount, copyCount] = await Promise.all([
      this.prisma.location.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.bookCopy.count({ where: { locationId: id, deletedAt: null } }),
    ]);

    if (childCount > 0 || copyCount > 0) {
      throw new DomainError(
        ERROR_CODES.LOCATION_NOT_EMPTY,
        copyCount > 0
          ? `این مکان ${copyCount} نسخه کتاب دارد. ابتدا کتاب‌ها را به مکان دیگری منتقل کنید.`
          : `این مکان ${childCount} زیرمجموعه دارد. ابتدا زیرمجموعه‌ها را حذف کنید.`,
      );
    }

    await this.prisma.location.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * درخت کامل مکان‌ها با تعداد نسخه هر گره.
   *
   * تعداد نسخه‌ها با **یک** کوئری گروهی محاسبه می‌شود، نه یک کوئری به‌ازای
   * هر گره (جلوگیری از N+1 — قانون ۵۶).
   */
  async tree(branchId?: string, kindFilter?: LocationKind[]): Promise<LocationNode[]> {
    const branch = branchId ?? (await this.defaultBranchId());

    const [nodes, counts] = await Promise.all([
      this.prisma.location.findMany({
        where: {
          branchId: branch,
          deletedAt: null,
          ...(kindFilter?.length ? { kind: { in: kindFilter } } : {}),
        },
        orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.bookCopy.groupBy({
        by: ['locationId'],
        where: { branchId: branch, deletedAt: null, locationId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const countByLocation = new Map(
      counts.map((c) => [c.locationId as string, c._count._all]),
    );

    const byId = new Map<string, LocationNode>();
    const roots: LocationNode[] = [];

    for (const n of nodes) {
      byId.set(n.id, this.toNode(n, countByLocation.get(n.id) ?? 0, []));
    }
    for (const n of nodes) {
      const node = byId.get(n.id)!;
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // تعداد نسخه هر گره = نسخه‌های خودش + همه نوادگانش
    // (کتابدار می‌خواهد بداند «بخش ادبیات» چند جلد دارد، نه فقط گره برگ)
    const rollUp = (node: LocationNode): number => {
      const total = node.copyCount + node.children.reduce((sum, c) => sum + rollUp(c), 0);
      node.copyCount = total;
      return total;
    };
    roots.forEach(rollUp);

    return roots;
  }

  /** فهرست تخت مکان‌ها — برای کشوی انتخاب مکان در فرم‌ها. */
  async flatList(branchId?: string, kinds?: LocationKind[]) {
    const branch = branchId ?? (await this.defaultBranchId());
    return this.prisma.location.findMany({
      where: {
        branchId: branch,
        deletedAt: null,
        isActive: true,
        ...(kinds?.length ? { kind: { in: kinds } } : {}),
      },
      select: { id: true, name: true, fullCode: true, kind: true, depth: true, capacity: true },
      orderBy: [{ fullCode: 'asc' }],
    });
  }

  /**
   * وضعیت اشغال قفسه‌ها (قانون ۱۰).
   * برای هر قفسه: ظرفیت، تعداد اشغال‌شده و فضای خالی.
   */
  async occupancy(parentId?: string, branchId?: string): Promise<ShelfOccupancy[]> {
    const branch = branchId ?? (await this.defaultBranchId());

    let pathPrefix = '';
    if (parentId) {
      const parent = await this.prisma.location.findFirst({
        where: { id: parentId, deletedAt: null },
        select: { path: true },
      });
      if (!parent) throw DomainError.notFound('مکان');
      pathPrefix = parent.path;
    }

    // نسخه‌ها به گره برگ (طبقه قفسه) وصل‌اند؛ برای شمارش اشغال یک قفسه باید
    // نسخه‌های همه طبقاتش جمع شوند — این کار با LIKE روی path انجام می‌شود.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string; name: string; fullCode: string; kind: LocationKind;
        capacity: number | null; occupied: bigint;
      }>
    >`
      SELECT l."id", l."name", l."fullCode", l."kind", l."capacity",
             coalesce(count(c."id"), 0) AS occupied
        FROM locations l
        LEFT JOIN locations d
               ON d."path" LIKE l."path" || '%' AND d."deletedAt" IS NULL
        LEFT JOIN book_copies c
               ON c."locationId" = d."id" AND c."deletedAt" IS NULL
       WHERE l."branchId" = ${branch}::uuid
         AND l."deletedAt" IS NULL
         AND l."kind" IN ('SHELF', 'SHELF_LEVEL')
         ${pathPrefix ? Prisma.sql`AND l."path" LIKE ${pathPrefix + '%'}` : Prisma.empty}
       GROUP BY l."id", l."name", l."fullCode", l."kind", l."capacity"
       ORDER BY l."fullCode"
    `;

    return rows.map((r) => {
      const occupied = Number(r.occupied);
      return {
        id: r.id,
        name: r.name,
        fullCode: r.fullCode,
        kind: r.kind,
        capacity: r.capacity,
        occupied,
        available: r.capacity === null ? null : Math.max(0, r.capacity - occupied),
        utilization: r.capacity ? Math.round((occupied / r.capacity) * 100) : null,
      };
    });
  }

  /** یک مکان با نسخه‌های داخلش — صفحه «مشاهده قفسه». */
  async findOne(id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, deletedAt: null },
      include: {
        parent: { select: { id: true, name: true, fullCode: true, kind: true } },
        children: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          select: { id: true, name: true, code: true, fullCode: true, kind: true, capacity: true },
        },
      },
    });
    if (!location) throw DomainError.notFound('مکان');

    const [copyCount, ancestors] = await Promise.all([
      this.prisma.bookCopy.count({ where: { locationId: id, deletedAt: null } }),
      this.ancestors(location.path, id),
    ]);

    return {
      ...location,
      copyCount,
      breadcrumb: ancestors,
      available: location.capacity === null ? null : Math.max(0, location.capacity - copyCount),
    };
  }

  /** یافتن مکان از روی توکن QR — اسکن QR قفسه صفحه‌اش را باز می‌کند (قانون ۸۳). */
  async findByQrToken(qrToken: string) {
    const location = await this.prisma.location.findFirst({
      where: { qrToken, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw DomainError.notFound('قفسه');
    return this.findOne(location.id);
  }

  /** زنجیره والدین — برای Breadcrumb. */
  async ancestors(path: string, excludeId?: string) {
    // path به شکل `.id1.id2.id3.` است
    const ids = path.split('.').filter((s) => s.length > 0 && s !== excludeId);
    if (ids.length === 0) return [];
    const rows = await this.prisma.location.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, fullCode: true, kind: true, depth: true },
      orderBy: { depth: 'asc' },
    });
    return rows;
  }

  /** جستجوی سریع مکان با نام یا کد — برای فیلد انتخاب مکان. */
  async search(query: string, branchId?: string, limit = 20) {
    const branch = branchId ?? (await this.defaultBranchId());
    const normalized = persianNormalize(query);
    if (!normalized) return [];

    return this.prisma.location.findMany({
      where: {
        branchId: branch,
        deletedAt: null,
        isActive: true,
        OR: [
          { nameNormalized: { contains: normalized } },
          { fullCode: { contains: query.toUpperCase() } },
        ],
      },
      select: { id: true, name: true, fullCode: true, kind: true, capacity: true },
      take: limit,
      orderBy: { fullCode: 'asc' },
    });
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  /**
   * نوع مکان باید از والدش «پایین‌تر» باشد.
   * قفسه نمی‌تواند مستقیم زیر ساختمان باشد؟ **می‌تواند** — سطوح میانی
   * اختیاری‌اند. تنها چیزی که ممنوع است، معکوس بودن ترتیب است
   * (مثلاً ساختمان زیر قفسه).
   */
  private assertValidHierarchy(parentKind: LocationKind | null, childKind: LocationKind): void {
    if (parentKind === null) {
      // ریشه باید ساختمان باشد تا درخت معنی داشته باشد
      if (childKind !== 'BUILDING') {
        throw new DomainError(
          ERROR_CODES.INVALID_LOCATION_HIERARCHY,
          'بالاترین سطح مکان باید «ساختمان» باشد.',
        );
      }
      return;
    }

    const parentRank = LOCATION_KIND_ORDER.indexOf(parentKind);
    const childRank = LOCATION_KIND_ORDER.indexOf(childKind);
    if (childRank <= parentRank) {
      throw new DomainError(
        ERROR_CODES.INVALID_LOCATION_HIERARCHY,
        `نمی‌توان «${labelOf(childKind)}» را زیرمجموعه «${labelOf(parentKind)}» تعریف کرد.`,
      );
    }
  }

  private async rebuildDescendantCodes(
    tx: Prisma.TransactionClient,
    id: string,
    oldFullCode: string,
    newFullCode: string,
  ): Promise<void> {
    const node = await tx.location.findUniqueOrThrow({
      where: { id },
      select: { path: true },
    });
    await tx.$executeRaw`
      UPDATE locations
         SET "fullCode" = ${newFullCode} || substring("fullCode" from ${oldFullCode.length + 1})
       WHERE "path" LIKE ${node.path + '%'} AND "id" <> ${id}
    `;
  }

  private async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!branch) {
      throw new DomainError(ERROR_CODES.SETUP_REQUIRED, 'شعبه پیش‌فرض تعریف نشده است.');
    }
    return branch.id;
  }

  private toNode(
    row: {
      id: string; parentId: string | null; kind: string; name: string; code: string;
      fullCode: string; depth: number; capacity: number | null; sortOrder: number; qrToken: string;
    },
    copyCount: number,
    children: LocationNode[],
  ): LocationNode {
    return {
      id: row.id,
      parentId: row.parentId,
      kind: row.kind as LocationKind,
      name: row.name,
      code: row.code,
      fullCode: row.fullCode,
      depth: row.depth,
      capacity: row.capacity,
      sortOrder: row.sortOrder,
      qrToken: row.qrToken,
      copyCount,
      children,
    };
  }
}

function labelOf(kind: LocationKind): string {
  const labels: Record<LocationKind, string> = {
    BUILDING: 'ساختمان', FLOOR: 'طبقه', SECTION: 'بخش', ROOM: 'اتاق',
    AISLE: 'راهرو', SHELF: 'قفسه', SHELF_LEVEL: 'طبقه قفسه', POSITION: 'موقعیت',
  };
  return labels[kind];
}
