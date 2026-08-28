import type { INestApplication } from '@nestjs/common';
import { createTestApp, loginAs, type TestContext } from './helpers';

/**
 * احراز هویت و کنترل دسترسی (قوانین ۷۱–۷۷، ۱۱۰).
 *
 * ── چرا این تست‌ها ─────────────────────────────────────────────────────
 * نقص در این لایه یعنی کسی می‌تواند کاری کند که نباید. برخلاف اشتباه در
 * محاسبه جریمه، این نوع نقص خودش را نشان نمی‌دهد تا وقتی دیر شده باشد.
 */
describe('احراز هویت و دسترسی', () => {
  let ctx: TestContext;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  ورود
  // ═══════════════════════════════════════════════════════════════════════

  it('نام کاربری اشتباه و رمز اشتباه پیام یکسان می‌گیرند', async () => {
    await loginAs(ctx, 'LIBRARIAN', 'probe_user');

    const wrongUser = await ctx.http().post('/api/auth/login')
      .send({ username: 'this_user_does_not_exist', password: 'AnyPassword12345' });

    const wrongPassword = await ctx.http().post('/api/auth/login')
      .send({ username: 'probe_user', password: 'WrongPassword12345' });

    expect(wrongUser.status).toBe(wrongPassword.status);
    // پیام متفاوت یعنی مهاجم می‌تواند فهرست نام‌های کاربری معتبر را بسازد
    expect(wrongUser.body.message).toBe(wrongPassword.body.message);
  });

  it('پاسخ ورود، رمز یا Hash آن را برنمی‌گرداند', async () => {
    const { cookie } = await loginAs(ctx, 'LIBRARIAN', 'leak_probe');
    const response = await ctx.http().get('/api/auth/me').set('Cookie', cookie).expect(200);

    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/passwordHash/i);
    expect(body).not.toMatch(/\$argon2/);
  });

  it('توکن در کوکی HttpOnly قرار می‌گیرد، نه در بدنه پاسخ', async () => {
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'LIBRARIAN' } });

    const user = await ctx.prisma.user.upsert({
      where: { username: 'cookie_probe' },
      create: {
        username: 'cookie_probe',
        fullName: 'آزمون کوکی',
        passwordHash: await AuthService.hashPassword('TestPassword12345'),
        branchId: branch.id,
      },
      update: { passwordHash: await AuthService.hashPassword('TestPassword12345') },
    });
    await ctx.prisma.userRole.deleteMany({ where: { userId: user.id } });
    await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const response = await ctx.http().post('/api/auth/login')
      .send({ username: 'cookie_probe', password: 'TestPassword12345' })
      .expect(200);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.includes('SameSite'))).toBe(true);

    // توکن نباید در بدنه باشد؛ وگرنه JavaScript صفحه می‌تواند بخواندش
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('درخواست بدون احراز هویت رد می‌شود', async () => {
    await ctx.http().get('/api/books').expect(401);
    await ctx.http().get('/api/members').expect(401);
    await ctx.http().get('/api/settings').expect(401);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  کنترل دسترسی مبتنی بر نقش
  // ═══════════════════════════════════════════════════════════════════════

  it('هر نقش فقط به بخش‌های مجازش دسترسی دارد', async () => {
    const assistant = await loginAs(ctx, 'ASSISTANT');
    const manager = await loginAs(ctx, 'LIBRARY_MANAGER');

    // دستیار کتابدار: می‌تواند کتاب ببیند اما تنظیمات و کاربران نه
    await ctx.http().get('/api/books').set('Cookie', assistant.cookie).expect(200);
    await ctx.http().get('/api/settings').set('Cookie', assistant.cookie).expect(403);
    await ctx.http().get('/api/users').set('Cookie', assistant.cookie).expect(403);

    // مدیر کتابخانه: تنظیمات و کاربران را می‌بیند
    await ctx.http().get('/api/settings').set('Cookie', manager.cookie).expect(200);
    await ctx.http().get('/api/users').set('Cookie', manager.cookie).expect(200);
  });

  it('پیام رد دسترسی، نام مجوز موردنیاز را به فارسی می‌گوید', async () => {
    const assistant = await loginAs(ctx, 'ASSISTANT');
    const response = await ctx.http().get('/api/settings')
      .set('Cookie', assistant.cookie).expect(403);

    expect(response.body.message).toMatch(/دسترسی/);
    // نه کلید انگلیسی مجوز، نه نام کلاس Guard
    expect(response.body.message).not.toMatch(/settings\.view|Guard|Forbidden/);
  });

  it('مدیر ارشد به همه‌چیز دسترسی دارد بدون آنکه مجوزها یکی‌یکی داده شوند', async () => {
    const superAdmin = await loginAs(ctx, 'SUPER_ADMIN');

    await ctx.http().get('/api/settings').set('Cookie', superAdmin.cookie).expect(200);
    await ctx.http().get('/api/users').set('Cookie', superAdmin.cookie).expect(200);
    await ctx.http().get('/api/roles').set('Cookie', superAdmin.cookie).expect(200);
    await ctx.http().get('/api/backups').set('Cookie', superAdmin.cookie).expect(200);
    await ctx.http().get('/api/audit-logs').set('Cookie', superAdmin.cookie).expect(200);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  چرخش و تشخیص استفاده مجدد از توکن
  // ═══════════════════════════════════════════════════════════════════════

  it('توکن تازه‌سازی پس از استفاده باطل می‌شود و استفاده دوباره کل زنجیره را می‌بندد', async () => {
    const { cookie } = await loginAs(ctx, 'LIBRARIAN', 'rotation_probe');

    // بار اول: توکن تازه می‌شود و کوکی جدید می‌آید
    const first = await ctx.http().post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    const rotated = first.headers['set-cookie'] as unknown as string[];
    expect(rotated).toBeDefined();

    // بار دوم با همان توکن قدیمی: باید رد شود (استفاده مجدد)
    const replay = await ctx.http().post('/api/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);

    /*
     * و مهم‌تر: توکن جدید هم باید باطل شده باشد.
     *
     * استفاده مجدد از یک توکن باطل یعنی احتمالاً کسی آن را دزدیده است. در
     * این حالت بستن فقط توکن دزدیده‌شده کافی نیست — کل زنجیره باطل می‌شود
     * تا مهاجم و قربانی هر دو بیرون بیفتند و کاربر مجبور به ورود دوباره شود.
     */
    const afterReuse = await ctx.http().post('/api/auth/refresh').set('Cookie', rotated);
    expect(afterReuse.status).toBe(401);
  });

  it('خروج، نشست را می‌بندد', async () => {
    const { cookie } = await loginAs(ctx, 'LIBRARIAN', 'logout_probe');

    await ctx.http().get('/api/auth/me').set('Cookie', cookie).expect(200);
    await ctx.http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await ctx.http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  عدم نشت اطلاعات فنی — قانون ۷۵
  // ═══════════════════════════════════════════════════════════════════════

  it('خطاها Stack Trace یا جزئیات دیتابیس را فاش نمی‌کنند', async () => {
    const { cookie } = await loginAs(ctx, 'LIBRARIAN', 'error_probe');

    // شناسه‌ای که وجود ندارد
    const notFound = await ctx.http()
      .get('/api/books/00000000-0000-4000-8000-000000000000')
      .set('Cookie', cookie);

    const body = JSON.stringify(notFound.body);
    expect(body).not.toMatch(/at .*\.ts:\d+/); // Stack Trace
    expect(body).not.toMatch(/prisma|PrismaClient/i);
    expect(body).not.toMatch(/postgres|relation .* does not exist/i);
    expect(notFound.body.message).toEqual(expect.any(String));
  });

  it('ورودی نامعتبر، خطای فارسی با نام فیلد می‌دهد', async () => {
    const { cookie } = await loginAs(ctx, 'LIBRARY_MANAGER', 'validation_probe');

    const response = await ctx.http().post('/api/books')
      .set('Cookie', cookie)
      .send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details).toBeDefined();
    // پیام باید فارسی باشد، نه متن پیش‌فرض کتابخانه اعتبارسنجی
    const messages = JSON.stringify(response.body.details);
    expect(messages).toMatch(/[؀-ۿ]/);
  });
});
