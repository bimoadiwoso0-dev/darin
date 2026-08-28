/**
 * سنجش زمان پاسخ کوئری‌های حیاتی (قوانین ۱۱۴، ۱۱۵، ۱۱۶).
 *
 *   pnpm --filter @darin/api perf:measure
 *
 * ── چرا سنجش خودکار و نه چشمی ────────────────────────────────────────────
 * «به نظر سریع می‌آید» با ۸۴ رکورد درست است و با ۱۰۰٬۰۰۰ رکورد فاجعه.
 * این اسکریپت همان کوئری‌هایی را می‌سنجد که کتابدار روزی صدها بار اجرا
 * می‌کند، و اگر از سقف قابل قبول بگذرند با کد خطا خارج می‌شود.
 *
 * ── چرا `EXPLAIN` هم گرفته می‌شود ────────────────────────────────────────
 * زمان خوب امروز، تضمین فردا نیست. اگر کوئری Seq Scan می‌زند و فقط چون
 * جدول کوچک است سریع به نظر می‌رسد، گزارش آن را نشان می‌دهد.
 */
import { persianNormalize } from '@darin/shared';
import { createPrismaClient } from './client.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

interface Measurement {
  name: string;
  /** سقف قابل قبول بر حسب میلی‌ثانیه — از آن بگذرد، خروجی ناموفق است */
  budgetMs: number;
  run: (prisma: PrismaClient) => Promise<unknown>;
  /** کوئری خام برای EXPLAIN — اختیاری */
  explain?: string;
}

const MEASUREMENTS: Measurement[] = [
  {
    name: 'جستجوی متن فارسی در عنوان کتاب',
    budgetMs: 200,
    run: (prisma) =>
      prisma.$queryRaw`
        SELECT b."id", b."title", ts_rank_cd(b."searchVector", persian_tsquery('تاریخ ایران')) AS rank
          FROM books b
         WHERE b."deletedAt" IS NULL
           AND b."searchVector" @@ persian_tsquery('تاریخ ایران')
         ORDER BY rank DESC
         LIMIT 20
      `,
    explain: `
      SELECT b."id" FROM books b
       WHERE b."deletedAt" IS NULL AND b."searchVector" @@ persian_tsquery('تاریخ ایران')
       ORDER BY ts_rank_cd(b."searchVector", persian_tsquery('تاریخ ایران')) DESC LIMIT 20`,
  },
  {
    name: 'جستجوی تقریبی (غلط املایی) با trigram',
    budgetMs: 300,
    run: (prisma) => {
      const normalized = persianNormalize('تاریح ایران'); // «ح» به‌جای «خ»
      return prisma.$queryRaw`
        SELECT b."id", similarity(b."titleNormalized", ${normalized}) AS score
          FROM books b
         WHERE b."deletedAt" IS NULL AND b."titleNormalized" % ${normalized}
         ORDER BY score DESC
         LIMIT 20
      `;
    },
  },
  {
    name: 'یافتن نسخه با بارکد (پرتکرارترین کوئری میز امانت)',
    budgetMs: 50,
    run: (prisma) =>
      prisma.bookCopy.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { barcode: 'PERF-BC-000000500' },
            { accessionNumber: 'PERF-BC-000000500' },
            { libraryCode: 'PERF-BC-000000500' },
          ],
        },
        include: { book: { select: { title: true } } },
      }),
    explain: `SELECT * FROM book_copies WHERE "barcode" = 'PERF-BC-000000500' AND "deletedAt" IS NULL`,
  },
  {
    name: 'فهرست کتاب‌ها با صفحه‌بندی (صفحه اول)',
    budgetMs: 200,
    // همان دو کوئری‌ای که `BooksService.list` می‌زند: ردیف‌ها، سپس شمارش
    // نسخه‌ها با `groupBy` روی همان ۲۰ شناسه. عمداً از `_count` رابطه‌ای
    // استفاده نمی‌شود — چرایی‌اش در `BooksService.copyCounts` توضیح داده شده.
    run: async (prisma) => {
      const rows = await prisma.book.findMany({
        where: { deletedAt: null },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, isbn13: true,
          publisher: { select: { name: true } },
        },
      });
      return prisma.bookCopy.groupBy({
        by: ['bookId', 'status'],
        where: { bookId: { in: rows.map((r) => r.id) }, deletedAt: null },
        _count: { _all: true },
      });
    },
  },
  {
    name: 'فهرست کتاب‌ها — صفحه عمیق (offset ۵۰۰۰)',
    budgetMs: 400,
    run: (prisma) =>
      prisma.book.findMany({
        where: { deletedAt: null },
        skip: 5_000,
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true },
      }),
  },
  {
    name: 'شمارش امانت‌های باز',
    budgetMs: 150,
    run: (prisma) => prisma.loan.count({ where: { status: { in: ['ACTIVE', 'OVERDUE'] } } }),
  },
  {
    name: 'امانت‌های دیرکرددار با اطلاعات عضو و کتاب',
    budgetMs: 300,
    run: (prisma) =>
      prisma.loan.findMany({
        where: { status: { in: ['ACTIVE', 'OVERDUE'] }, dueAt: { lt: new Date() } },
        take: 50,
        orderBy: { dueAt: 'asc' },
        select: {
          id: true, dueAt: true,
          member: { select: { memberCode: true, firstName: true, lastName: true } },
          copy: { select: { barcode: true, book: { select: { title: true } } } },
        },
      }),
  },
  {
    name: 'جستجوی سریع عضو با نام',
    budgetMs: 150,
    run: (prisma) => {
      const normalized = persianNormalize('محمدی');
      return prisma.member.findMany({
        where: { deletedAt: null, nameNormalized: { contains: normalized } },
        take: 10,
        select: { id: true, memberCode: true, firstName: true, lastName: true },
      });
    },
  },
  {
    name: 'نسخه‌های یک قفسه و زیرمجموعه‌هایش',
    budgetMs: 250,
    run: async (prisma) => {
      const shelf = await prisma.location.findFirst({
        where: { kind: { in: ['SHELF', 'SHELF_LEVEL'] } },
        select: { id: true },
      });
      if (!shelf) return [];
      return prisma.bookCopy.findMany({
        where: { locationId: shelf.id, deletedAt: null },
        take: 50,
        select: { id: true, accessionNumber: true },
      });
    },
  },
  {
    name: 'آمار داشبورد (شمارش وضعیت نسخه‌ها)',
    budgetMs: 400,
    run: (prisma) =>
      prisma.bookCopy.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
  },
  {
    name: 'گزارش امانت‌های جاری (۱۰۰ ردیف اول)',
    budgetMs: 500,
    run: (prisma) =>
      prisma.$queryRaw`
        SELECT l."loanNumber", b."title", m."memberCode",
               m."firstName" || ' ' || m."lastName" AS member_name, l."dueAt"
          FROM loans l
          JOIN book_copies c ON c."id" = l."copyId"
          JOIN books b ON b."id" = c."bookId"
          JOIN members m ON m."id" = l."memberId"
         WHERE l."status" IN ('ACTIVE','OVERDUE')
         ORDER BY l."dueAt" ASC
         LIMIT 100
      `,
  },
];

