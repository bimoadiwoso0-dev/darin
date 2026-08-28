/**
 * تولید داده انبوه برای سنجش کارایی (قوانین ۱۱۴، ۱۱۵).
 *
 *   pnpm --filter @darin/api seed:perf -- --books 10000
 *   pnpm --filter @darin/api seed:perf -- --books 100000 --members 5000
 *   pnpm --filter @darin/api seed:perf -- --purge
 *
 * ── چرا داده انبوه لازم است ──────────────────────────────────────────────
 * سامانه‌ای که با ۸۴ کتاب نمایشی روان است، هیچ چیزی درباره رفتارش با
 * ۱۰۰٬۰۰۰ کتاب نمی‌گوید. کوئری بدون ایندکس روی ۸۴ ردیف زیر یک میلی‌ثانیه
 * و روی ۱۰۰٬۰۰۰ ردیف چند ثانیه طول می‌کشد — و این تفاوت فقط با داده واقعی
 * دیده می‌شود.
 *
 * ── چرا `createMany` و نه `create` در حلقه ───────────────────────────────
 * هر `create` یک رفت‌وبرگشت شبکه و یک تراکنش است. برای ۱۰۰٬۰۰۰ رکورد یعنی
 * ۱۰۰٬۰۰۰ رفت‌وبرگشت و چند ساعت انتظار. درج دسته‌ای همان کار را در چند
 * دقیقه انجام می‌دهد.
 *
 * ── جدایی از داده واقعی (قانون ۱۰۹) ─────────────────────────────────────
 * همه رکوردها برچسب `[PERF]` می‌گیرند و با `--purge` کاملاً پاک می‌شوند.
 */
import { persianNormalize, toCanonicalIsbn13 } from '@darin/shared';
import { createPrismaClient } from './client.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

export const PERF_MARKER = '[PERF]';

/** اجزای عنوان — ترکیبشان عنوان‌های متنوع و قابل جستجو می‌سازد. */
const TITLE_PREFIX = [
  'تاریخ', 'فرهنگ', 'مبانی', 'اصول', 'درآمدی بر', 'دانشنامه', 'راهنمای',
  'جستارهایی در', 'پژوهشی در', 'گزیده', 'مجموعه', 'تحلیل', 'نقد', 'شرح',
];

const TITLE_SUBJECT = [
  'ادبیات فارسی', 'شعر معاصر', 'تاریخ ایران', 'فلسفه اسلامی', 'جامعه‌شناسی',
  'روان‌شناسی', 'اقتصاد', 'حقوق', 'ریاضیات', 'فیزیک نظری', 'شیمی آلی',
  'زیست‌شناسی', 'معماری ایرانی', 'هنر مینیاتور', 'موسیقی سنتی', 'خوشنویسی',
  'باستان‌شناسی', 'زبان‌شناسی', 'علوم رایانه', 'هوش مصنوعی', 'مهندسی نرم‌افزار',
  'پزشکی سنتی', 'داروسازی', 'کشاورزی', 'محیط زیست', 'جغرافیای ایران',
];

const TITLE_SUFFIX = [
  '', '', '', 'جلد اول', 'جلد دوم', 'ویراست دوم', 'برای دانشجویان',
  'از آغاز تا امروز', 'در قرن بیستم', 'رویکردی نو',
];

const FIRST_NAMES = [
  'علی', 'محمد', 'حسین', 'رضا', 'مهدی', 'امیر', 'سعید', 'مجید', 'ناصر', 'بهرام',
  'فاطمه', 'زهرا', 'مریم', 'سارا', 'نرگس', 'الهام', 'شیما', 'رویا', 'پریسا', 'لیلا',
];

const LAST_NAMES = [
  'احمدی', 'محمدی', 'حسینی', 'رضایی', 'موسوی', 'کریمی', 'صادقی', 'نوری',
  'مرادی', 'قاسمی', 'شریفی', 'باقری', 'جعفری', 'کاظمی', 'اکبری', 'یوسفی',
  'فتحی', 'سلطانی', 'داوودی', 'همروندی',
];

