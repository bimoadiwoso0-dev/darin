import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildPageMeta, normalizePageQuery } from '@darin/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  userId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@ApiTags('گزارش فعالیت‌ها')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'فهرست فعالیت‌های کاربران' })
  async list(
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>,
  ) {
    const { page, pageSize, skip, take } = normalizePageQuery(query);
    const where = buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true, action: true, entityType: true, entityId: true, entityLabel: true,
          userLabel: true, userId: true, ip: true, createdAt: true,
          oldData: true, newData: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: rows, meta: buildPageMeta(page, pageSize, total) };
  }

  /**
   * فعالیت‌های خود کاربر جاری (قانون ۵۹).
   * بدون نیاز به مجوز `audit.view` — هر کاربری حق دارد کارهای خودش را ببیند.
   */
  @Get('mine')
  @ApiOperation({ summary: 'آخرین فعالیت‌های کاربر جاری' })
  async mine(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.auditLog.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, action: true, entityType: true, entityId: true,
        entityLabel: true, createdAt: true,
      },
    });
  }

  /** تاریخچه تغییرات یک موجودیت خاص — تب «تاریخچه» در صفحه کتاب و عضو. */
  @Get('entity')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'تاریخچه تغییرات یک رکورد' })
  async forEntity(
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>,
  ) {
    if (!query.entityType || !query.entityId) return [];
    return this.prisma.auditLog.findMany({
      where: { entityType: query.entityType, entityId: query.entityId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** فهرست مقادیر یکتای `action` — برای پر کردن فیلتر کشویی در UI. */
  @Get('actions')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'انواع فعالیت ثبت‌شده' })
  async actions() {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 60,
    });
    return rows.map((r) => ({ action: r.action, count: r._count.action }));
  }
}

function buildWhere(query: z.infer<typeof AuditQuerySchema>): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.userId) where.userId = query.userId;
  if (query.action) where.action = query.action;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }
  return where;
}