/** اجرای چندباره و گزارش میانه — یک بار اجرا، نویز شبکه و کش را نشان می‌دهد. */
async function timeIt(
  prisma: PrismaClient,
  measurement: Measurement,
  runs: number,
): Promise<{ median: number; min: number; max: number }> {
  // یک اجرای گرم‌کننده تا کش صفحه‌های PostgreSQL پر شود
  await measurement.run(prisma);

  const timings: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    await measurement.run(prisma);
    timings.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  }

  timings.sort((a, b) => a - b);
  return {
    median: timings[Math.floor(timings.length / 2)]!,
    min: timings[0]!,
    max: timings.at(-1)!,
  };
}

async function main(): Promise<void> {
  const runs = Number(process.env.PERF_RUNS ?? 5);
  const showExplain = process.argv.includes('--explain');
  const prisma = createPrismaClient();

  try {
    const [books, copies, loans, members] = await Promise.all([
      prisma.book.count(),
      prisma.bookCopy.count(),
      prisma.loan.count(),
      prisma.member.count(),
    ]);

    console.log('── سنجش کارایی ──────────────────────────────────');
    console.log(
      `حجم داده: ${fmt(books)} کتاب · ${fmt(copies)} نسخه · ` +
      `${fmt(members)} عضو · ${fmt(loans)} امانت`,
    );
    console.log(`هر کوئری ${fmt(runs)} بار اجرا می‌شود و میانه گزارش می‌گردد.\n`);

    let failed = 0;
    for (const measurement of MEASUREMENTS) {
      const { median, min, max } = await timeIt(prisma, measurement, runs);
      const ok = median <= measurement.budgetMs;
      if (!ok) failed++;

      const mark = ok ? '✔' : '✘';
      const timing = `${median.toFixed(1)}ms`.padStart(9);
      const budget = `سقف ${measurement.budgetMs}ms`;
      console.log(
        `${mark} ${timing}  ${measurement.name}\n` +
        `             (کمینه ${min.toFixed(1)} · بیشینه ${max.toFixed(1)} · ${budget})`,
      );

      if (showExplain && measurement.explain) {
        const plan = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
          `EXPLAIN (ANALYZE, BUFFERS) ${measurement.explain}`,
        );
        for (const row of plan) {
          console.log(`             │ ${Object.values(row)[0]}`);
        }
      }
    }

    console.log(
      `\n${MEASUREMENTS.length - failed} از ${MEASUREMENTS.length} کوئری در محدوده قابل قبول`,
    );

    if (failed > 0) {
      console.log('\nکوئری کند معمولاً یکی از این دو دلیل را دارد:');
      console.log('  • ایندکس لازم وجود ندارد یا برنامه‌ریز از آن استفاده نمی‌کند');
      console.log('  • آمار جدول کهنه است — `ANALYZE;` را اجرا کنید');
      console.log('\nبرای دیدن نقشه اجرا:  pnpm --filter @darin/api perf:measure -- --explain');
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function fmt(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

main().catch((error: unknown) => {
  console.error('✘ سنجش کارایی ناموفق بود:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
