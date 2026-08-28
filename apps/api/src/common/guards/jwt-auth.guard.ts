import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@darin/shared';
import type { Request } from 'express';
import { DomainError } from '../errors/domain.error';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../decorators/auth.decorators';

export const ACCESS_COOKIE = 'darin_at';
export const REFRESH_COOKIE = 'darin_rt';

/**
 * احراز هویت.
 *
 * توکن از دو مسیر پذیرفته می‌شود:
 *  ۱. کوکی `HttpOnly` — مسیر رابط وب. چون JavaScript به آن دسترسی ندارد،
 *     یک آسیب‌پذیری XSS نمی‌تواند توکن را بدزدد.
 *  ۲. هدر `Authorization: Bearer` — مسیر اپ موبایل و سامانه‌های بیرونی آینده.
 *
 * مجوزها **داخل توکن** قرار می‌گیرند تا هر درخواست نیازمند کوئری دیتابیس نباشد.
 * هزینه‌اش این است که تغییر نقش یک کاربر تا انقضای Access Token (۱۵ دقیقه)
 * اعمال نمی‌شود؛ برای این سیستم پذیرفتنی است و در SECURITY.md ثبت شده.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractToken(request);
    if (!token) {
      throw new DomainError(ERROR_CODES.UNAUTHORIZED);
    }

    try {
      const payload = await this.jwt.verifyAsync<AuthenticatedUser & { typ?: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      // یک Refresh Token نباید به‌جای Access Token پذیرفته شود.
      if (payload.typ !== 'access') {
        throw new DomainError(ERROR_CODES.UNAUTHORIZED);
      }

      request.user = {
        sub: payload.sub,
        username: payload.username,
        fullName: payload.fullName,
        branchId: payload.branchId ?? null,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        isSuperAdmin: payload.isSuperAdmin === true,
      };
      return true;
    } catch (err) {
      if (err instanceof DomainError) throw err;
      const isExpired = err instanceof Error && err.name === 'TokenExpiredError';
      throw new DomainError(isExpired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.UNAUTHORIZED);
    }
  }
}

function extractToken(request: Request): string | null {
  /*
   * `cookie-parser` نوع `req.cookies` را در تعریف‌های Express به `any`
   * گسترش می‌دهد، و اشتراک با `any` باز هم `any` می‌شود. تبدیل از
   * `unknown` این را می‌شکند و شکل واقعی کوکی‌ها را تحمیل می‌کند.
   */
  const cookies = (request as unknown as { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;

  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}
