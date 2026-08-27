/**
 * Seed هسته سیستم — بدون داده نمایشی.
 *
 * این اسکریپت **idempotent** است: اجرای مکرر آن امن است و داده موجود را
 * خراب نمی‌کند. در هر استقرار (Deploy) اجرا می‌شود تا مجوزهای جدید کد به
 * دیتابیس اضافه شوند.
 *
 * چیزی که اینجا ساخته می‌شود، «داده سیستمی» است نه «داده نمایشی»:
 *   مجوزها، نقش‌ها، تنظیمات پیش‌فرض، قوانین شماره‌گذاری، شعبه پیش‌فرض.
 *
 * حساب مدیر اینجا ساخته **نمی‌شود** — رمز عبور نباید در کد باشد (قانون ۱۱۰).
 * ساخت مدیر در Setup Wizard انجام می‌شود.
 */
import {
  DEFAULT_NUMBERING_RULES,
  DEFAULT_SETTINGS,
  PERMISSIONS,
  SETTING_GROUPS,
  SYSTEM_ROLES,
} from '@darin/shared';
import type { PrismaClient } from '../src/generated/prisma/client.js';

/** گروه هر کلید تنظیم را از فهرست گروه‌ها پیدا می‌کند. */
function groupOfSetting(key: string): string {
  for (const [group, def] of Object.entries(SETTING_GROUPS)) {
    if ((def.keys as readonly string[]).includes(key)) return group;
  }
  return key.split('.')[0] ?? 'system';
}

/** تنظیماتی که بدون احراز هویت قابل خواندن‌اند (صفحه ورود به آنها نیاز دارد). */
const PUBLIC_SETTING_KEYS = new Set([
  'library.name',
  'library.logoAttachmentId',
  'library.locale',
  'library.timezone',
  'system.setupCompleted',
]);

export async function seedPermissions(prisma: PrismaClient): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, group: p.group, label: p.label },
      update: { group: p.group, label: p.label },
    });
  }

  // مجوزهایی که از کد حذف شده‌اند دیگر معتبر نیستند و باید پاک شوند،
  // وگرنه نقش‌ها به مجوزی اشاره می‌کنند که هیچ Guard ای آن را بررسی نمی‌کند.
  const validKeys = PERMISSIONS.map((p) => p.key);
  const removed = await prisma.permission.deleteMany({ where: { key: { notIn: validKeys } } });
  if (removed.count > 0) {
    console.log(`  ↳ ${removed.count} مجوز منسوخ حذف شد`);
  }
  console.log(`✔ ${PERMISSIONS.length} مجوز همگام‌سازی شد`);
}

export async function seedRoles(prisma: PrismaClient): Promise<void> {
  const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  for (const def of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: { key: def.key, name: def.name, description: def.description, isSystem: true },
      update: { name: def.name, description: def.description, isSystem: true },
    });

    // SUPER_ADMIN تمام مجوزها را به‌صورت ضمنی دارد و ردیف RolePermission نمی‌گیرد؛
    // بررسی آن در PermissionsGuard به‌صورت میان‌بر انجام می‌شود.
    if (def.permissions === '*') continue;

    const wanted = new Set(def.permissions as readonly string[]);
    const current = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true, permission: { select: { key: true } } },
    });
    const currentKeys = new Set(current.map((rp) => rp.permission.key));

    const toAdd = [...wanted].filter((k) => !currentKeys.has(k));
    const toRemove = current.filter((rp) => !wanted.has(rp.permission.key));

    if (toAdd.length > 0) {
      await prisma.rolePermission.createMany({
        data: toAdd
          .map((k) => idByKey.get(k))
          .filter((id): id is string => Boolean(id))
          .map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length > 0) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove.map((r) => r.permissionId) } },
      });
    }
  }
  console.log(`✔ ${Object.keys(SYSTEM_ROLES).length} نقش سیستمی همگام‌سازی شد`);
}

export async function seedSettings(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    // فقط تنظیمات نبوده را می‌سازیم — مقادیری که مدیر تغییر داده دست‌نخورده می‌ماند.
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (existing) continue;
    await prisma.setting.create({
      data: {
        key,
        value: value as never,
        group: groupOfSetting(key),
        isPublic: PUBLIC_SETTING_KEYS.has(key),
      },
    });
    created++;
  }
  console.log(`✔ تنظیمات: ${created} کلید جدید افزوده شد (${Object.keys(DEFAULT_SETTINGS).length} کلید در مجموع)`);
}

