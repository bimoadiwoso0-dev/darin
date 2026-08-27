/**
 * ساخت PrismaClient برای اسکریپت‌های خط فرمان (Seed، Backup، ابزارهای نگهداری).
 *
 * در Prisma 7 آدرس اتصال دیگر از `schema.prisma` خوانده نمی‌شود و باید یک
 * Driver Adapter به Client داده شود. برنامه اصلی (NestJS) نسخه خودش را در
 * `src/infrastructure/prisma/prisma.service.ts` می‌سازد.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('متغیر محیطی DATABASE_URL تعریف نشده است. فایل .env را بررسی کنید.');
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
