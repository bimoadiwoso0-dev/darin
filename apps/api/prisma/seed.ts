/**
 * نقطه ورود Seed.
 *
 *   pnpm db:seed                 → Seed هسته + داده نمایشی (فقط در development)
 *   pnpm db:seed -- --core-only  → فقط داده سیستمی (برای Production)
 *   pnpm db:seed -- --purge-demo → حذف کامل داده نمایشی
 */
import { createPrismaClient } from './client.js';
import { seedCore } from './seed-core.js';
import { purgeDemo, seedDemo } from './seed-demo.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const coreOnly = args.includes('--core-only');
  const purge = args.includes('--purge-demo');
  const isProduction = process.env.NODE_ENV === 'production';

  const prisma = createPrismaClient();
  try {
    if (purge) {
      await purgeDemo(prisma);
      return;
    }

    console.log('── Seed هسته سیستم ──────────────────────────────');
    await seedCore(prisma);

    if (coreOnly) {
      console.log('\n(--core-only) داده نمایشی ساخته نشد.');
      return;
    }

    if (isProduction) {
      // محافظت در برابر آلوده شدن پایگاه داده واقعی با داده ساختگی (قانون ۱۰۹)
      console.log('\n⚠️  NODE_ENV=production است — داده نمایشی ساخته نمی‌شود.');
      return;
    }

    const bookCount = await prisma.book.count();
    if (bookCount > 0) {
      console.log(`\n⚠️  دیتابیس از قبل ${bookCount} کتاب دارد — داده نمایشی دوباره ساخته نمی‌شود.`);
      console.log('    برای شروع از صفر: pnpm --filter @darin/api db:reset');
      return;
    }

    console.log('\n── داده نمایشی ──────────────────────────────────');
    await seedDemo(prisma);

    console.log('\n✅ Seed کامل شد.');
    console.log('   گام بعد: سامانه را اجرا کنید و Setup Wizard حساب مدیر را می‌سازد.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('❌ اجرای Seed ناموفق بود:');
  console.error(err);
  process.exit(1);
});
