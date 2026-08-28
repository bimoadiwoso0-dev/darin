import 'dotenv/config';

/**
 * راه‌اندازی محیط تست.
 *
 * ── چرا دیتابیس جداگانه ──────────────────────────────────────────────────
 * تست‌ها داده می‌سازند و پاک می‌کنند. اجرای آنها روی دیتابیس توسعه یعنی
 * از دست دادن داده‌ای که برای کار دستی ساخته‌اید. اگر `TEST_DATABASE_URL`
 * تعریف شده باشد از آن استفاده می‌شود، وگرنه نام دیتابیس در
 * `DATABASE_URL` با پسوند `_test` جایگزین می‌شود.
 *
 * برای ساخت دیتابیس تست:
 *   createdb darin_test && pnpm --filter @darin/api db:migrate
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'برای اجرای تست‌ها باید DATABASE_URL یا TEST_DATABASE_URL تعریف شده باشد.',
    );
  }

  const url = new URL(base);
  // مسیر شامل `/` ابتدایی است؛ نام دیتابیس بعد از آن می‌آید
  const name = url.pathname.replace(/^\//, '');
  if (name.endsWith('_test')) return base;
  url.pathname = `/${name}_test`;
  return url.toString();
}

process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';

// اسرار تست — هرگز با اسرار واقعی یکی نیستند و فقط در همین فرایند زندگی می‌کنند
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-different-and-32-chars-min';
process.env.COOKIE_SECURE = 'false';
process.env.LOG_LEVEL = 'fatal';
// صف در تست غیرفعال است: کارهای پس‌زمینه، نتیجه تست را غیرقطعی می‌کنند
process.env.QUEUE_ENABLED = 'false';
