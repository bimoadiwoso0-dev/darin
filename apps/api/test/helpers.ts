import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/**
 * ابزارهای مشترک تست‌های یکپارچه.
 *
 * برنامه دقیقاً مانند `main.ts` بالا می‌آید: همان `AppModule` (که خودش
 * Filter و Guard های سراسری را ثبت می‌کند)، همان Prefix و همان Cookie
 * Parser. تستی که برنامه‌ای متفاوت از Production بسازد، چیزی را تضمین
 * نمی‌کند.
 *
 * اعتبارسنجی ورودی در این پروژه با Pipe های Zod در خودِ Controller ها
 * انجام می‌شود، نه `ValidationPipe` سراسری؛ پس اینجا هم چیزی اضافه
 * نمی‌شود.
 */

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => request.SuperTest<request.Test>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    http: () => request(app.getHttpServer() as App),
  };
}

/**
 * پاک کردن داده‌های عملیاتی بین تست‌ها.
 *
 * جدول‌های پایه (مجوزها، نقش‌ها، تنظیمات، شعبه، انواع عضویت) دست‌نخورده
 * می‌مانند چون Seed هسته آنها را ساخته و ساختن دوباره‌شان در هر تست، کند
 * و بی‌فایده است.
 *
 * ترتیب حذف از برگ به ریشه است تا کلید خارجی نشکند.
 */
export async function resetOperationalData(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('TRUNCATE TABLE payments CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE fines CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE lost_reports CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE reservations CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE loans CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE inventory_scans CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE inventory_sessions CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE book_movements CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE book_copies CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE book_contributors CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE book_categories CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE book_tags CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE books CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE members CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE persons CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE publishers CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE TABLE audit_logs CASCADE'),
  ]);
}

/** ساخت کاربر تست با نقش مشخص و ورود به سامانه. */
export async function loginAs(
  ctx: TestContext,
  roleKey: string,
  username = `test_${roleKey.toLowerCase()}`,
): Promise<{ cookie: string[]; userId: string }> {
  const password = 'TestPassword12345';
  const { AuthService } = await import('../src/modules/auth/auth.service');

  const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const branch = await ctx.prisma.branch.findFirstOrThrow({ where: { isDefault: true } });

  const user = await ctx.prisma.user.upsert({
    where: { username },
    create: {
      username,
      fullName: `کاربر تست ${roleKey}`,
      passwordHash: await AuthService.hashPassword(password),
      branchId: branch.id,
      isActive: true,
    },
    update: {
      passwordHash: await AuthService.hashPassword(password),
      isActive: true,
      deletedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  await ctx.prisma.userRole.deleteMany({ where: { userId: user.id } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  const response = await ctx
    .http()
    .post('/api/auth/login')
    .send({ username, password })
    .expect(200);

  const cookie = response.headers['set-cookie'] as unknown as string[];
  return { cookie, userId: user.id };
}

/** داده حداقلی برای تست‌های امانت: یک کتاب، یک نسخه موجود، یک عضو فعال. */
export async function seedLoanFixture(
  prisma: PrismaService,
  options: { barcode?: string; memberCode?: string } = {},
) {
  const branch = await prisma.branch.findFirstOrThrow({ where: { isDefault: true } });
  const membershipType = await prisma.membershipType.findFirstOrThrow();

  const book = await prisma.book.create({
    data: { title: 'کتاب آزمایشی امانت', language: 'fa' },
  });

  const copy = await prisma.bookCopy.create({
    data: {
      bookId: book.id,
      branchId: branch.id,
      copyNumber: 1,
      accessionNumber: options.barcode ?? `TEST-ACC-${Date.now()}`,
      barcode: options.barcode ?? `TEST-BC-${Date.now()}`,
      status: 'AVAILABLE',
      isLoanable: true,
    },
  });

  const member = await prisma.member.create({
    data: {
      branchId: branch.id,
      membershipTypeId: membershipType.id,
      memberCode: options.memberCode ?? `TEST-M-${Date.now()}`,
      firstName: 'عضو',
      lastName: 'آزمایشی',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
  });

  return { book, copy, member, branch, membershipType };
}
