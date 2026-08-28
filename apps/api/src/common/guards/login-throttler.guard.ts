import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

/**
 * محدودکننده نرخ ویژه مسیرهای ورود.
 *
 * ── چرا یک Guard جدا و نه `@Throttle` ────────────────────────────────────
 * دکوراتور `@Throttle` مقدارش را در زمان تعریف کلاس می‌گیرد، یعنی پیش از
 * آنکه `ConfigService` آماده باشد. نتیجه: عددی که در کد نوشته می‌شود ثابت
 * می‌ماند و متغیر `RATE_LIMIT_LOGIN_MAX` که در `.env.example` مستند شده،
 * هیچ اثری ندارد — دقیقاً همان «تنظیم تزئینی» که نباید وجود داشته باشد.
 *
 * این Guard سقف را در زمان اجرا از تنظیمات می‌خواند، پس مدیر سیستم
 * می‌تواند بدون تغییر کد آن را سخت‌گیرانه‌تر یا آزادتر کند.
 *
 * ── چرا سقف ورود جدا از بقیه API است ────────────────────────────────────
 * ۳۰۰ درخواست در دقیقه برای کار عادی کتابدار لازم است، اما همان عدد برای
 * صفحه ورود یعنی ۳۰۰ حدس رمز در دقیقه.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  // امضای `async` از کلاس پایه `ThrottlerGuard` می‌آید و قابل تغییر نیست
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    /*
     * ردیابی بر پایه IP **و** نام کاربری.
     *
     * فقط با IP، یک شبکه پشت NAT (مثل خود کتابخانه) به‌سرعت به سقف
     * می‌خورد و کتابداران بی‌دلیل قفل می‌شوند. فقط با نام کاربری هم،
     * مهاجم می‌تواند نام‌های مختلف را بی‌محدودیت امتحان کند.
     */
    const body = req['body'] as { username?: unknown } | undefined;
    const username =
      typeof body?.username === 'string' ? body.username.toLowerCase().slice(0, 60) : '';
    const ip = (req['ip'] as string | undefined) ?? 'unknown';
    return `login:${ip}:${username}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getThrottlerOptions(): Promise<{ limit: number; ttl: number }> {
    return {
      limit: this.config.get<number>('RATE_LIMIT_LOGIN_MAX', 10),
      ttl: this.config.get<number>('RATE_LIMIT_TTL', 60) * 1000,
    };
  }

  async handleRequest(requestProps: Parameters<ThrottlerGuard['handleRequest']>[0]) {
    const { limit, ttl } = await this.getThrottlerOptions();
    return super.handleRequest({ ...requestProps, limit, ttl });
  }

  /** بی‌اثر کردن سقف در محیط تست — وگرنه تست‌های احراز هویت خودشان قفل می‌شوند. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<string>('NODE_ENV') === 'test') return true;
    return super.canActivate(context);
  }
}
