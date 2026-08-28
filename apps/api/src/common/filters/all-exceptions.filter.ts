import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES, ERROR_MESSAGES_FA, type ApiErrorBody } from '@darin/shared';
import type { Request, Response } from 'express';
import { DomainError } from '../errors/domain.error';

/**
 * تنها جایی که خطا به پاسخ HTTP تبدیل می‌شود.
 *
 * قرارداد امنیتی (قانون ۷۵): کاربر **هرگز** Stack Trace، نام جدول، متن SQL یا
 * پیام خام دیتابیس نمی‌بیند. جزئیات فنی فقط در Log سرور ثبت می‌شود و کاربر
 * یک پیام فارسی قابل فهم به‌همراه `requestId` دریافت می‌کند تا در صورت تماس
 * با پشتیبانی، خطای مربوطه در لاگ پیدا شود.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as { id?: string }).id ?? undefined;

    const { status, body, logLevel } = this.translate(exception, requestId);

    // ورودی کاربر ممکن است رمز عبور یا توکن باشد — هرگز لاگ نمی‌شود.
    const logContext = {
      requestId,
      method: request.method,
      path: request.url,
      status,
      code: body.code,
      userId: (request as { user?: { sub?: string } }).user?.sub,
    };

    if (logLevel === 'error') {
      this.logger.error(
        { ...logContext, err: exception },
        `${request.method} ${request.url} → ${status}`,
      );
    } else {
      this.logger.warn(logContext, `${request.method} ${request.url} → ${status} (${body.code})`);
    }

    response.status(status).json(body);
  }

  private translate(
    exception: unknown,
    requestId?: string,
  ): { status: number; body: ApiErrorBody; logLevel: 'warn' | 'error' } {
    // ── خطای دامنه‌ای: پیام فارسی از قبل آماده است ──────────────────────
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        body: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
        // خطای دامنه‌ای رفتار مورد انتظار سیستم است، نه نقص نرم‌افزار
        logLevel: exception.httpStatus >= 500 ? 'error' : 'warn',
      };
    }

    // ── خطاهای شناخته‌شده Prisma ────────────────────────────────────────
    const prismaBody = this.translatePrisma(exception, requestId);
    if (prismaBody) return prismaBody;

    // ── HttpException های خود NestJS ────────────────────────────────────
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null && 'message' in res
          ? this.messageForStatus(status, (res).message)
          : this.messageForStatus(status);

      return {
        status,
        body: { code: this.codeForStatus(status), message, requestId },
        logLevel: status >= 500 ? 'error' : 'warn',
      };
    }

    // ── هر چیز دیگری: نقص واقعی نرم‌افزار ────────────────────────────────
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL,
        message: ERROR_MESSAGES_FA.INTERNAL,
        requestId,
      },
      logLevel: 'error',
    };
  }

  /**
   * تبدیل خطای Prisma به پیام فارسی.
   *
   * مهم: نام محدودیت دیتابیس (مثل `book_copies_barcode_key`) هرگز به کاربر
   * نشان داده نمی‌شود؛ فقط برای انتخاب پیام درست استفاده می‌شود.
   */
  private translatePrisma(
    exception: unknown,
    requestId?: string,
  ): { status: number; body: ApiErrorBody; logLevel: 'warn' | 'error' } | null {
    if (
      typeof exception !== 'object' ||
      exception === null ||
      !('code' in exception) ||
      typeof (exception).code !== 'string'
    ) {
      return null;
    }

    const err = exception as { code: string; meta?: Record<string, unknown> };
    if (!err.code.startsWith('P')) return null;

    const target = this.constraintName(err.meta);

    switch (err.code) {
      case 'P2002': {
        // نقض یکتایی — پیام دقیق بر اساس محدودیتی که نقض شده
        const map: Array<[RegExp, keyof typeof ERROR_MESSAGES_FA]> = [
          [/barcode/i, 'DUPLICATE_BARCODE'],
          [/accession/i, 'DUPLICATE_ACCESSION_NUMBER'],
          [/asset/i, 'DUPLICATE_ASSET_NUMBER'],
          [/memberCode|member_code/i, 'DUPLICATE_MEMBER_CODE'],
          [/nationalId|national_id/i, 'DUPLICATE_NATIONAL_ID'],
          [/loans_one_open_per_copy/i, 'COPY_NOT_AVAILABLE'],
          [/reservations_one_active/i, 'ALREADY_RESERVED'],
        ];
        const hit = map.find(([re]) => re.test(target));
        const code = hit ? hit[1] : ERROR_CODES.CONFLICT;
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code,
            message: ERROR_MESSAGES_FA[code],
            requestId,
          },
          logLevel: 'warn',
        };
      }

      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ERROR_CODES.CONFLICT,
            message:
              'این عملیات به دلیل وابستگی به رکوردهای دیگر انجام نشد. ابتدا موارد مرتبط را بررسی کنید.',
            requestId,
          },
          logLevel: 'warn',
        };

      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            code: ERROR_CODES.NOT_FOUND,
            message: ERROR_MESSAGES_FA.NOT_FOUND,
            requestId,
          },
          logLevel: 'warn',
        };

      // P2034 = خطای Serialization در تراکنش (تداخل همروندی)
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ERROR_CODES.CONFLICT,
            message:
              'به دلیل انجام هم‌زمان عملیات مشابه توسط کاربر دیگر، این درخواست انجام نشد. لطفاً دوباره تلاش کنید.',
            requestId,
          },
          logLevel: 'warn',
        };

      default:
        return null;
    }
  }

  private constraintName(meta?: Record<string, unknown>): string {
    if (!meta) return '';
    const t = meta['target'] ?? meta['constraint'];
    if (Array.isArray(t)) return t.join(',');
    return typeof t === 'string' ? t : '';
  }

  /*
   * پارامتر از نوع `HttpStatus` است نه `number`: مقدارها همان ثابت‌های
   * وضعیت HTTP هستند و اعلام صریحش هم خودتوضیح است و هم جلوی مقایسه
   * تصادفی با عدد دلخواه را می‌گیرد.
   */
  private codeForStatus(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED: return ERROR_CODES.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN: return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND: return ERROR_CODES.NOT_FOUND;
      case HttpStatus.BAD_REQUEST: return ERROR_CODES.VALIDATION_FAILED;
      case HttpStatus.TOO_MANY_REQUESTS: return ERROR_CODES.RATE_LIMITED;
      case HttpStatus.PAYLOAD_TOO_LARGE: return ERROR_CODES.FILE_TOO_LARGE;
      case HttpStatus.CONFLICT: return ERROR_CODES.CONFLICT;
      default: return ERROR_CODES.INTERNAL;
    }
  }

  private messageForStatus(status: HttpStatus, raw?: unknown): string {
    // پیام‌های انگلیسی داخلی NestJS ("Cannot POST /x") به کاربر نمایش داده نمی‌شود.
    switch (status) {
      case HttpStatus.UNAUTHORIZED: return ERROR_MESSAGES_FA.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN: return ERROR_MESSAGES_FA.FORBIDDEN;
      case HttpStatus.NOT_FOUND: return 'آدرس درخواستی وجود ندارد.';
      case HttpStatus.TOO_MANY_REQUESTS: return ERROR_MESSAGES_FA.RATE_LIMITED;
      case HttpStatus.PAYLOAD_TOO_LARGE: return ERROR_MESSAGES_FA.FILE_TOO_LARGE;
      case HttpStatus.BAD_REQUEST:
        // پیام‌های اعتبارسنجی ما از قبل فارسی‌اند و باید عبور کنند
        if (typeof raw === 'string') return raw;
        if (Array.isArray(raw) && raw.every((m) => typeof m === 'string')) return raw.join(' ');
        return ERROR_MESSAGES_FA.VALIDATION_FAILED;
      default:
        return ERROR_MESSAGES_FA.INTERNAL;
    }
  }
}
