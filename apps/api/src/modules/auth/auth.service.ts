import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES } from '@darin/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../common/errors/domain.error';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * پارامترهای Argon2id.
 * `argon2id` در برابر حملات GPU و کانال جانبی مقاوم است و توصیه فعلی OWASP
 * برای هش رمز عبور است. مقادیر زیر حدود ۵۰-۱۰۰ms روی سخت‌افزار معمول سرور
 * طول می‌کشند — به‌قدر کافی کند برای مهاجم، به‌قدر کافی سریع برای ورود کتابدار.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
}

interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    // `raw: false` صریح لازم است تا TypeScript سربار رشته‌ای را انتخاب کند
    // (با `raw: true` کتابخانه Buffer برمی‌گرداند).
    return argon2.hash(plain, { ...ARGON2_OPTIONS, raw: false });
  }

  async login(username: string, password: string, ctx: SessionContext): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { username: username.trim().toLowerCase(), deletedAt: null },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    // مقایسه با هش ساختگی وقتی کاربر وجود ندارد، تا زمان پاسخ برای نام کاربری
    // موجود و ناموجود یکسان بماند (جلوگیری از User Enumeration زمانی).
    if (!user) {
      await argon2.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3Wr1kGGKGZmSjRy0kZ4YCEE0MZ8SxVjXBBGBOFRlCXM',
        password,
      ).catch(() => false);
      throw new DomainError(ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new DomainError(
        ERROR_CODES.ACCOUNT_LOCKED,
        `به دلیل تلاش‌های ناموفق مکرر، حساب شما تا ${minutes} دقیقه دیگر قفل است.`,
      );
    }

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount, user.username, ctx);
      throw new DomainError(ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new DomainError(ERROR_CODES.ACCOUNT_DISABLED);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const principal = buildPrincipal(user);
    const tokens = await this.issueTokens(principal, randomUUID(), ctx);

    await this.audit.record({
      action: 'login',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.fullName,
      user: principal,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { user: principal, ...tokens, mustChangePassword: user.mustChangePassword };
  }

  /**
   * چرخش Refresh Token با تشخیص استفاده مجدد.
   *
   * هر Refresh Token فقط **یک بار** قابل استفاده است. اگر توکنی که قبلاً
   * مصرف شده دوباره ارائه شود، یعنی یا نسخه‌ای از آن دزدیده شده یا کاربر
   * توکن قدیمی را نگه داشته — در هر دو حالت کل خانواده توکن (تمام نشست‌های
   * زنجیره) باطل می‌شود. این الگوی استاندارد OAuth Refresh Token Rotation است.
   */
  async refresh(rawToken: string, ctx: SessionContext): Promise<LoginResult> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
        },
      },
    });

    if (!stored) throw new DomainError(ERROR_CODES.TOKEN_EXPIRED);

    if (stored.revokedAt) {
      // توکن باطل‌شده دوباره ارائه شد → کل خانواده را می‌بندیم.
      await this.revokeFamily(stored.familyId);
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId, ip: ctx.ip },
        'استفاده مجدد از Refresh Token باطل‌شده تشخیص داده شد؛ تمام نشست‌های این زنجیره بسته شد',
      );
      await this.audit.record({
        action: 'refresh_token_reuse_detected',
        entityType: 'User',
        entityId: stored.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new DomainError(ERROR_CODES.TOKEN_REUSE_DETECTED);
    }

    if (stored.expiresAt < new Date()) {
      throw new DomainError(ERROR_CODES.TOKEN_EXPIRED);
    }
    if (!stored.user.isActive || stored.user.deletedAt) {
      await this.revokeFamily(stored.familyId);
      throw new DomainError(ERROR_CODES.ACCOUNT_DISABLED);
    }

    // توکن فعلی مصرف شد؛ توکن بعدی در همان خانواده صادر می‌شود.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const principal = buildPrincipal(stored.user);
    const tokens = await this.issueTokens(principal, stored.familyId, ctx);
    return { user: principal, ...tokens, mustChangePassword: stored.user.mustChangePassword };
  }

  async logout(rawToken: string | undefined, user: AuthenticatedUser | undefined, ctx: SessionContext): Promise<void> {
    if (rawToken) {
      const stored = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      // خروج از یک دستگاه فقط همان زنجیره را می‌بندد، نه نشست‌های دیگر کاربر.
      if (stored) await this.revokeFamily(stored.familyId);
    }
    if (user) {
      await this.audit.record({
        action: 'logout',
        entityType: 'User',
        entityId: user.sub,
        entityLabel: user.fullName,
        user,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }

  /** خروج از تمام دستگاه‌ها — پس از تغییر رمز عبور اجباری است. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: SessionContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new DomainError(ERROR_CODES.INVALID_CREDENTIALS, 'رمز عبور فعلی نادرست است.');
    }

    const sameAsOld = await argon2.verify(user.passwordHash, newPassword).catch(() => false);
    if (sameAsOld) {
      throw DomainError.validation({
        newPassword: ['رمز عبور جدید نباید با رمز فعلی یکسان باشد.'],
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await AuthService.hashPassword(newPassword),
        mustChangePassword: false,
      },
    });

    // تغییر رمز باید تمام نشست‌های باز روی دستگاه‌های دیگر را ببندد.
    await this.revokeAllSessions(userId);

    await this.audit.record({
      action: 'change_password',
      entityType: 'User',
      entityId: userId,
      entityLabel: user.fullName,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /** پاک کردن توکن‌های منقضی — هر شب توسط Job نگهداری صدا زده می‌شود. */
  async pruneExpiredTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    });
    return result.count;
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  private async issueTokens(
    principal: AuthenticatedUser,
    familyId: string,
    ctx: SessionContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync(
      { ...principal, typ: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      },
    );

    // Refresh Token یک رشته تصادفی است، نه JWT: باطل کردنش نیازی به لیست سیاه
    // ندارد چون حذف ردیف از دیتابیس کافی است.
    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = parseDays(this.config.get<string>('JWT_REFRESH_TTL', '7d'));

    await this.prisma.refreshToken.create({
      data: {
        userId: principal.sub,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 400) ?? null,
      },
    });

    return { accessToken, refreshToken };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async registerFailedAttempt(
    userId: string,
    currentCount: number,
    username: string,
    ctx: SessionContext,
  ): Promise<void> {
    const next = currentCount + 1;
    const shouldLock = next >= MAX_FAILED_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn({ username, ip: ctx.ip }, `حساب پس از ${next} تلاش ناموفق قفل شد`);
      await this.audit.record({
        action: 'account_locked',
        entityType: 'User',
        entityId: userId,
        entityLabel: username,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }
}

type UserWithRoles = {
  id: string;
  username: string;
  fullName: string;
  branchId: string | null;
  roles: Array<{ role: { key: string; permissions: Array<{ permission: { key: string } }> } }>;
};

/** ساخت هویت کاربر برای درج در توکن. */
export function buildPrincipal(user: UserWithRoles): AuthenticatedUser {
  const roles = user.roles.map((r) => r.role.key);
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const permissions = isSuperAdmin
    ? [] // مدیر ارشد نیاز به فهرست ندارد؛ Guard او را میان‌بر می‌زند و توکن کوچک می‌ماند
    : [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)))];

  return {
    sub: user.id,
    username: user.username,
    fullName: user.fullName,
    branchId: user.branchId,
    roles,
    permissions,
    isSuperAdmin,
  };
}

/**
 * Refresh Token به‌صورت هش ذخیره می‌شود — اگر دیتابیس لو برود، توکن‌های خام
 * در دست مهاجم نیست. SHA-256 کافی است چون ورودی یک راز ۴۸ بایتی تصادفی است
 * (برخلاف رمز عبور که نیاز به هش کند دارد).
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** مقایسه زمان‌ثابت — برای مقایسه رازها در Setup Wizard. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseDays(ttl: string): number {
  const match = /^(\d+)([dhm])$/.exec(ttl);
  if (!match) return 7;
  const value = Number(match[1]);
  switch (match[2]) {
    case 'd': return value;
    case 'h': return value / 24;
    case 'm': return value / 1440;
    default: return 7;
  }
}
