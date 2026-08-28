import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  loginAs,
  resetOperationalData,
  seedLoanFixture,
  type TestContext,
} from './helpers';

/**
 * تست‌های امانت — قلب سامانه (قوانین ۱۹–۲۵، ۷۸، ۷۹).
 *
 * ── چرا این تست‌ها مهم‌ترین‌اند ──────────────────────────────────────────
 * اشتباه در کاتالوگ یعنی یک رکورد غلط که قابل اصلاح است. اشتباه در امانت
 * یعنی کتابی که سیستم می‌گوید دست کسی است اما نیست، یا دو نفر که هر دو
 * فکر می‌کنند یک کتاب را گرفته‌اند. این دسته اشتباه، اعتماد به کل سامانه
 * را از بین می‌برد.
 */
describe('امانت و بازگشت', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let librarian: { cookie: string[]; userId: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    librarian = await loginAs(ctx, 'LIBRARIAN');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetOperationalData(ctx.prisma);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  همروندی — قانون ۷۹
  // ═══════════════════════════════════════════════════════════════════════

  it('دو درخواست هم‌زمان برای یک نسخه: فقط یکی موفق می‌شود', async () => {
    const { copy } = await seedLoanFixture(ctx.prisma, { barcode: 'RACE-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    // دو عضو متفاوت تا محدودیت «یک عضو، یک نسخه» دخالت نکند
    const [memberA, memberB] = await Promise.all([
      ctx.prisma.member.create({
        data: {
          branchId: branch.id, membershipTypeId: membershipType.id,
          memberCode: 'RACE-A', firstName: 'الف', lastName: 'آزمایشی',
          status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      }),
      ctx.prisma.member.create({
        data: {
          branchId: branch.id, membershipTypeId: membershipType.id,
          memberCode: 'RACE-B', firstName: 'ب', lastName: 'آزمایشی',
          status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      }),
    ]);

    // هر دو درخواست بدون انتظار برای دیگری فرستاده می‌شوند
    const results = await Promise.allSettled([
      ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
        .send({ memberId: memberA.id, copyIds: [copy.id] }),
      ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
        .send({ memberId: memberB.id, copyIds: [copy.id] }),
    ]);

    const statuses = results.map((r) =>
      r.status === 'fulfilled' ? r.value.status : 500,
    );
    const succeeded = statuses.filter((s) => s === 201 || s === 200).length;

    expect(succeeded).toBe(1);

    // و در دیتابیس دقیقاً یک امانت باز برای این نسخه هست
    const openLoans = await ctx.prisma.loan.count({
      where: { copyId: copy.id, status: { in: ['ACTIVE', 'OVERDUE'] } },
    });
    expect(openLoans).toBe(1);

    const after = await ctx.prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(after.status).toBe('ON_LOAN');
  });

  it('ایندکس یکتای جزئی، امانت دوم روی همان نسخه را در سطح دیتابیس رد می‌کند', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'UNIQ-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });

    const due = new Date(Date.now() + 86_400_000);
    await ctx.prisma.loan.create({
      data: {
        loanNumber: 'L-TEST-1', branchId: branch.id, copyId: copy.id, memberId: member.id,
        status: 'ACTIVE', loanedAt: new Date(), dueAt: due, originalDueAt: due,
      },
    });

    // دور زدن کامل لایه سرویس: مستقیم در دیتابیس امانت دوم می‌سازیم
    await expect(
      ctx.prisma.loan.create({
        data: {
          loanNumber: 'L-TEST-2', branchId: branch.id, copyId: copy.id, memberId: member.id,
          status: 'ACTIVE', loanedAt: new Date(), dueAt: due, originalDueAt: due,
        },
      }),
    ).rejects.toThrow();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  چرخه کامل امانت
  // ═══════════════════════════════════════════════════════════════════════

  it('امانت، وضعیت نسخه و موعد بازگشت را درست تنظیم می‌کند', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'FLOW-0001' });

    const response = await ctx
      .http()
      .post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] })
      .expect(201);

    expect(response.body.loans).toHaveLength(1);
    const loan = response.body.loans[0];
    expect(new Date(loan.dueAt).getTime()).toBeGreaterThan(Date.now());

    const updated = await ctx.prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(updated.status).toBe('ON_LOAN');
  });

  it('بازگشت به‌موقع، نسخه را آزاد می‌کند و جریمه‌ای نمی‌سازد', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'RET-0001' });

    await ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    const response = await ctx
      .http()
      .post('/api/loans/return')
      .set('Cookie', librarian.cookie)
      .send({ barcode: 'RET-0001' })
      .expect(201);

    expect(response.body.wasOverdue).toBe(false);
    expect(response.body.fine).toBeNull();

    const updated = await ctx.prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(updated.status).toBe('AVAILABLE');

    const fines = await ctx.prisma.fine.count({ where: { memberId: member.id } });
    expect(fines).toBe(0);
  });

  it('بازگشت با دیرکرد، جریمه را بر پایه تنظیمات محاسبه می‌کند', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'LATE-0001' });

    await ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    /*
     * کل امانت را به گذشته می‌بریم تا دیرکرد واقعی شود.
     *
     * تاریخ امانت هم عقب کشیده می‌شود چون CHECK constraint دیتابیس
     * (`loans_due_after_loaned`) موعدِ پیش از تاریخ امانت را نمی‌پذیرد —
     * همان محافظی که در Production جلوی داده بی‌معنا را می‌گیرد.
     */
    const overdueDays = 3;
    const loanPeriodDays = 14;
    await ctx.prisma.loan.updateMany({
      where: { copyId: copy.id, status: 'ACTIVE' },
      data: {
        loanedAt: new Date(Date.now() - (overdueDays + loanPeriodDays) * 86_400_000),
        dueAt: new Date(Date.now() - overdueDays * 86_400_000),
      },
    });

    const response = await ctx
      .http()
      .post('/api/loans/return')
      .set('Cookie', librarian.cookie)
      .send({ barcode: 'LATE-0001' })
      .expect(201);

    expect(response.body.wasOverdue).toBe(true);
    expect(response.body.overdueDays).toBe(overdueDays);
    expect(response.body.fine).not.toBeNull();

    // مبلغ باید حاصل‌ضرب روزها در نرخ روزانه تنظیمات باشد، نه عددی ثابت در کد
    const setting = await ctx.prisma.setting.findUniqueOrThrow({
      where: { key: 'fine.dailyAmount' },
    });
    const dailyAmount = Number(setting.value);
    expect(response.body.fine.amount).toBe(overdueDays * dailyAmount);
  });

  it('نسخه‌ای که در امانت است دوباره امانت داده نمی‌شود', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'BUSY-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    await ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    const other = await ctx.prisma.member.create({
      data: {
        branchId: branch.id, membershipTypeId: membershipType.id,
        memberCode: 'BUSY-B', firstName: 'دیگر', lastName: 'آزمایشی',
        status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });

    const response = await ctx
      .http()
      .post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: other.id, copyIds: [copy.id] });

    expect(response.status).toBeGreaterThanOrEqual(400);
    // پیام باید فارسی و قابل فهم باشد، نه خطای فنی (قانون ۷۵)
    expect(response.body.message).toEqual(expect.any(String));
    expect(response.body.message).not.toMatch(/prisma|constraint|sql/i);
  });

  it('عضو غیرفعال نمی‌تواند کتاب امانت بگیرد', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'INACT-0001' });
    await ctx.prisma.member.update({
      where: { id: member.id },
      data: { status: 'SUSPENDED' },
    });

    const response = await ctx
      .http()
      .post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] });

    expect(response.status).toBeGreaterThanOrEqual(400);

    const loans = await ctx.prisma.loan.count({ where: { copyId: copy.id } });
    expect(loans).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  رزرو — قانون ۲۶ تا ۲۸
  // ═══════════════════════════════════════════════════════════════════════

  it('بازگشت کتابِ رزروشده، نسخه را کنار می‌گذارد و به قفسه برنمی‌گرداند', async () => {
    const { copy, book, member } = await seedLoanFixture(ctx.prisma, { barcode: 'RSV-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    await ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    // عضو دوم همان عنوان را رزرو می‌کند
    const waiting = await ctx.prisma.member.create({
      data: {
        branchId: branch.id, membershipTypeId: membershipType.id,
        memberCode: 'RSV-W', firstName: 'منتظر', lastName: 'آزمایشی',
        status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });

    const manager = await loginAs(ctx, 'LIBRARY_MANAGER');
    await ctx.http().post('/api/reservations').set('Cookie', manager.cookie)
      .send({ bookId: book.id, memberId: waiting.id }).expect(201);

    const response = await ctx.http().post('/api/loans/return')
      .set('Cookie', librarian.cookie).send({ barcode: 'RSV-0001' }).expect(201);

    // نسخه نباید «موجود» شود — برای عضو در صف کنار گذاشته می‌شود
    expect(response.body.heldForReservation).not.toBeNull();
    expect(response.body.heldForReservation.memberCode).toBe('RSV-W');

    const updated = await ctx.prisma.bookCopy.findUniqueOrThrow({ where: { id: copy.id } });
    expect(updated.status).toBe('RESERVED_HOLD');
  });

  it('نسخه کنارگذاشته‌شده فقط به عضو صاحب رزرو داده می‌شود', async () => {
    const { copy, book, member } = await seedLoanFixture(ctx.prisma, { barcode: 'HOLD-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    await ctx.http().post('/api/loans/checkout').set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    const [holder, stranger] = await Promise.all([
      ctx.prisma.member.create({
        data: {
          branchId: branch.id, membershipTypeId: membershipType.id,
          memberCode: 'HOLD-H', firstName: 'صاحب', lastName: 'رزرو',
          status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      }),
      ctx.prisma.member.create({
        data: {
          branchId: branch.id, membershipTypeId: membershipType.id,
          memberCode: 'HOLD-S', firstName: 'غریبه', lastName: 'آزمایشی',
          status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
        },
      }),
    ]);

    const manager = await loginAs(ctx, 'LIBRARY_MANAGER');
    await ctx.http().post('/api/reservations').set('Cookie', manager.cookie)
      .send({ bookId: book.id, memberId: holder.id }).expect(201);
    await ctx.http().post('/api/loans/return')
      .set('Cookie', librarian.cookie).send({ barcode: 'HOLD-0001' }).expect(201);

    // عضو غریبه نباید بتواند نسخه کنارگذاشته‌شده را بگیرد
    const denied = await ctx.http().post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: stranger.id, copyIds: [copy.id] });
    expect(denied.status).toBeGreaterThanOrEqual(400);

    // اما صاحب رزرو باید بتواند
    const allowed = await ctx.http().post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: holder.id, copyIds: [copy.id] });
    expect(allowed.status).toBe(201);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  تمدید
  // ═══════════════════════════════════════════════════════════════════════

  it('تمدید موعد را جلو می‌برد و شمارنده تمدید را افزایش می‌دهد', async () => {
    const { copy, member } = await seedLoanFixture(ctx.prisma, { barcode: 'RNW-0001' });

    const checkout = await ctx.http().post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    const loanId = checkout.body.loans[0].id;
    const originalDue = new Date(checkout.body.loans[0].dueAt).getTime();

    const response = await ctx.http().post(`/api/loans/${loanId}/renew`)
      .set('Cookie', librarian.cookie).expect(201);

    expect(new Date(response.body.dueAt).getTime()).toBeGreaterThan(originalDue);
    expect(response.body.renewalCount).toBe(1);
  });

  it('وقتی کسی در صف رزرو باشد، تمدید رد می‌شود', async () => {
    const { copy, book, member } = await seedLoanFixture(ctx.prisma, { barcode: 'RNWB-0001' });
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const membershipType = await ctx.prisma.membershipType.findFirstOrThrow();

    const checkout = await ctx.http().post('/api/loans/checkout')
      .set('Cookie', librarian.cookie)
      .send({ memberId: member.id, copyIds: [copy.id] }).expect(201);

    const waiting = await ctx.prisma.member.create({
      data: {
        branchId: branch.id, membershipTypeId: membershipType.id,
        memberCode: 'RNWB-W', firstName: 'منتظر', lastName: 'تمدید',
        status: 'ACTIVE', expiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });

    const manager = await loginAs(ctx, 'LIBRARY_MANAGER');
    await ctx.http().post('/api/reservations').set('Cookie', manager.cookie)
      .send({ bookId: book.id, memberId: waiting.id }).expect(201);

    const response = await ctx.http()
      .post(`/api/loans/${checkout.body.loans[0].id}/renew`)
      .set('Cookie', librarian.cookie);

    expect(response.status).toBeGreaterThanOrEqual(400);
    // حق کسی که در صف بوده، با مجوز مدیر هم قابل عبور نیست
    expect(response.body.details?.overridable).not.toBe(true);
  });
});
