import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

/**
 * پیکربندی Prisma 7. آدرس اتصال دیگر داخل `schema.prisma` نیست و از اینجا
 * خوانده می‌شود؛ خود برنامه در زمان اجرا از `@prisma/adapter-pg` استفاده می‌کند.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
