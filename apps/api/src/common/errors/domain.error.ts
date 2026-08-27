import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, ERROR_MESSAGES_FA, type ErrorCode } from '@darin/shared';

/**
 * خطای دامنه‌ای — تنها راه مجاز برای برگرداندن خطای قابل پیش‌بینی از سرویس‌ها.
 *
 * چرا کلاس اختصاصی به‌جای `HttpException` خام NestJS؟
 *  ۱. هر خطا یک `code` ماشین‌خوان دارد که Frontend می‌تواند روی آن شرط بگذارد
 *     (مثلاً برای نمایش دیالوگ «نادیده‌گرفتن محدودیت» فقط روی MEMBER_LOAN_LIMIT_REACHED)
 *  ۲. پیام همیشه فارسی و قابل نمایش مستقیم به کتابدار است (قانون ۱۲۳)
 *  ۳. لایه سرویس به HTTP وابسته نیست — فقط دامنه را می‌شناسد
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
    readonly httpStatus: number = statusForCode(code),
  ) {
    super(message ?? ERROR_MESSAGES_FA[code]);
    this.name = 'DomainError';
  }

  static notFound(entity: string, id?: string): DomainError {
    return new DomainError(
      ERROR_CODES.NOT_FOUND,
      `${entity} یافت نشد.`,
      id ? { id } : undefined,
    );
  }

  static forbidden(message?: string): DomainError {
    return new DomainError(ERROR_CODES.FORBIDDEN, message);
  }

  static conflict(code: ErrorCode, message?: string, details?: unknown): DomainError {
    return new DomainError(code, message, details);
  }

  static validation(details: Record<string, string[]>, message?: string): DomainError {
    return new DomainError(ERROR_CODES.VALIDATION_FAILED, message, details);
  }
}

/** نگاشت کد دامنه به وضعیت HTTP. */
function statusForCode(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.UNAUTHORIZED:
    case ERROR_CODES.INVALID_CREDENTIALS:
    case ERROR_CODES.TOKEN_EXPIRED:
    case ERROR_CODES.TOKEN_REUSE_DETECTED:
      return HttpStatus.UNAUTHORIZED;

    case ERROR_CODES.FORBIDDEN:
    case ERROR_CODES.ACCOUNT_DISABLED:
      return HttpStatus.FORBIDDEN;

    case ERROR_CODES.NOT_FOUND:
      return HttpStatus.NOT_FOUND;

    case ERROR_CODES.VALIDATION_FAILED:
    case ERROR_CODES.INVALID_ISBN:
    case ERROR_CODES.IMPORT_FILE_INVALID:
    case ERROR_CODES.UNSUPPORTED_FILE_TYPE:
    case ERROR_CODES.INVALID_LOCATION_HIERARCHY:
    case ERROR_CODES.CIRCULAR_LOCATION:
      return HttpStatus.BAD_REQUEST;

    case ERROR_CODES.FILE_TOO_LARGE:
      return HttpStatus.PAYLOAD_TOO_LARGE;

    case ERROR_CODES.RATE_LIMITED:
    case ERROR_CODES.ACCOUNT_LOCKED:
      return HttpStatus.TOO_MANY_REQUESTS;

    case ERROR_CODES.INTERNAL:
    case ERROR_CODES.BACKUP_FAILED:
    case ERROR_CODES.RESTORE_FAILED:
      return HttpStatus.INTERNAL_SERVER_ERROR;

    // بقیه موارد تعارض وضعیت‌اند: نسخه در امانت است، سقف پر شده، شماره تکراری و ...
    default:
      return HttpStatus.CONFLICT;
  }
}
