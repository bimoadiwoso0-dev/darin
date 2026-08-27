import { z } from 'zod';

/**
 * پارامتر بولی در Query String.
 *
 * ── چرا `z.coerce.boolean()` استفاده نمی‌شود ─────────────────────────────
 * `z.coerce.boolean()` از `Boolean(value)` جاوااسکریپت استفاده می‌کند و در
 * آن **هر رشته غیرخالی `true` است** — یعنی `?availableOnly=false` و
 * `?overdueOnly=0` هم مقدار `true` می‌گرفتند و فیلتر برعکس عمل می‌کرد.
 *
 * این Schema مقادیر متعارف را صریح تفسیر می‌کند:
 *   true  ← "true", "1", "yes", "on", true
 *   false ← "false", "0", "no", "off", "", false
 *
 * حضور پارامتر بدون مقدار (`?overdueOnly`) به‌معنای `true` است، چون همین
 * انتظار متعارف در HTML و اکثر APIهاست.
 */
export const booleanQuery = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return true; // `?flag` بدون مقدار
    return ['true', '1', 'yes', 'on'].includes(normalized);
  });

/** فهرست مقادیر که هم `?s=A&s=B` و هم `?s=A,B` را می‌پذیرد. */
export function csvEnumQuery<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const parts = (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    })
    .pipe(z.array(z.enum(values)).optional());
}

/** پارامترهای مشترک صفحه‌بندی. */
export const paginationQuery = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
};
