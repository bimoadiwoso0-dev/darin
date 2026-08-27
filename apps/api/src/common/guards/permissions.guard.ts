import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, ERROR_CODES } from '@darin/shared';
import type { Request } from 'express';
import { DomainError } from '../errors/domain.error';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  type AuthenticatedUser,
} from '../decorators/auth.decorators';

const PERMISSION_LABELS = new Map(PERMISSIONS.map((p) => [p.key, p.label]));

/**
 * کنترل دسترسی ریزدانه (RBAC).
 *
 * پس از `JwtAuthGuard` اجرا می‌شود و مجوزهای درون توکن را با آنچه Endpoint
 * لازم دارد مقایسه می‌کند.
 *
 * پیام خطا **دقیقاً می‌گوید چه مجوزی کم است** — چون کاربران این سیستم
 * همکاران کتابخانه‌اند نه مهاجم ناشناس، و «شما دسترسی ندارید» بدون توضیح،
 * فقط باعث تماس با مدیر سیستم می‌شود.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Endpoint بدون @RequirePermissions فقط احراز هویت لازم دارد.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new DomainError(ERROR_CODES.UNAUTHORIZED);

    // مدیر ارشد بدون بررسی جزئی عبور می‌کند.
    if (user.isSuperAdmin) return true;

    const mode = this.reflector.getAllAndOverride<'all' | 'any'>(PERMISSIONS_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const held = new Set(user.permissions);
    const missing = required.filter((p) => !held.has(p));
    const allowed = mode === 'any' ? missing.length < required.length : missing.length === 0;

    if (!allowed) {
      const names = (mode === 'any' ? required : missing)
        .map((p) => PERMISSION_LABELS.get(p) ?? p)
        .join('، ');
      throw DomainError.forbidden(
        mode === 'any'
          ? `برای این عملیات باید یکی از دسترسی‌های «${names}» را داشته باشید.`
          : `برای این عملیات به دسترسی «${names}» نیاز دارید. با مدیر سیستم تماس بگیرید.`,
      );
    }
    return true;
  }
}
