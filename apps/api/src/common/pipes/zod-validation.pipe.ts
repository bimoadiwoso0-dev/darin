import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { DomainError } from '../errors/domain.error';

/**
 * اعتبارسنجی ورودی با Zod.
 *
 * چرا Zod به‌جای class-validator؟ چون همان Schema در Frontend هم استفاده
 * می‌شود (packages/shared) — یعنی قواعد اعتبارسنجی یک بار نوشته و در هر دو
 * سمت اجرا می‌شوند و امکان واگرایی وجود ندارد (قانون ۱۰۵).
 *
 * خطاها به شکل `{ field: [messages] }` برمی‌گردند تا فرم بتواند هر پیام را
 * زیر فیلد مربوطه نشان دهد.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw DomainError.validation(formatZodError(result.error));
  }
}

/** میان‌بر خوانا برای استفاده در Controller: `@Body(zodBody(CreateBookSchema))` */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/** تبدیل خطای Zod به نگاشت «نام فیلد → پیام‌های فارسی». */
export function formatZodError(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
