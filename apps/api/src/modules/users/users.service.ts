import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  PERMISSIONS,
  buildPageMeta,
  normalizePageQuery,
  persianNormalize,
  type Paginated,
} from '@darin/shared';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { Prisma } from '../../generated/prisma/client';

export interface UserListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  roleId?: string;
  isActive?: boolean;
  includeDeleted?: boolean;
}

export interface UserInput {
  username: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  password?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
  branchId?: string | null;
  roleIds?: string[];
}

/** خلاصه نقش، همان شکلی که در `USER_SELECT` انتخاب می‌شود. */
interface RoleSummary {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
}

/** فیلدهای امن برای بازگرداندن — `passwordHash` هرگز از سرویس بیرون نمی‌رود. */
const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  failedLoginCount: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  branch: { select: { id: true, name: true } },
  roles: {
    select: { role: { select: { id: true, key: true, name: true, isSystem: true } } },
  },
} satisfies Prisma.UserSelect;

/**
 * مدیریت کاربران سامانه (قوانین ۵۶، ۵۷، ۱۱۰).
 *
 * ── تفاوت «کاربر» با «عضو» ───────────────────────────────────────────────
 * کاربر کسی است که وارد سامانه می‌شود و کار می‌کند (کتابدار، مدیر). عضو
 * کسی است که از کتابخانه کتاب امانت می‌گیرد. این دو موجودیت کاملاً جدا
 * هستند و هیچ کاربری صرفاً به‌خاطر عضو بودن، حساب ورود نمی‌گیرد.
 *
 * ── محافظت از آخرین مدیر ارشد ────────────────────────────────────────────
 * غیرفعال کردن، حذف یا برداشتن نقش مدیر ارشد از **آخرین** حساب دارای آن
 * نقش، سامانه را برای همیشه بی‌مدیر می‌کند و راه برگشتی ندارد. سرویس این
 * حالت را می‌بندد.
 *
 * ── رمز عبور هرگز بازگردانده نمی‌شود ─────────────────────────────────────
 * هیچ مسیری برای خواندن یا نمایش رمز وجود ندارد. مدیر فقط می‌تواند رمز
 * جدیدی **تعیین** کند و کاربر مجبور به تغییرش در اولین ورود می‌شود.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── کاربران ────────────────────────────────────────────────────────────

  async list(query: UserListQuery): Promise<Paginated<unknown>> {
    const { page, pageSize, skip, take } = normalizePageQuery(query);

    const where: Prisma.UserWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.roleId) where.roles = { some: { roleId: query.roleId } };

    if (query.q) {
      const raw = query.q.trim();
      const normalized = persianNormalize(raw);
      where.OR = [
        { username: { contains: raw, mode: 'insensitive' } },
        { email: { contains: raw, mode: 'insensitive' } },
        ...(normalized ? [{ fullName: { contains: raw, mode: 'insensitive' as const } }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(flattenRoles),
      meta: buildPageMeta(page, pageSize, total),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw DomainError.notFound('کاربر');

    // نشست‌های باز — مدیر باید بتواند ببیند حساب روی چند دستگاه فعال است
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
    });

    return { ...flattenRoles(user), sessions };
  }

  async create(input: UserInput, actor: AuthenticatedUser, ip?: string) {
    const username = input.username.trim().toLowerCase();
    await this.assertUsernameFree(username);

    if (!input.password || input.password.length < 10) {
      throw DomainError.validation({
        password: ['رمز عبور اولیه باید حداقل ۱۰ نویسه باشد.'],
      });
    }

    const roleIds = await this.resolveRoleIds(input.roleIds ?? []);
    const branchId = input.branchId ?? (await this.defaultBranchId());

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          fullName: input.fullName.trim(),
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          passwordHash: await AuthService.hashPassword(input.password!),
          isActive: input.isActive ?? true,
          // کاربر جدید رمزی دارد که مدیر تعیین کرده و مدیر آن را می‌داند؛
          // تا وقتی خودش عوضش نکند، رمز واقعاً خصوصی نیست.
          mustChangePassword: input.mustChangePassword ?? true,
          branchId,
        },
        select: USER_SELECT,
      });

      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: created.id, roleId })),
        });
      }
      return created;
    });

    await this.audit.record({
      action: 'create',
      entityType: 'User',
      entityId: user.id,
      entityLabel: `${input.fullName} (${username})`,
      newData: { username, fullName: input.fullName, roleIds },
      user: actor,
      ip,
    });

    this.logger.log(`کاربر جدید «${username}» ساخته شد`);
    return this.findOne(user.id);
  }

  async update(id: string, input: Partial<UserInput>, actor: AuthenticatedUser, ip?: string) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!before) throw DomainError.notFound('کاربر');

    if (input.username && input.username.trim().toLowerCase() !== before.username) {
      await this.assertUsernameFree(input.username.trim().toLowerCase(), id);
    }

    // غیرفعال کردن آخرین مدیر ارشد، سامانه را بی‌مدیر می‌کند
    if (input.isActive === false) {
      await this.assertNotLastSuperAdmin(id, 'غیرفعال کردن');
    }

    const roleIds = input.roleIds ? await this.resolveRoleIds(input.roleIds) : null;
    if (roleIds && !(await this.rolesIncludeSuperAdmin(roleIds))) {
      await this.assertNotLastSuperAdmin(id, 'برداشتن نقش مدیر ارشد از');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(input.username ? { username: input.username.trim().toLowerCase() } : {}),
          ...(input.fullName ? { fullName: input.fullName.trim() } : {}),
          ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
          ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        },
      });

      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (roleIds.length > 0) {
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({ userId: id, roleId })),
          });
        }
      }
    });

    // نقش عوض شده یعنی مجوزهای داخل توکن کهنه‌اند؛ نشست‌ها باید بسته شوند
    // تا کاربر با دسترسی قدیمی کار نکند.
    if (roleIds || input.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const after = await this.findOne(id);
    await this.audit.recordUpdate({
      entityType: 'User',
      entityId: id,
      entityLabel: before.fullName,
      before: { ...before, roles: before.roles.map((r) => r.role.key) } as never,
      after: { ...after, roles: after.roles.map((r) => r.key) } as never,
      user: actor,
      ip,
    });

    return after;
  }

  /**
   * تعیین رمز جدید توسط مدیر.
   * رمز فعلی پرسیده نمی‌شود (مدیر آن را نمی‌داند و نباید بداند)، اما کاربر
   * موظف به تغییر آن در اولین ورود می‌شود.
   */
  async resetPassword(
    id: string,
    newPassword: string,
    actor: AuthenticatedUser,
    ip?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, fullName: true },
    });
    if (!user) throw DomainError.notFound('کاربر');

    if (newPassword.length < 10) {
      throw DomainError.validation({ password: ['رمز عبور باید حداقل ۱۰ نویسه باشد.'] });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await AuthService.hashPassword(newPassword),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // تغییر رمط توسط مدیر باید همه نشست‌های باز کاربر را ببندد
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      action: 'password_reset',
      entityType: 'User',
      entityId: id,
      entityLabel: `${user.fullName} (${user.username})`,
      user: actor,
      ip,
    });
  }

  /** باز کردن قفل حساب پس از تلاش‌های ناموفق پیاپی. */
  async unlock(id: string, actor: AuthenticatedUser, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, fullName: true },
    });
    if (!user) throw DomainError.notFound('کاربر');

    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    await this.audit.record({
      action: 'unlock_user',
      entityType: 'User',
      entityId: id,
      entityLabel: `${user.fullName} (${user.username})`,
      user: actor,
      ip,
    });

    return this.findOne(id);
  }

  /** بستن همه نشست‌های باز یک کاربر (خروج اجباری از همه دستگاه‌ها). */
  async revokeSessions(id: string, actor: AuthenticatedUser, ip?: string) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'revoke_sessions',
      entityType: 'User',
      entityId: id,
      newData: { revoked: result.count },
      user: actor,
      ip,
    });

    return { revoked: result.count };
  }

  async remove(id: string, actor: AuthenticatedUser, ip?: string): Promise<void> {
    if (id === actor.sub) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'نمی‌توانید حساب کاربری خودتان را حذف کنید.',
      );
    }
    await this.assertNotLastSuperAdmin(id, 'حذف');

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, fullName: true, deletedAt: true },
    });
    if (!user) throw DomainError.notFound('کاربر');

    await this.prisma.$transaction(async (tx) => {
      // حذف نرم: تاریخچه فعالیت‌های این کاربر در گزارش‌ها باید بماند (قانون ۳۵)
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      action: 'delete',
      entityType: 'User',
      entityId: id,
      entityLabel: `${user.fullName} (${user.username})`,
      user: actor,
      ip,
    });
  }

  // ── نقش‌ها ─────────────────────────────────────────────────────────────

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.users,
      permissionKeys: role.permissions.map((p) => p.permission.key),
    }));
  }

  /** فهرست کامل مجوزها، گروه‌بندی‌شده — برای ساخت ماتریس دسترسی در UI. */
  async listPermissions() {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
      select: { id: true, key: true, group: true, label: true },
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = groups.get(row.group) ?? [];
      list.push(row);
      groups.set(row.group, list);
    }

    return [...groups.entries()].map(([group, permissions]) => ({
      group,
      label: PERMISSION_GROUP_LABELS[group] ?? group,
      permissions,
    }));
  }

  async createRole(
    input: { key: string; name: string; description?: string | null; permissionKeys: string[] },
    actor: AuthenticatedUser,
    ip?: string,
  ) {
    const key = input.key.trim().toUpperCase();
    const existing = await this.prisma.role.findUnique({ where: { key } });
    if (existing) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `نقشی با کلید «${key}» از قبل وجود دارد.`,
      );
    }

    const permissionIds = await this.resolvePermissionIds(input.permissionKeys);

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          key,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          isSystem: false,
        },
      });
      if (permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
        });
      }
      return created;
    });

    await this.audit.record({
      action: 'create',
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.name,
      newData: { key, permissionKeys: input.permissionKeys },
      user: actor,
      ip,
    });

    return role;
  }

  async updateRole(
    id: string,
    input: { name?: string; description?: string | null; permissionKeys?: string[] },
    actor: AuthenticatedUser,
    ip?: string,
  ) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw DomainError.notFound('نقش');

    /*
     * مجوزهای مدیر ارشد قابل تغییر نیستند.
     *
     * این نقش پشتوانه بازگشت سامانه است: اگر کسی به‌اشتباه مجوز
     * «مدیریت نقش‌ها» را از آن بردارد، دیگر هیچ‌کس نمی‌تواند آن را
     * برگرداند و سامانه برای همیشه قفل می‌شود.
     */
    if (role.key === 'SUPER_ADMIN' && input.permissionKeys) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'مجوزهای نقش «مدیر ارشد» قابل تغییر نیستند؛ این نقش همیشه دسترسی کامل دارد.',
      );
    }

    const permissionIds = input.permissionKeys
      ? await this.resolvePermissionIds(input.permissionKeys)
      : null;

    await this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.description !== undefined) {
        await tx.role.update({
          where: { id },
          data: {
            ...(input.name ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined
              ? { description: input.description?.trim() || null }
              : {}),
          },
        });
      }

      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          });
        }
      }
    });

    // مجوزهای نقش عوض شد ⇒ توکن هر کاربر دارای این نقش کهنه است
    if (permissionIds) {
      await this.prisma.refreshToken.updateMany({
        where: { user: { roles: { some: { roleId: id } } }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.recordUpdate({
      entityType: 'Role',
      entityId: id,
      entityLabel: role.name,
      before: { permissionKeys: role.permissions.map((p) => p.permission.key) },
      after: { permissionKeys: input.permissionKeys ?? role.permissions.map((p) => p.permission.key) },
      user: actor,
      ip,
    });

    return this.listRoles().then((roles) => roles.find((r) => r.id === id));
  }

  async removeRole(id: string, actor: AuthenticatedUser, ip?: string): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw DomainError.notFound('نقش');

    if (role.isSystem) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `«${role.name}» یک نقش سیستمی است و قابل حذف نیست. می‌توانید مجوزهایش را تغییر دهید.`,
      );
    }
    if (role._count.users > 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `${role._count.users} کاربر این نقش را دارند. ابتدا نقش دیگری برایشان تعیین کنید.`,
      );
    }

    await this.prisma.role.delete({ where: { id } });

    await this.audit.record({
      action: 'delete',
      entityType: 'Role',
      entityId: id,
      entityLabel: role.name,
      user: actor,
      ip,
    });
  }

  // ── کمکی‌های داخلی ─────────────────────────────────────────────────────

  private async assertUsernameFree(username: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { username, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      throw DomainError.validation({
        username: [
          existing.deletedAt
            ? 'این نام کاربری متعلق به حسابی بایگانی‌شده است و قابل استفاده مجدد نیست.'
            : 'این نام کاربری قبلاً استفاده شده است.',
        ],
      });
    }
  }

  /**
   * جلوگیری از بی‌مدیر شدن سامانه.
   * اگر این کاربر تنها مدیر ارشدِ فعالِ باقی‌مانده باشد، عملیات رد می‌شود.
   */
  private async assertNotLastSuperAdmin(userId: string, action: string): Promise<void> {
    const isSuperAdmin = await this.prisma.userRole.findFirst({
      where: { userId, role: { key: 'SUPER_ADMIN' } },
      select: { userId: true },
    });
    if (!isSuperAdmin) return;

    const others = await this.prisma.user.count({
      where: {
        id: { not: userId },
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
    });

    if (others === 0) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        `${action} تنها مدیر ارشد سامانه ممکن نیست. ابتدا کاربر دیگری را مدیر ارشد کنید.`,
      );
    }
  }

  private async rolesIncludeSuperAdmin(roleIds: string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const found = await this.prisma.role.findFirst({
      where: { id: { in: roleIds }, key: 'SUPER_ADMIN' },
      select: { id: true },
    });
    return !!found;
  }

  private async resolveRoleIds(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true },
    });
    if (roles.length !== roleIds.length) {
      throw DomainError.validation({ roleIds: ['یکی از نقش‌های انتخاب‌شده یافت نشد.'] });
    }
    return roles.map((r) => r.id);
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];

    const known = new Set<string>(PERMISSIONS.map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      throw DomainError.validation({
        permissionKeys: [`مجوز ناشناخته: ${unknown.join('، ')}`],
      });
    }

    const rows = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!branch) throw DomainError.notFound('شعبه پیش‌فرض');
    return branch.id;
  }
}

/** برچسب فارسی گروه‌های مجوز — برای ماتریس دسترسی در رابط کاربری. */
const PERMISSION_GROUP_LABELS: Record<string, string> = {
  catalog: 'کاتالوگ و کتاب‌ها',
  holdings: 'نسخه‌های فیزیکی',
  locations: 'مکان و قفسه',
  members: 'اعضا',
  circulation: 'امانت و بازگشت',
  finance: 'مالی و جریمه',
  reports: 'گزارش‌ها',
  operations: 'عملیات (شمارش، ورود اطلاعات، برچسب)',
  system: 'مدیریت سامانه',
};

/**
 * ساده کردن ساختار تودرتوی نقش‌ها برای مصرف در رابط کاربری.
 * `{ roles: [{ role: {...} }] }` به `{ roles: [{...}] }` تبدیل می‌شود.
 */
function flattenRoles<T extends { roles: Array<{ role: RoleSummary }> }>(user: T) {
  const { roles, ...rest } = user;
  return { ...rest, roles: roles.map((entry) => entry.role) };
}
