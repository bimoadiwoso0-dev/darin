import type { INestApplication } from '@nestjs/common';
import { persianNormalize } from '@darin/shared';
import { createTestApp, loginAs, resetOperationalData, type TestContext } from './helpers';

/**
 * جستجوی فارسی و یکپارچگی داده (قوانین ۴۳–۴۹، ۷۸، ۱۱۲).
 *
 * ── چرا برابری نرمال‌ساز حیاتی است ──────────────────────────────────────
 * جستجو در دو جا نرمال‌سازی می‌کند: TypeScript (روی ورودی کاربر) و
 * PostgreSQL (روی متن ذخیره‌شده، هنگام ساخت ایندکس). اگر این دو حتی در
 * یک نویسه اختلاف داشته باشند، کاربر عبارتی را جستجو می‌کند که در ایندکس
 * به شکل دیگری ذخیره شده و نتیجه‌ای نمی‌گیرد — بدون هیچ پیام خطایی.
 */
describe('جستجوی فارسی و یکپارچگی داده', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let manager: { cookie: string[]; userId: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    manager = await loginAs(ctx, 'LIBRARY_MANAGER');
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  برابری نرمال‌ساز TypeScript و SQL
  // ═══════════════════════════════════════════════════════════════════════

  it('تابع persian_normalize دیتابیس با نسخه TypeScript دقیقاً یکسان است', async () => {
    const cases = [
      'حافظ',
      'ديوان حافظ',              // یای عربی
      'كتاب',                    // کاف عربی
      'حافظ، دیوان',             // ویرگول فارسی
      'مثنوی    معنوی',          // فاصله‌های متعدد
      'إسلام',                   // همزه
      'کتاب‌های درسی',           // نیم‌فاصله
      'ســـلام',                 // کشیده
      'قرآن',                    // مد
      'مُحَمَّد',                   // اعراب
      'ISBN 978-964',            // لاتین و عدد
      '۱۴۰۵',                    // ارقام فارسی
      '١٤٠٥',                    // ارقام عربی
      'Test Book 2024',
      'کتاب (جلد اول)',
      'الف‌ب‌پ',
      '',
      '   ',
      'a',
      'آ',
      'ة',                       // تاء مربوطه
      'ی ي ى',                   // سه شکل یا
      'ک ك',                     // دو شکل کاف
      'ؤ',
      'ئ',
      'شعر نو — نیما',
    ];

    const results = await ctx.prisma.$queryRawUnsafe<Array<{ input: string; sql: string }>>(
      `SELECT t.input, persian_normalize(t.input) AS sql
         FROM unnest($1::text[]) AS t(input)`,
      cases,
    );

    const mismatches = results
      .map((row) => ({
        input: row.input,
        sql: row.sql,
        ts: persianNormalize(row.input),
      }))
      .filter((r) => r.sql !== r.ts);

    expect(mismatches).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  جستجو
  // ═══════════════════════════════════════════════════════════════════════

  describe('جستجوی کتاب', () => {
    beforeAll(async () => {
      await resetOperationalData(ctx.prisma);

      const hafez = await ctx.prisma.person.create({
        data: { fullName: 'حافظ شیرازی', nameNormalized: persianNormalize('حافظ شیرازی') },
      });
      const publisher = await ctx.prisma.publisher.create({
        data: { name: 'نشر نی', nameNormalized: persianNormalize('نشر نی') },
      });

      const book = await ctx.prisma.book.create({
        data: {
          title: 'دیوان حافظ',
          language: 'fa',
          publisherId: publisher.id,
          isbn13: '9789641853015',
        },
      });
      await ctx.prisma.bookContributor.create({
        data: { bookId: book.id, personId: hafez.id, role: 'AUTHOR', position: 0 },
      });

      await ctx.prisma.book.create({
        data: { title: 'مثنوی معنوی', language: 'fa' },
      });
    });

    it('عبارت دقیق فارسی پیدا می‌شود', async () => {
      const response = await ctx.http().get('/api/books')
        .query({ q: 'دیوان حافظ' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].title).toBe('دیوان حافظ');
    });

    it('یای عربی همان نتیجه یای فارسی را می‌دهد', async () => {
      // «ديوان» با یای عربی (U+064A) نوشته شده
      const response = await ctx.http().get('/api/books')
        .query({ q: 'ديوان' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].title).toBe('دیوان حافظ');
    });

    it('جستجو بر اساس نام پدیدآورنده کار می‌کند', async () => {
      const response = await ctx.http().get('/api/books')
        .query({ q: 'حافظ شیرازی' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('جستجو بر اساس نام ناشر کار می‌کند', async () => {
      const response = await ctx.http().get('/api/books')
        .query({ q: 'نشر نی' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('شابک با خط تیره یا بدون آن، هر دو پیدا می‌شوند', async () => {
      const withDashes = await ctx.http().get('/api/books')
        .query({ q: '978-964-185-301-5' })
        .set('Cookie', manager.cookie)
        .expect(200);

      const without = await ctx.http().get('/api/books')
        .query({ q: '9789641853015' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(without.body.data.length).toBeGreaterThan(0);
      expect(withDashes.body.data.length).toBe(without.body.data.length);
    });

    it('جستجوی خالی همه کتاب‌ها را برمی‌گرداند، نه هیچ‌کدام', async () => {
      // اشکال کلاسیک: `contains: ''` که در بعضی موتورها هیچ ردیفی برنمی‌گرداند
      const response = await ctx.http().get('/api/books')
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('عبارت بی‌ربط، نتیجه‌ای برنمی‌گرداند', async () => {
      const response = await ctx.http().get('/api/books')
        .query({ q: 'zzzzقطعانامربوطzzzz' })
        .set('Cookie', manager.cookie)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  محدودیت‌های دیتابیس — قانون ۷۸
  // ═══════════════════════════════════════════════════════════════════════

  describe('محدودیت‌های سطح دیتابیس', () => {
    it('بارکد تکراری در سطح دیتابیس رد می‌شود', async () => {
      await resetOperationalData(ctx.prisma);
      const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
      const book = await ctx.prisma.book.create({ data: { title: 'کتاب بارکد', language: 'fa' } });

      await ctx.prisma.bookCopy.create({
        data: {
          bookId: book.id, branchId: branch.id, copyNumber: 1,
          accessionNumber: 'DUP-ACC-1', barcode: 'DUP-BARCODE', status: 'AVAILABLE',
        },
      });

      await expect(
        ctx.prisma.bookCopy.create({
          data: {
            bookId: book.id, branchId: branch.id, copyNumber: 2,
            accessionNumber: 'DUP-ACC-2', barcode: 'DUP-BARCODE', status: 'AVAILABLE',
          },
        }),
      ).rejects.toThrow();
    });

    it('شماره نسخه باید مثبت باشد', async () => {
      const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
      const book = await ctx.prisma.book.create({ data: { title: 'کتاب شماره', language: 'fa' } });

      await expect(
        ctx.prisma.bookCopy.create({
          data: {
            bookId: book.id, branchId: branch.id, copyNumber: 0,
            accessionNumber: 'ZERO-ACC', barcode: 'ZERO-BC', status: 'AVAILABLE',
          },
        }),
      ).rejects.toThrow();
    });

    it('مبلغ جریمه نمی‌تواند منفی باشد', async () => {
      const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
      const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();
      const member = await ctx.prisma.member.create({
        data: {
          branchId: branch.id, membershipTypeId: membershipType.id,
          memberCode: 'NEG-FINE', firstName: 'منفی', lastName: 'آزمایشی', status: 'ACTIVE',
        },
      });

      await expect(
        ctx.prisma.fine.create({
          data: {
            memberId: member.id, branchId: branch.id, type: 'OTHER',
            amount: -1000, status: 'UNPAID', reason: 'تست منفی',
          },
        }),
      ).rejects.toThrow();
    });

    it('کتاب نمی‌تواند والد خودش باشد', async () => {
      const book = await ctx.prisma.book.create({ data: { title: 'کتاب حلقه', language: 'fa' } });

      await expect(
        ctx.prisma.book.update({
          where: { id: book.id },
          data: { parentBookId: book.id },
        }),
      ).rejects.toThrow();
    });

    it('فقط یک شعبه می‌تواند پیش‌فرض باشد', async () => {
      await expect(
        ctx.prisma.branch.create({
          data: { code: 'SECOND', name: 'شعبه دوم', isDefault: true },
        }),
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  حذف نرم — قانون ۳۵
  // ═══════════════════════════════════════════════════════════════════════

  it('حذف کتاب، رکورد را پاک نمی‌کند و تاریخچه امانت باقی می‌ماند', async () => {
    await resetOperationalData(ctx.prisma);
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    const book = await ctx.prisma.book.create({ data: { title: 'کتاب حذفی', language: 'fa' } });
    const copy = await ctx.prisma.bookCopy.create({
      data: {
        bookId: book.id, branchId: branch.id, copyNumber: 1,
        accessionNumber: 'SOFT-ACC', barcode: 'SOFT-BC', status: 'AVAILABLE', isLoanable: true,
      },
    });
    const member = await ctx.prisma.member.create({
      data: {
        branchId: branch.id, membershipTypeId: membershipType.id,
        memberCode: 'SOFT-M', firstName: 'حذف', lastName: 'نرم', status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });

    // یک امانت کامل: گرفتن و برگرداندن
    await ctx.http().post('/api/loans/checkout').set('Cookie', manager.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);
    await ctx.http().post('/api/loans/return').set('Cookie', manager.cookie)
      .send({ barcode: 'SOFT-BC' }).expect(201);

    /*
     * سرور اجازه بایگانی کتابِ دارای نسخه فیزیکی را نمی‌دهد — رکورد
     * کتاب‌شناختی نباید بی‌صدا ناپدید شود در حالی که جلدهایش هنوز در
     * قفسه‌اند. پس ابتدا نسخه بایگانی می‌شود.
     */
    const blocked = await ctx.http().delete(`/api/books/${book.id}`)
      .set('Cookie', manager.cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/نسخه/);

    await ctx.http().delete(`/api/copies/${copy.id}`).set('Cookie', manager.cookie).expect(200);
    await ctx.http().delete(`/api/books/${book.id}`).set('Cookie', manager.cookie).expect(200);

    // رکورد هنوز در دیتابیس است، فقط علامت حذف خورده
    const stored = await ctx.prisma.book.findUnique({ where: { id: book.id } });
    expect(stored).not.toBeNull();
    expect(stored?.deletedAt).not.toBeNull();

    // و تاریخچه امانت دست‌نخورده مانده — همان چیزی که قانون ۳۵ می‌خواهد
    const loans = await ctx.prisma.loan.count({ where: { copyId: copy.id } });
    expect(loans).toBe(1);

    // از فهرست عادی بیرون است
    const list = await ctx.http().get('/api/books')
      .query({ q: 'کتاب حذفی' }).set('Cookie', manager.cookie).expect(200);
    expect(list.body.data).toHaveLength(0);

    // اما با فیلتر صریح دیده می‌شود
    const withDeleted = await ctx.http().get('/api/books')
      .query({ q: 'کتاب حذفی', includeDeleted: 'true' })
      .set('Cookie', manager.cookie).expect(200);
    expect(withDeleted.body.data.length).toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  فیلترهای بولی — اشکالی که یک بار واقعاً رخ داد
  // ═══════════════════════════════════════════════════════════════════════

  it('فیلتر بولی «false» را false می‌فهمد، نه true', async () => {
    await resetOperationalData(ctx.prisma);
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });

    const withCopy = await ctx.prisma.book.create({
      data: { title: 'کتاب دارای نسخه', language: 'fa' },
    });
    await ctx.prisma.bookCopy.create({
      data: {
        bookId: withCopy.id, branchId: branch.id, copyNumber: 1,
        accessionNumber: 'BOOL-ACC', barcode: 'BOOL-BC', status: 'AVAILABLE',
      },
    });
    await ctx.prisma.book.create({ data: { title: 'کتاب بدون نسخه', language: 'fa' } });

    /*
     * `z.coerce.boolean()` رشته «false» را true می‌فهمد، چون هر رشته
     * ناتهی در JavaScript truthy است. نتیجه: همه فیلترهای بولی برعکس کار
     * می‌کردند. این تست همان حالت را می‌بندد.
     */
    const noCopies = await ctx.http().get('/api/books')
      .query({ hasCopies: 'false' }).set('Cookie', manager.cookie).expect(200);

    expect(noCopies.body.data.length).toBeGreaterThan(0);
    expect(noCopies.body.data.every((b: { copyCount: number }) => b.copyCount === 0)).toBe(true);

    const hasCopies = await ctx.http().get('/api/books')
      .query({ hasCopies: 'true' }).set('Cookie', manager.cookie).expect(200);

    expect(hasCopies.body.data.length).toBeGreaterThan(0);
    expect(hasCopies.body.data.every((b: { copyCount: number }) => b.copyCount > 0)).toBe(true);
  });
});