interface Options {
  books: number;
  members: number;
  loans: number;
  purge: boolean;
}

function parseArgs(argv: string[]): Options {
  const read = (flag: string, fallback: number): number => {
    const index = argv.indexOf(flag);
    if (index === -1) return fallback;
    const value = Number(argv[index + 1]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  const books = read('--books', 10_000);
  return {
    books,
    // نسبت‌های واقع‌بینانه یک کتابخانه: حدود یک عضو به ازای هر ۱۰ کتاب
    members: read('--members', Math.max(100, Math.round(books / 10))),
    loans: read('--loans', Math.max(100, Math.round(books / 5))),
    purge: argv.includes('--purge'),
  };
}

/** مولد شبه‌تصادفی با بذر ثابت — اجرای دوباره، همان داده را می‌سازد. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();

  try {
    if (options.purge) {
      await purgePerf(prisma);
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'این اسکریپت داده آزمایشی انبوه می‌سازد و نباید روی Production اجرا شود.',
      );
    }

    console.log('── تولید داده کارایی ────────────────────────────');
    console.log(
      `هدف: ${fmt(options.books)} کتاب · ${fmt(options.members)} عضو · ${fmt(options.loans)} امانت\n`,
    );

    const started = Date.now();
    const branch = await prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await prisma.membershipType.findFirstOrThrow();

    const personIds = await createPersons(prisma, 500);
    const publisherIds = await createPublishers(prisma, 200);
    const locationIds = await ensureLocations(prisma, branch.id);

    const bookIds = await createBooks(prisma, options.books, publisherIds, personIds);
    const copyIds = await createCopies(prisma, bookIds, branch.id, locationIds);
    const memberIds = await createMembers(prisma, options.members, branch.id, membershipType.id);
    await createLoans(prisma, options.loans, copyIds, memberIds, branch.id);

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n✔ تولید داده در ${elapsed} ثانیه کامل شد.`);

    await analyze(prisma);
    await report(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// ═══════════════════════════════════════════════════════════════════════════

async function createPersons(prisma: PrismaClient, count: number): Promise<string[]> {
  process.stdout.write('… پدیدآورندگان');
  const random = seededRandom(1);
  const rows = Array.from({ length: count }, (_, i) => {
    const name = `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)} ${i}`;
    return {
      fullName: name,
      nameNormalized: persianNormalize(name),
      note: PERF_MARKER,
    };
  });

  await prisma.person.createMany({ data: rows, skipDuplicates: true });
  const created = await prisma.person.findMany({
    where: { note: PERF_MARKER },
    select: { id: true },
  });
  console.log(` → ${fmt(created.length)}`);
  return created.map((p) => p.id);
}

async function createPublishers(prisma: PrismaClient, count: number): Promise<string[]> {
  process.stdout.write('… ناشران');
  const rows = Array.from({ length: count }, (_, i) => ({
    name: `انتشارات آزمایشی ${i}`,
    nameNormalized: persianNormalize(`انتشارات آزمایشی ${i}`),
    city: 'تهران',
    note: PERF_MARKER,
  }));

  await prisma.publisher.createMany({ data: rows, skipDuplicates: true });
  const created = await prisma.publisher.findMany({
    where: { note: PERF_MARKER },
    select: { id: true },
  });
  console.log(` → ${fmt(created.length)}`);
  return created.map((p) => p.id);
}

/** استفاده از قفسه‌های موجود؛ اگر نبود، چند قفسه ساده می‌سازد. */
async function ensureLocations(prisma: PrismaClient, branchId: string): Promise<string[]> {
  const existing = await prisma.location.findMany({
    where: { branchId, deletedAt: null, kind: { in: ['SHELF', 'SHELF_LEVEL'] } },
    select: { id: true },
    take: 500,
  });
  if (existing.length > 0) return existing.map((l) => l.id);

  const root = await prisma.location.create({
    data: {
      branchId, kind: 'BUILDING', name: 'ساختمان آزمایشی',
      code: 'PERF', fullCode: 'PERF', depth: 0, note: PERF_MARKER,
    },
  });
  await prisma.location.update({
    where: { id: root.id },
    data: { path: `.${root.id}.` },
  });

  const shelves: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const shelf = await prisma.location.create({
      data: {
        branchId, parentId: root.id, kind: 'SHELF',
        name: `قفسه آزمایشی ${i}`, code: `S${i}`, fullCode: `PERF-S${i}`,
        depth: 1, path: `.${root.id}.`, capacity: 500, note: PERF_MARKER,
      },
    });
    shelves.push(shelf.id);
  }
  return shelves;
}

async function createBooks(
  prisma: PrismaClient,
  count: number,
  publisherIds: string[],
  personIds: string[],
): Promise<string[]> {
  const random = seededRandom(42);
  const BATCH = 2_000;
  const ids: string[] = [];

  for (let offset = 0; offset < count; offset += BATCH) {
    const size = Math.min(BATCH, count - offset);
    const books = Array.from({ length: size }, (_, i) => {
      const index = offset + i;
      const title = [
        pick(TITLE_PREFIX, random),
        pick(TITLE_SUBJECT, random),
        pick(TITLE_SUFFIX, random),
      ]
        .filter(Boolean)
        .join(' ');

      // شابک معتبر با رقم کنترل درست — تا جستجوی شابک واقعاً سنجیده شود
      const isbnBase = `978${String(600_000_000 + index).slice(0, 9)}`;
      return {
        title: `${title} ${index}`,
        language: 'fa',
        publisherId: pick(publisherIds, random),
        publicationYear: 1380 + Math.floor(random() * 25),
        // `publicationCalendar` پیش‌فرض شمسی است و نیازی به تعیین ندارد
        pageCount: 80 + Math.floor(random() * 600),
        isbn13: toCanonicalIsbn13(isbnBase) ?? null,
        internalNote: PERF_MARKER,
      };
    });

    await prisma.book.createMany({ data: books, skipDuplicates: true });
    process.stdout.write(`\r… کتاب‌ها → ${fmt(Math.min(offset + size, count))} / ${fmt(count)}`);
  }
  console.log('');

  const created = await prisma.book.findMany({
    where: { internalNote: PERF_MARKER },
    select: { id: true },
  });
  ids.push(...created.map((b) => b.id));

  // اتصال پدیدآورنده به هر کتاب — بدون این، جستجوی نویسنده بی‌معنا می‌شود
  process.stdout.write('… اتصال پدیدآورندگان');
  const linkRandom = seededRandom(7);
  for (let offset = 0; offset < ids.length; offset += 5_000) {
    const slice = ids.slice(offset, offset + 5_000);
    await prisma.bookContributor.createMany({
      data: slice.map((bookId) => ({
        bookId,
        personId: pick(personIds, linkRandom),
        role: 'AUTHOR' as const,
        position: 0,
      })),
      skipDuplicates: true,
    });
  }
  console.log(' ✔');

  return ids;
}

async function createCopies(
  prisma: PrismaClient,
  bookIds: string[],
  branchId: string,
  locationIds: string[],
): Promise<string[]> {
  const random = seededRandom(99);
  const BATCH = 2_000;
  let total = 0;

  for (let offset = 0; offset < bookIds.length; offset += BATCH) {
    const slice = bookIds.slice(offset, offset + BATCH);
    const copies: Array<Record<string, unknown>> = [];

    for (const bookId of slice) {
      // بیشتر کتاب‌ها یک نسخه دارند، بعضی دو یا سه — مثل کتابخانه واقعی
      const copyCount = random() < 0.7 ? 1 : random() < 0.9 ? 2 : 3;
      for (let n = 1; n <= copyCount; n++) {
        const serial = total + copies.length + 1;
        copies.push({
          bookId,
          branchId,
          copyNumber: n,
          accessionNumber: `PERF-${String(serial).padStart(9, '0')}`,
          barcode: `PERF-BC-${String(serial).padStart(9, '0')}`,
          locationId: pick(locationIds, random),
          status: 'AVAILABLE',
          condition: 'GOOD',
          isLoanable: true,
          internalNote: PERF_MARKER,
        });
      }
    }

    await prisma.bookCopy.createMany({ data: copies as never, skipDuplicates: true });
    total += copies.length;
    process.stdout.write(`\r… نسخه‌های فیزیکی → ${fmt(total)}`);
  }
  console.log('');

  const created = await prisma.bookCopy.findMany({
    where: { internalNote: PERF_MARKER },
    select: { id: true },
  });
  return created.map((c) => c.id);
}

async function createMembers(
  prisma: PrismaClient,
  count: number,
  branchId: string,
  membershipTypeId: string,
): Promise<string[]> {
  const random = seededRandom(3);
  const BATCH = 2_000;

  for (let offset = 0; offset < count; offset += BATCH) {
    const size = Math.min(BATCH, count - offset);
    const members = Array.from({ length: size }, (_, i) => {
      const index = offset + i;
      const firstName = pick(FIRST_NAMES, random);
      const lastName = pick(LAST_NAMES, random);
      return {
        branchId,
        membershipTypeId,
        memberCode: `PERF-M-${String(index).padStart(7, '0')}`,
        firstName,
        lastName,
        nameNormalized: persianNormalize(`${firstName} ${lastName}`),
        mobile: `0912${String(1_000_000 + index).slice(0, 7)}`,
        status: 'ACTIVE' as const,
        joinedAt: new Date(Date.now() - Math.floor(random() * 1000) * 86_400_000),
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
        note: PERF_MARKER,
      };
    });

    await prisma.member.createMany({ data: members, skipDuplicates: true });
    process.stdout.write(`\r… اعضا → ${fmt(Math.min(offset + size, count))} / ${fmt(count)}`);
  }
  console.log('');

  const created = await prisma.member.findMany({
    where: { note: PERF_MARKER },
    select: { id: true },
  });
  return created.map((m) => m.id);
}

async function createLoans(
  prisma: PrismaClient,
  count: number,
  copyIds: string[],
  memberIds: string[],
  branchId: string,
): Promise<void> {
  if (copyIds.length === 0 || memberIds.length === 0) return;

  const random = seededRandom(11);
  const target = Math.min(count, copyIds.length);
  const BATCH = 2_000;

  /*
   * هر نسخه حداکثر یک امانت باز دارد (ایندکس یکتای جزئی این را تضمین
   * می‌کند). پس نسخه‌ها بدون تکرار مصرف می‌شوند و بخشی از امانت‌ها
   * بازگشت‌خورده ساخته می‌شوند تا تاریخچه هم داده داشته باشد.
   */
  const shuffled = [...copyIds].sort(() => random() - 0.5);
  let created = 0;

  for (let offset = 0; offset < target; offset += BATCH) {
    const slice = shuffled.slice(offset, Math.min(offset + BATCH, target));
    const loans = slice.map((copyId, i) => {
      const index = offset + i;
      const returned = random() < 0.6;
      const loanedAt = new Date(Date.now() - Math.floor(random() * 300 + 15) * 86_400_000);
      const dueAt = new Date(loanedAt.getTime() + 14 * 86_400_000);

      return {
        loanNumber: `PERF-L-${String(index).padStart(9, '0')}`,
        branchId,
        copyId,
        memberId: pick(memberIds, random),
        status: returned ? ('RETURNED' as const) : ('ACTIVE' as const),
        loanedAt,
        dueAt,
        originalDueAt: dueAt,
        returnedAt: returned
          ? new Date(dueAt.getTime() - Math.floor(random() * 10) * 86_400_000)
          : null,
        note: PERF_MARKER,
      };
    });

    await prisma.loan.createMany({ data: loans, skipDuplicates: true });

    // وضعیت نسخه‌های امانت‌رفته باید با رکورد امانت هم‌خوان باشد
    const openCopyIds = loans.filter((l) => l.status === 'ACTIVE').map((l) => l.copyId);
    if (openCopyIds.length > 0) {
      await prisma.bookCopy.updateMany({
        where: { id: { in: openCopyIds } },
        data: { status: 'ON_LOAN' },
      });
    }

    created += loans.length;
    process.stdout.write(`\r… امانت‌ها → ${fmt(created)} / ${fmt(target)}`);
  }
  console.log('');
}

/**
 * به‌روزرسانی آمار برنامه‌ریز کوئری.
 *
 * بدون `ANALYZE`، PostgreSQL هنوز فکر می‌کند جدول‌ها خالی‌اند و برای
 * هر کوئری Seq Scan انتخاب می‌کند. نتیجه: زمان‌سنجی‌ای که هیچ ربطی به
 * رفتار واقعی سامانه ندارد.
 */
async function analyze(prisma: PrismaClient): Promise<void> {
  process.stdout.write('… به‌روزرسانی آمار برنامه‌ریز کوئری (ANALYZE)');
  await prisma.$executeRawUnsafe('ANALYZE');
  console.log(' ✔');
}

async function report(prisma: PrismaClient): Promise<void> {
  const [books, copies, members, loans, dbSize] = await Promise.all([
    prisma.book.count(),
    prisma.bookCopy.count(),
    prisma.member.count(),
    prisma.loan.count(),
    prisma.$queryRaw<Array<{ size: string }>>`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `,
  ]);

  console.log('\n── وضعیت دیتابیس ────────────────────────────────');
  console.log(`  کتاب:            ${fmt(books)}`);
  console.log(`  نسخه فیزیکی:     ${fmt(copies)}`);
  console.log(`  عضو:             ${fmt(members)}`);
  console.log(`  امانت:           ${fmt(loans)}`);
  console.log(`  حجم دیتابیس:     ${dbSize[0]?.size ?? '—'}`);
  console.log('\nبرای سنجش زمان پاسخ:  pnpm --filter @darin/api perf:measure');
}

/** حذف کامل داده کارایی — قانون ۱۰۹. */
async function purgePerf(prisma: PrismaClient): Promise<void> {
  console.log('── حذف داده کارایی ──────────────────────────────');

  const results = await prisma.$transaction([
    prisma.loan.deleteMany({ where: { note: PERF_MARKER } }),
    prisma.bookCopy.deleteMany({ where: { internalNote: PERF_MARKER } }),
    prisma.bookContributor.deleteMany({ where: { book: { internalNote: PERF_MARKER } } }),
    prisma.book.deleteMany({ where: { internalNote: PERF_MARKER } }),
    prisma.member.deleteMany({ where: { note: PERF_MARKER } }),
    prisma.person.deleteMany({ where: { note: PERF_MARKER } }),
    prisma.publisher.deleteMany({ where: { note: PERF_MARKER } }),
    prisma.location.deleteMany({ where: { note: PERF_MARKER } }),
  ]);

  const labels = ['امانت', 'نسخه', 'پدیدآورنده کتاب', 'کتاب', 'عضو', 'شخص', 'ناشر', 'مکان'];
  results.forEach((r, i) => {
    if (r.count > 0) console.log(`  ${labels[i]}: ${fmt(r.count)} حذف شد`);
  });

  await prisma.$executeRawUnsafe('ANALYZE');
  console.log('✔ داده کارایی کاملاً پاک شد.');
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function fmt(value: number): string {
  return new Intl.NumberFormat('fa-IR').format(value);
}

main().catch((error: unknown) => {
  console.error('\n✘ تولید داده کارایی ناموفق بود:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
