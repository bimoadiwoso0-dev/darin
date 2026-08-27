import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldData?: unknown;
  newData?: unknown;
  user?: AuthenticatedUser | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** فیلدهایی که هرگز نباید در Audit Log ذخیره شوند. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'tokenHash',
  'refreshToken',
  'accessToken',
  'secret',
  'apiKey',
]);

/**
 * ثبت فعالیت کاربران (قانون ۳۴).
 *
 * دو اصل:
 *  ۱. **هرگز عملیات اصلی را نمی‌شکند.** اگر ثبت لاگ شکست بخورد، فقط یک
 *     هشدار در Log سرور ثبت می‌شود؛ کتابدار نباید به‌خاطر خطای لاگ نتواند
 *     کتاب امانت بدهد.
 *  ۲. **داده حساس ذخیره نمی‌شود.** رمز عبور و توکن پیش از ذخیره حذف می‌شوند.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.user?.sub ?? null,
          userLabel: entry.user ? `${entry.user.fullName} (${entry.user.username})` : null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          entityLabel: entry.entityLabel?.slice(0, 300) ?? null,
          oldData: redact(entry.oldData) as never,
          newData: redact(entry.newData) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        { err, action: entry.action, entityType: entry.entityType },
        'ثبت Audit Log ناموفق بود — عملیات اصلی ادامه یافت',
      );
    }
  }

  /**
   * ثبت تغییر با محاسبه تفاوت (Diff).
   * فقط فیلدهایی که واقعاً تغییر کرده‌اند ذخیره می‌شوند — نه کل رکورد.
   * این باعث می‌شود صفحه «تاریخچه تغییرات کتاب» خوانا باشد.
   */
  async recordUpdate(
    params: Omit<AuditEntry, 'action' | 'oldData' | 'newData'> & {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      action?: string;
    },
  ): Promise<void> {
    const { before, after, action = 'update', ...rest } = params;
    const changed = diffObjects(before, after);
    if (Object.keys(changed.after).length === 0) return; // چیزی عوض نشده

    await this.record({ ...rest, action, oldData: changed.before, newData: changed.after });
  }
}

/** حذف بازگشتی فیلدهای حساس. */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[عمق زیاد]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_FIELDS.has(k) ? '[حذف‌شده]' : redact(v, depth + 1);
  }
  return out;
}

/** فقط کلیدهایی که مقدارشان تغییر کرده را برمی‌گرداند. */
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};

  for (const key of Object.keys(after)) {
    const oldValue = before[key];
    const newValue = after[key];
    if (newValue === undefined) continue; // فیلدی که در درخواست نیامده تغییر نکرده
    if (!isEqual(oldValue, newValue)) {
      b[key] = oldValue ?? null;
      a[key] = newValue;
    }
  }
  return { before: b, after: a };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.toISOString() === b;
  if (typeof b === 'object' && b !== null && typeof a === 'object' && a !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // مقایسه Decimal پرisma با عدد ساده
  if (typeof a === 'object' && a !== null && 'toString' in a && typeof b === 'number') {
    return String(a) === String(b);
  }
  return false;
}
