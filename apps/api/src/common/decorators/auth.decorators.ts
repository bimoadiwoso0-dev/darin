import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PermissionKey } from '@darin/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'darin:isPublic';
export const PERMISSIONS_KEY = 'darin:permissions';
export const PERMISSIONS_MODE_KEY = 'darin:permissionsMode';
export const AUDIT_KEY = 'darin:audit';

/**
 * این Endpoint بدون احراز هویت قابل دسترسی است.
 * فقط برای ورود، Health Check، Setup Wizard و کاتالوگ عمومی آینده.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * مجوزهای لازم برای این Endpoint. به‌صورت پیش‌فرض کاربر باید **همه** آنها را
 * داشته باشد.
 *
 *   @RequirePermissions('books.create')
 *   @RequirePermissions('loans.create', 'members.view')
 */
export const RequirePermissions = (
  ...permissions: PermissionKey[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/** داشتن **یکی** از مجوزها کافی است (مثلاً «مشاهده» یا «مدیریت»). */
export const RequireAnyPermission = (
  ...permissions: PermissionKey[]
): MethodDecorator & ClassDecorator => {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key as string, descriptor as PropertyDescriptor);
    SetMetadata(PERMISSIONS_MODE_KEY, 'any')(target, key as string, descriptor as PropertyDescriptor);
  };
};

export interface AuthenticatedUser {
  /** شناسه کاربر */
  sub: string;
  username: string;
  fullName: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

/** کاربر جاری از روی توکن. `@CurrentUser() user: AuthenticatedUser` */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/** IP واقعی کاربر با در نظر گرفتن Reverse Proxy — برای Audit Log. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
});
