import { Injectable } from '@nestjs/common';
import {
  buildPageMeta, normalizePageQuery, type Paginated,
} from '@darin/shared';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { NotificationListQuery } from './dto/notification.dto';

/**
 * صندوق یادآوری‌های کتابدار.
 *
 * ── چرا اعلان‌ها به کتابدار نشان داده می‌شوند، نه به عضو ─────────────────
 * کار شبانه نگهداری برای هر امانتِ نزدیک به موعد یک ردیف اعلان می‌سازد که
 * گیرنده‌اش «عضو» است. اما در این نسخه عضو حساب کاربری ندارد و نمی‌تواند
 * وارد شود (پنل اعضا در لایه دوم نقشه راه است). نتیجه این بود که این
 * ردیف‌ها ساخته می‌شدند و هیچ‌کس هرگز آنها را نمی‌دید.
 *
 * تا وقتی کانال پیامک و پنل عضو اضافه شود، این صندوق **فهرست کار کتابدار**
 * است: چه کسی را امروز باید یادآوری کرد، با شماره تماسش. وقتی کتابدار تماس
 * گرفت، ردیف را «انجام‌شده» علامت می‌زند.
 *
 * به همین دلیل پاسخ، اطلاعات تماس عضو را همراه دارد؛ بدون آن، اعلان برای
 * کتابدار بی‌فایده است.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: NotificationListQuery): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.pendingOnly ? { status: 'PENDING' as const } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true, type: true, status: true, channel: true,
          title: true, body: true, payload: true,
          createdAt: true, sentAt: true, readAt: true,
          member: {
            select: {
              id: true, memberCode: true, firstName: true, lastName: true,
              mobile: true, status: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        member: r.member
          ? {
              id: r.member.id,
              memberCode: r.member.memberCode,
              fullName: `${r.member.firstName} ${r.member.lastName}`.trim(),
              mobile: r.member.mobile,
              status: r.member.status,
            }
          : null,
      })),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  /** شمارش برای نشانه منو — یک کوئری گروهی، نه یکی به‌ازای هر نوع. */
  async summary(): Promise<{ pending: number; byType: Record<string, number> }> {
    const rows = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { status: 'PENDING' },
      _count: { _all: true },
    });

    return {
      pending: rows.reduce((sum, r) => sum + r._count._all, 0),
      byType: Object.fromEntries(rows.map((r) => [r.type, r._count._all])),
    };
  }

  /** «تماس گرفتم / پیام دادم» — ردیف از فهرست کار خارج می‌شود. */
  async markHandled(
    id: string,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      select: { id: true, status: true, title: true },
    });
    if (!existing) throw DomainError.notFound('اعلان');

    if (existing.status !== 'PENDING') {
      return { id: existing.id, status: existing.status };
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
      select: { id: true, status: true },
    });

    await this.audit.record({
      action: 'handle_notification',
      entityType: 'Notification',
      entityId: id,
      entityLabel: existing.title,
      oldData: { status: existing.status },
      newData: { status: 'SENT' },
      user, ip,
    });

    return updated;
  }

  /** انصراف از یادآوری — مثلاً وقتی کتاب همان روز برگشته است. */
  async dismiss(
    id: string,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      select: { id: true, status: true, title: true },
    });
    if (!existing) throw DomainError.notFound('اعلان');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'CANCELLED' },
      select: { id: true, status: true },
    });

    await this.audit.record({
      action: 'dismiss_notification',
      entityType: 'Notification',
      entityId: id,
      entityLabel: existing.title,
      oldData: { status: existing.status },
      newData: { status: 'CANCELLED' },
      user, ip,
    });

    return updated;
  }

  /**
   * علامت زدن گروهی یک نوع.
   *
   * وقتی کتابدار فهرست را چاپ کرده و همه را یک‌جا تماس گرفته، علامت زدن
   * تک‌تک ۸۰ ردیف کار بیهوده‌ای است.
   */
  async markAllHandled(
    type: string | undefined,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ updated: number }> {
    const where = {
      status: 'PENDING' as const,
      ...(type ? { type: type as never } : {}),
    };

    const result = await this.prisma.notification.updateMany({
      where,
      data: { status: 'SENT', sentAt: new Date() },
    });

    if (result.count > 0) {
      await this.audit.record({
        action: 'handle_notifications_bulk',
        entityType: 'Notification',
        entityLabel: `${result.count} یادآوری`,
        newData: { type: type ?? 'ALL', count: result.count },
        user, ip,
      });
    }

    return { updated: result.count };
  }
}
