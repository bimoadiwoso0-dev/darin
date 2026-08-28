import {
  Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ClientIp, CurrentUser, Public, type AuthenticatedUser } from '../../common/decorators/auth.decorators';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../common/guards/jwt-auth.guard';
import { LoginThrottlerGuard } from '../../common/guards/login-throttler.guard';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { DomainError } from '../../common/errors/domain.error';
import { ERROR_CODES } from '@darin/shared';
import { AuthService, type LoginResult } from './auth.service';

const LoginSchema = z.object({
  username: z.string().min(1, 'نام کاربری را وارد کنید.').max(60),
  password: z.string().min(1, 'رمز عبور را وارد کنید.').max(200),
  /** «مرا به خاطر بسپار» — عمر کوکی را طولانی‌تر می‌کند */
  rememberMe: z.boolean().optional().default(false),
  /*
   * حالت پیش‌فرض `cookie` است: توکن فقط در کوکی HttpOnly می‌نشیند.
   * کلاینت‌های بدون کوکی (اسکریپت، اپ موبایل) `bearer` می‌فرستند تا توکن
   * در بدنه پاسخ هم بیاید.
   */
  tokenMode: z.enum(['cookie', 'bearer']).optional().default('cookie'),
});

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'رمز عبور فعلی را وارد کنید.'),
    newPassword: z
      .string()
      .min(10, 'رمز عبور جدید باید حداقل ۱۰ نویسه باشد.')
      .max(200)
      .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
        message: 'رمز عبور باید شامل حرف و عدد باشد.',
      }),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'تکرار رمز عبور با رمز جدید یکسان نیست.',
  });

@ApiTags('احراز هویت')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  /*
   * محدودیت سخت‌گیرانه‌تر از بقیه API — دفاع در برابر حدس رمز عبور.
   * سقف از `RATE_LIMIT_LOGIN_MAX` خوانده می‌شود، نه از عددی ثابت در کد.
   */
  @UseGuards(LoginThrottlerGuard)
  @ApiOperation({ summary: 'ورود به سامانه' })
  async login(
    @Body(zodBody(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @ClientIp() ip: string,
  ) {
    const result = await this.auth.login(body.username, body.password, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, result, body.rememberMe);
    return this.publicResult(result, body.tokenMode === 'bearer');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تمدید نشست با Refresh Token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string,
  ) {
    const token = readRefreshToken(req);
    if (!token) throw new DomainError(ERROR_CODES.UNAUTHORIZED);

    try {
      const result = await this.auth.refresh(token, { ip, userAgent: req.headers['user-agent'] });
      this.setAuthCookies(res, result, true);
      return this.publicResult(result, readTokenMode(req) === 'bearer');
    } catch (err) {
      // نشست باطل شده — کوکی‌ها پاک می‌شوند تا مرورگر در حلقه تلاش نیفتد.
      this.clearAuthCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'خروج از سامانه' })
  async logout(
    @Req() req: Request & { user?: AuthenticatedUser },
    @Res({ passthrough: true }) res: Response,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.auth.logout(readRefreshToken(req), req.user, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    this.clearAuthCookies(res);
  }

  @Get('me')
  @ApiOperation({ summary: 'اطلاعات کاربر جاری' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تغییر رمز عبور خود کاربر' })
  async changePassword(
    @Body(zodBody(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @ClientIp() ip: string,
  ): Promise<void> {
    await this.auth.changePassword(user.sub, body.currentPassword, body.newPassword, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    // نشست فعلی هم باطل شده؛ کاربر باید دوباره وارد شود.
    this.clearAuthCookies(res);
  }

  // ── کوکی‌ها ────────────────────────────────────────────────────────────

  /**
   * توکن‌ها در کوکی `HttpOnly` قرار می‌گیرند تا JavaScript (و در نتیجه یک
   * حمله XSS) نتواند آنها را بخواند. `sameSite: 'lax'` جلوی CSRF روی
   * درخواست‌های حالت‌تغییردهنده را می‌گیرد و در عین حال ناوبری عادی کار می‌کند.
   */
  private setAuthCookies(res: Response, result: LoginResult, rememberMe: boolean): void {
    const secure = this.config.get<boolean>('COOKIE_SECURE', false);
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    const base = { httpOnly: true, secure, sameSite: 'lax' as const, domain, path: '/' };

    res.cookie(ACCESS_COOKIE, result.accessToken, { ...base, maxAge: 15 * 60_000 });
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...base,
      path: '/api/auth', // Refresh Token فقط به Endpoint های احراز هویت ارسال می‌شود
      maxAge: rememberMe ? 7 * 86_400_000 : 24 * 3_600_000,
    });
  }

  private clearAuthCookies(res: Response): void {
    const domain = this.config.get<string>('COOKIE_DOMAIN') || undefined;
    res.clearCookie(ACCESS_COOKIE, { domain, path: '/' });
    res.clearCookie(REFRESH_COOKIE, { domain, path: '/api/auth' });
  }

  /**
   * بدنه پاسخ ورود و تازه‌سازی.
   *
   * ── چرا توکن به‌صورت پیش‌فرض در بدنه نیست ──────────────────────────────
   * مرورگر توکن را از کوکی HttpOnly می‌گیرد و اصلاً به نسخه متنی آن نیاز
   * ندارد. برگرداندنش در بدنه فقط یک نسخه اضافه می‌سازد که در حافظه
   * صفحه، تب شبکه مرورگر و فایل‌های HAR که کاربر ممکن است برای پشتیبانی
   * بفرستد باقی می‌ماند.
   *
   * کلاینت‌های غیرمرورگری (اسکریپت، اپ موبایل) که کوکی نگه نمی‌دارند،
   * با `tokenMode: 'bearer'` صریحاً توکن را می‌خواهند و آن را در هدر
   * `Authorization` می‌فرستند.
   */
  private publicResult(result: LoginResult, includeToken = false) {
    return {
      user: result.user,
      mustChangePassword: result.mustChangePassword,
      ...(includeToken ? { accessToken: result.accessToken } : {}),
    };
  }
}

/**
 * تشخیص اینکه کلاینت توکن متنی می‌خواهد یا نه.
 * کلاینت‌های غیرمرورگری که با بدنه Refresh می‌کنند، همان‌جا هم اعلام
 * می‌کنند که پاسخ باید شامل توکن باشد.
 */
function readTokenMode(req: Request): string | undefined {
  const body = req.body as { tokenMode?: unknown } | undefined;
  return typeof body?.tokenMode === 'string' ? body.tokenMode : undefined;
}

function readRefreshToken(req: Request): string | undefined {
  /*
   * `cookie-parser` نوع `req.cookies` را در تعریف‌های Express به `any`
   * گسترش می‌دهد، و اشتراک با `any` باز هم `any` می‌شود. تبدیل از
   * `unknown` این را می‌شکند و شکل واقعی کوکی‌ها را تحمیل می‌کند.
   */
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;

  // مسیر اپ موبایل: توکن در بدنه ارسال می‌شود
  const body = req.body as { refreshToken?: unknown } | undefined;
  return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
}
