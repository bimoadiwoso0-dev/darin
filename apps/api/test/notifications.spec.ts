import type { INestApplication } from '@nestjs/common';
import {
  createTestApp, loginAs, resetOperationalData, seedLoanFixture, type TestContext,
} from './helpers';

/**
 * صندوق یادآوری کتابدار.
 *
 * ── چرا این ماژول اضافه شد ──────────────────────────────────────────────
 * کار نگهداری شبانه برای هر امانتِ نزدیک به موعد یک ردیف اعلان می‌ساخت،
 * ولی هیچ Endpoint و هیچ صفحه‌ای آن را نمی‌خواند. ردیف‌ها ساخته می‌شدند و
 * تا ابد `PENDING` می‌ماندند. این تست‌ها هم تولید و هم خوانده‌شدنشان را
 * می‌سنجند تا دوباره به همان حالت برنگردد.
 */
describe('یادآوری‌های کتابدار', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let librarian: { cookie: string[]; userId: string };
  let viewer: { cookie: string[]; userId: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    librarian = await loginAs(ctx, 'LIBRARIAN');
    viewer = await loginAs(ctx, 'REPORT_VIEWER');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetOperationalData(ctx.prisma);
    await ctx.prisma.notification.deleteMany({});
  });

  /** امانتی که موعدش فرداست — کار شبانه باید برایش یادآوری بسازد. */
  async function seedDueSoonLoan(barcode: string, memberCode: string) {
    const fixture = await seedLoanFixture(ctx.prisma, { barcode, memberCode });
    const loanedAt = new Date(Date.now() - 6 * 86_400_000);
    const dueAt = new Date(Date.now() + 86_400_000);

    await ctx.prisma.loan.create({
      data: {
        loanNumber: `L-${barcode}`,
        copyId: fixture.copy.id,
        memberId: fixture.member.id,
        branchId: fixture.branch.id,
        status: 'ACTIVE',
        loanedAt,
        dueAt,
        originalDueAt: dueAt,
      },
    });
    await ctx.prisma.bookCopy.update({
      where: { id: fixture.copy.id },
      data: { status: 'ON_LOAN' },
    });
    return fixture;
  }

  it('کار شبانه یادآوری می‌سازد و یادآوری از API خوانده می‌شود', async () => {
    const fixture = await seedDueSoonLoan('NOTIF-BC-1', 'M-NOTIF-1');

    // اجرای کار شبانه — همان چیزی که هر شب ساعت ۱ اجرا می‌شود
    const { MaintenanceService } = await import(
      '../src/modules/maintenance/maintenance.service'
    );
    const maintenance = app.get(MaintenanceService);
    const created = await maintenance.createDueSoonNotifications();
    expect(created).toBeGreaterThan(0);

    const res = await ctx.http().get('/api/notifications')
      .set('Cookie', librarian.cookie).expect(200);

    const row = res.body.data.find(
      (n: { member: { memberCode: string } | null }) =>
        n.member?.memberCode === fixture.member.memberCode,
    );

    expect(row).toBeDefined();
    expect(row.type).toBe('DUE_SOON');
    expect(row.status).toBe('PENDING');

    // اطلاعات تماس همراه یادآوری می‌آید — بدون آن، یادآوری برای کتابدار
    // بی‌فایده است و باید به پروفایل عضو برود و برگردد.
    expect(row.member.fullName).toBeTruthy();
    expect(row.member).toHaveProperty('mobile');

    /*
     * تاریخ داخل متن باید شمسی، با ارقام فارسی و با صفر پیشوند باشد.
     * `\d` در جاوااسکریپت فقط ارقام لاتین را می‌گیرد، پس بازه فارسی صریح
     * نوشته شده است.
     */
    expect(row.body).toMatch(/۱۴[۰-۹]{2}\/[۰-۹]{2}\/[۰-۹]{2}/u);
  });

  it('برای یک امانت دو بار یادآوری نمی‌سازد', async () => {
    await seedDueSoonLoan('NOTIF-BC-2', 'M-NOTIF-2');

    const { MaintenanceService } = await import(
      '../src/modules/maintenance/maintenance.service'
    );
    const maintenance = app.get(MaintenanceService);

    const first = await maintenance.createDueSoonNotifications();
    // شب دوم: همان امانت هنوز نزدیک موعد است، ولی عضو نباید پیام تکراری بگیرد
    const second = await maintenance.createDueSoonNotifications();

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it('شمارش، فقط یادآوری‌های پیگیری‌نشده را می‌شمارد', async () => {
    await seedDueSoonLoan('NOTIF-BC-3', 'M-NOTIF-3');
    const { MaintenanceService } = await import(
      '../src/modules/maintenance/maintenance.service'
    );
    await app.get(MaintenanceService).createDueSoonNotifications();

    const before = await ctx.http().get('/api/notifications/summary')
      .set('Cookie', librarian.cookie).expect(200);
    expect(before.body.pending).toBeGreaterThan(0);

    const list = await ctx.http().get('/api/notifications')
      .query({ status: 'PENDING' }).set('Cookie', librarian.cookie).expect(200);
    const id = list.body.data[0].id;

    await ctx.http().post(`/api/notifications/${id}/handled`)
      .send({}).set('Cookie', librarian.cookie).expect(200);

    const after = await ctx.http().get('/api/notifications/summary')
      .set('Cookie', librarian.cookie).expect(200);
    expect(after.body.pending).toBe(before.body.pending - 1);
  });

  it('علامت زدن دوباره، وضعیت را خراب نمی‌کند', async () => {
    const notice = await ctx.prisma.notification.create({
      data: {
        channel: 'IN_APP', type: 'SYSTEM', status: 'PENDING',
        userId: librarian.userId,
        title: 'آزمون', body: 'آزمون', payload: {},
      },
    });

    const first = await ctx.http().post(`/api/notifications/${notice.id}/handled`)
      .send({}).set('Cookie', librarian.cookie).expect(200);
    const second = await ctx.http().post(`/api/notifications/${notice.id}/handled`)
      .send({}).set('Cookie', librarian.cookie).expect(200);

    expect(first.body.status).toBe('SENT');
    expect(second.body.status).toBe('SENT');

    // `sentAt` نباید با کلیک دوم جابه‌جا شود
    const stored = await ctx.prisma.notification.findUniqueOrThrow({
      where: { id: notice.id }, select: { sentAt: true },
    });
    expect(stored.sentAt).not.toBeNull();
  });

  /*
   * مرز مجوز.
   *
   * «ناظر گزارش‌ها» مجوز `loans.view` دارد، پس فهرست را می‌بیند. اما
   * «پیگیری شد» زدن ادعای انجام کار است و نقشی که فقط باید نگاه کند نباید
   * بتواند وضعیت را تغییر دهد. اگر خواندن و نوشتن یک مجوز داشتند، این
   * تست رد می‌شد.
   */
  it('ناظر گزارش‌ها فهرست را می‌بیند ولی نمی‌تواند علامت بزند', async () => {
    const notice = await ctx.prisma.notification.create({
      data: {
        channel: 'IN_APP', type: 'SYSTEM', status: 'PENDING',
        userId: librarian.userId,
        title: 'آزمون مجوز', body: 'آزمون مجوز', payload: {},
      },
    });

    await ctx.http().get('/api/notifications')
      .set('Cookie', viewer.cookie).expect(200);

    const denied = await ctx.http().post(`/api/notifications/${notice.id}/handled`)
      .send({}).set('Cookie', viewer.cookie).expect(403);

    expect(denied.body.code).toBe('FORBIDDEN');
    expect(denied.body.message).toContain('یادآوری');
    // پیام خطا فارسی است و Stack Trace ندارد (قانون ۷۵)
    expect(JSON.stringify(denied.body)).not.toContain('at ');

    const stored = await ctx.prisma.notification.findUniqueOrThrow({
      where: { id: notice.id }, select: { status: true },
    });
    expect(stored.status).toBe('PENDING');
  });

  it('علامت زدن گروهی فقط همان نوع را می‌بندد', async () => {
    await ctx.prisma.notification.createMany({
      data: [
        { channel: 'IN_APP', type: 'DUE_SOON', status: 'PENDING', userId: librarian.userId, title: 'الف', body: 'الف', payload: {} },
        { channel: 'IN_APP', type: 'DUE_SOON', status: 'PENDING', userId: librarian.userId, title: 'ب', body: 'ب', payload: {} },
        { channel: 'IN_APP', type: 'FINE_ISSUED', status: 'PENDING', userId: librarian.userId, title: 'ج', body: 'ج', payload: {} },
      ],
    });

    const result = await ctx.http().post('/api/notifications/handle-all')
      .send({ type: 'DUE_SOON' }).set('Cookie', librarian.cookie).expect(200);

    expect(result.body.updated).toBe(2);

    const remaining = await ctx.prisma.notification.count({ where: { status: 'PENDING' } });
    expect(remaining).toBe(1);
  });
});
