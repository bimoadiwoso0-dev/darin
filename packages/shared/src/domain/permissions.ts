/**
 * فهرست مرجع مجوزهای سیستم.
 * این فایل تنها منبع حقیقت است: Seed دیتابیس، Guard های سمت سرور و
 * کنترل نمایش منو در Frontend همگی از همین ثابت‌ها استفاده می‌کنند.
 */

export const PERMISSION_GROUPS = {
  catalog: 'کاتالوگ',
  holdings: 'نسخه‌های فیزیکی',
  locations: 'مکان‌ها و قفسه‌ها',
  members: 'اعضا',
  circulation: 'امانت',
  fines: 'جریمه‌ها',
  inventory: 'موجودی',
  reports: 'گزارش‌ها',
  imports: 'ورود اطلاعات',
  system: 'سیستم',
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

export interface PermissionDef {
  key: string;
  group: PermissionGroup;
  label: string;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  // ── کاتالوگ ──────────────────────────────────────────────
  { key: 'books.view', group: 'catalog', label: 'مشاهده کتاب‌ها' },
  { key: 'books.create', group: 'catalog', label: 'ثبت کتاب جدید' },
  { key: 'books.edit', group: 'catalog', label: 'ویرایش کتاب' },
  { key: 'books.delete', group: 'catalog', label: 'حذف/بایگانی کتاب' },
  { key: 'books.bulk_edit', group: 'catalog', label: 'ویرایش گروهی کتاب‌ها' },
  { key: 'authors.view', group: 'catalog', label: 'مشاهده پدیدآورندگان' },
  { key: 'authors.manage', group: 'catalog', label: 'مدیریت پدیدآورندگان' },
  { key: 'publishers.view', group: 'catalog', label: 'مشاهده ناشران' },
  { key: 'publishers.manage', group: 'catalog', label: 'مدیریت ناشران' },
  { key: 'categories.view', group: 'catalog', label: 'مشاهده دسته‌بندی‌ها' },
  { key: 'categories.manage', group: 'catalog', label: 'مدیریت دسته‌بندی‌ها' },
  { key: 'series.manage', group: 'catalog', label: 'مدیریت مجموعه‌ها' },

  // ── نسخه‌های فیزیکی ──────────────────────────────────────
  { key: 'copies.view', group: 'holdings', label: 'مشاهده نسخه‌ها' },
  { key: 'copies.create', group: 'holdings', label: 'افزودن نسخه' },
  { key: 'copies.edit', group: 'holdings', label: 'ویرایش نسخه' },
  { key: 'copies.delete', group: 'holdings', label: 'حذف/بایگانی نسخه' },
  { key: 'copies.move', group: 'holdings', label: 'جابه‌جایی نسخه بین قفسه‌ها' },
  { key: 'copies.change_status', group: 'holdings', label: 'تغییر وضعیت نسخه' },
  { key: 'labels.print', group: 'holdings', label: 'چاپ برچسب و بارکد' },

  // ── مکان‌ها ──────────────────────────────────────────────
  { key: 'locations.view', group: 'locations', label: 'مشاهده مکان‌ها' },
  { key: 'locations.manage', group: 'locations', label: 'مدیریت ساختمان، قفسه و طبقه' },

  // ── اعضا ─────────────────────────────────────────────────
  { key: 'members.view', group: 'members', label: 'مشاهده اعضا' },
  { key: 'members.create', group: 'members', label: 'ثبت عضو جدید' },
  { key: 'members.edit', group: 'members', label: 'ویرایش عضو' },
  { key: 'members.delete', group: 'members', label: 'حذف/بایگانی عضو' },
  { key: 'members.card', group: 'members', label: 'صدور کارت عضویت' },

  // ── امانت ────────────────────────────────────────────────
  { key: 'loans.view', group: 'circulation', label: 'مشاهده امانت‌ها' },
  { key: 'loans.create', group: 'circulation', label: 'ثبت امانت' },
  { key: 'loans.return', group: 'circulation', label: 'ثبت بازگشت' },
  { key: 'loans.renew', group: 'circulation', label: 'تمدید امانت' },
  { key: 'loans.override', group: 'circulation', label: 'نادیده‌گرفتن محدودیت‌های امانت' },
  { key: 'reservations.view', group: 'circulation', label: 'مشاهده رزروها' },
  { key: 'reservations.manage', group: 'circulation', label: 'مدیریت رزرو' },
  { key: 'lost.manage', group: 'circulation', label: 'مدیریت پرونده مفقودی' },

  // ── جریمه ────────────────────────────────────────────────
  { key: 'fines.view', group: 'fines', label: 'مشاهده جریمه‌ها' },
  { key: 'fines.create', group: 'fines', label: 'ثبت جریمه' },
  { key: 'fines.collect', group: 'fines', label: 'دریافت پرداخت' },
  { key: 'fines.waive', group: 'fines', label: 'بخشش جریمه' },

  // ── موجودی ───────────────────────────────────────────────
  { key: 'inventory.view', group: 'inventory', label: 'مشاهده شمارش موجودی' },
  { key: 'inventory.manage', group: 'inventory', label: 'اجرای شمارش موجودی' },

  // ── گزارش ────────────────────────────────────────────────
  { key: 'reports.view', group: 'reports', label: 'مشاهده گزارش‌ها' },
  { key: 'reports.export', group: 'reports', label: 'خروجی گرفتن از گزارش‌ها' },
  { key: 'dashboard.view', group: 'reports', label: 'مشاهده داشبورد' },

  // ── ورود اطلاعات ─────────────────────────────────────────
  { key: 'imports.run', group: 'imports', label: 'ورود اطلاعات از Excel/CSV' },

  // ── سیستم ────────────────────────────────────────────────
  { key: 'users.view', group: 'system', label: 'مشاهده کاربران' },
  { key: 'users.manage', group: 'system', label: 'مدیریت کاربران' },
  { key: 'roles.manage', group: 'system', label: 'مدیریت نقش‌ها و دسترسی‌ها' },
  { key: 'settings.view', group: 'system', label: 'مشاهده تنظیمات' },
  { key: 'settings.manage', group: 'system', label: 'تغییر تنظیمات' },
  { key: 'audit.view', group: 'system', label: 'مشاهده گزارش فعالیت‌ها' },
  { key: 'backup.manage', group: 'system', label: 'پشتیبان‌گیری و بازیابی' },
  { key: 'notifications.manage', group: 'system', label: 'پیگیری و بستن یادآوری‌ها' },
] as const;

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

/** نقش‌های پیش‌فرض. `SUPER_ADMIN` تمام مجوزها را به‌صورت ضمنی دارد. */
export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    key: 'SUPER_ADMIN',
    name: 'مدیر ارشد سیستم',
    description: 'دسترسی کامل و بدون محدودیت به تمام بخش‌های سامانه',
    permissions: '*' as const,
  },
  LIBRARY_MANAGER: {
    key: 'LIBRARY_MANAGER',
    name: 'مدیر کتابخانه',
    description: 'مدیریت کامل کتابخانه به‌جز مدیریت کاربران سیستم و بازیابی پشتیبان',
    permissions: PERMISSION_KEYS.filter(
      (k) => !['roles.manage', 'backup.manage'].includes(k),
    ),
  },
  LIBRARIAN: {
    key: 'LIBRARIAN',
    name: 'کتابدار',
    description: 'عملیات روزمره: ثبت کتاب، اعضا، امانت، بازگشت و جریمه',
    permissions: [
      'dashboard.view',
      'books.view', 'books.create', 'books.edit',
      'authors.view', 'authors.manage', 'publishers.view', 'publishers.manage',
      'categories.view', 'series.manage',
      'copies.view', 'copies.create', 'copies.edit', 'copies.move', 'copies.change_status',
      'labels.print', 'locations.view',
      'members.view', 'members.create', 'members.edit', 'members.card',
      'loans.view', 'loans.create', 'loans.return', 'loans.renew',
      'reservations.view', 'reservations.manage', 'lost.manage',
      'fines.view', 'fines.create', 'fines.collect',
      'inventory.view', 'reports.view', 'notifications.manage',
    ],
  },
  ASSISTANT: {
    key: 'ASSISTANT',
    name: 'دستیار کتابدار',
    description: 'فقط عملیات امانت و بازگشت و مشاهده اطلاعات',
    permissions: [
      'dashboard.view', 'books.view', 'copies.view', 'locations.view',
      'members.view', 'loans.view', 'loans.create', 'loans.return', 'loans.renew',
      'reservations.view', 'fines.view', 'notifications.manage',
    ],
  },
  INVENTORY_MANAGER: {
    key: 'INVENTORY_MANAGER',
    name: 'مسئول موجودی',
    description: 'شمارش موجودی، جابه‌جایی کتاب و مدیریت قفسه‌ها',
    permissions: [
      'dashboard.view', 'books.view', 'copies.view', 'copies.edit',
      'copies.move', 'copies.change_status', 'labels.print',
      'locations.view', 'locations.manage',
      'inventory.view', 'inventory.manage', 'reports.view', 'reports.export',
    ],
  },
  REPORT_VIEWER: {
    key: 'REPORT_VIEWER',
    name: 'ناظر گزارش‌ها',
    description: 'فقط مشاهده و خروجی گرفتن از گزارش‌ها — بدون امکان تغییر داده',
    permissions: [
      'dashboard.view', 'books.view', 'copies.view', 'members.view',
      'loans.view', 'fines.view', 'reports.view', 'reports.export',
    ],
  },
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;