export async function seedNumberingRules(prisma: PrismaClient): Promise<void> {
  for (const rule of DEFAULT_NUMBERING_RULES) {
    await prisma.numberingRule.upsert({
      where: { key: rule.key },
      // الگو و شمارنده موجود هرگز بازنویسی نمی‌شود — تغییر آن شماره‌های تکراری می‌سازد.
      create: {
        key: rule.key,
        name: rule.name,
        target: rule.target,
        pattern: rule.pattern,
        resetPolicy: rule.resetPolicy,
      },
      update: { name: rule.name },
    });
  }
  console.log(`✔ ${DEFAULT_NUMBERING_RULES.length} قانون شماره‌گذاری همگام‌سازی شد`);
}

export async function seedDefaultBranch(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.branch.findFirst({ where: { isDefault: true } });
  if (existing) return existing.id;

  const branch = await prisma.branch.create({
    data: { code: 'MAIN', name: 'کتابخانه مرکزی', isDefault: true },
  });
  console.log('✔ شعبه پیش‌فرض ساخته شد');
  return branch.id;
}

export async function seedMembershipTypes(prisma: PrismaClient): Promise<void> {
  const count = await prisma.membershipType.count();
  if (count > 0) return;

  await prisma.membershipType.createMany({
    data: [
      {
        name: 'عادی',
        description: 'عضویت استاندارد — از قوانین عمومی کتابخانه پیروی می‌کند',
        isDefault: true,
      },
      {
        name: 'دانشجویی',
        description: 'سقف امانت بالاتر و مدت طولانی‌تر برای دانشجویان',
        maxLoans: 8,
        loanDays: 21,
        maxRenewals: 3,
      },
      {
        name: 'ویژه / پژوهشگر',
        description: 'بیشترین امکانات برای پژوهشگران و اعضای هیئت علمی',
        maxLoans: 15,
        loanDays: 30,
        maxRenewals: 4,
        maxReservations: 8,
      },
      {
        name: 'کودک و نوجوان',
        description: 'عضویت زیر ۱۴ سال با سقف پایین‌تر',
        maxLoans: 3,
        loanDays: 14,
        maxRenewals: 1,
      },
    ],
  });
  console.log('✔ ۴ نوع عضویت پیش‌فرض ساخته شد');
}

export async function seedNotificationTemplates(prisma: PrismaClient): Promise<void> {
  const templates = [
    {
      key: 'due_soon',
      type: 'DUE_SOON' as const,
      subject: 'یادآوری موعد بازگشت کتاب',
      body: '{{memberName}} عزیز، موعد بازگشت کتاب «{{bookTitle}}» تاریخ {{dueDate}} است. لطفاً به‌موقع مراجعه کنید.',
    },
    {
      key: 'overdue',
      type: 'OVERDUE' as const,
      subject: 'اعلام دیرکرد',
      body: '{{memberName}} عزیز، کتاب «{{bookTitle}}» از تاریخ {{dueDate}} دیرکرد دارد ({{overdueDays}} روز). جریمه فعلی: {{fineAmount}}',
    },
    {
      key: 'reservation_ready',
      type: 'RESERVATION_READY' as const,
      subject: 'کتاب رزروشده آماده تحویل است',
      body: '{{memberName}} عزیز، کتاب «{{bookTitle}}» که رزرو کرده بودید آماده است. مهلت مراجعه تا {{expiryDate}}.',
    },
    {
      key: 'membership_expiring',
      type: 'MEMBERSHIP_EXPIRING' as const,
      subject: 'انقضای نزدیک عضویت',
      body: '{{memberName}} عزیز، اعتبار عضویت شما در تاریخ {{expiryDate}} به پایان می‌رسد.',
    },
    {
      key: 'fine_issued',
      type: 'FINE_ISSUED' as const,
      subject: 'ثبت جریمه',
      body: '{{memberName}} عزیز، جریمه‌ای به مبلغ {{fineAmount}} بابت «{{reason}}» برای شما ثبت شد.',
    },
  ];

  for (const t of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key_channel: { key: t.key, channel: 'IN_APP' } },
      create: { ...t, channel: 'IN_APP' },
      update: {},
    });
  }
  console.log(`✔ ${templates.length} قالب اعلان همگام‌سازی شد`);
}

/** اجرای کامل Seed هسته — در هر Deploy فراخوانی می‌شود. */
export async function seedCore(prisma: PrismaClient): Promise<void> {
  await seedPermissions(prisma);
  await seedRoles(prisma);
  await seedSettings(prisma);
  await seedNumberingRules(prisma);
  await seedDefaultBranch(prisma);
  await seedMembershipTypes(prisma);
  await seedNotificationTemplates(prisma);
}
