/**
 * برچسب فارسی مقادیر enum دیتابیس.
 * مقدارها با `schema.prisma` یکسان‌اند؛ تست `enums.test.ts` این تطابق را می‌سنجد.
 */

export const COPY_STATUS = {
  AVAILABLE: 'موجود',
  ON_LOAN: 'امانت داده شده',
  RESERVED_HOLD: 'رزرو شده (آماده تحویل)',
  LOST: 'مفقود',
  DAMAGED: 'آسیب‌دیده',
  IN_REPAIR: 'در تعمیر',
  IN_TRANSIT: 'در حال انتقال',
  NOT_LOANABLE: 'غیرقابل امانت',
  ARCHIVED: 'آرشیوی',
  WITHDRAWN: 'از رده خارج',
} as const;
export type CopyStatus = keyof typeof COPY_STATUS;

/** وضعیت‌هایی که یعنی نسخه در قفسه و قابل امانت است. */
export const LOANABLE_COPY_STATUSES: CopyStatus[] = ['AVAILABLE'];
/** وضعیت‌هایی که نسخه در دسترس فیزیکی کتابخانه محسوب می‌شود (برای شمارش موجودی). */
export const ON_SHELF_STATUSES: CopyStatus[] = [
  'AVAILABLE', 'RESERVED_HOLD', 'DAMAGED', 'IN_REPAIR', 'NOT_LOANABLE', 'ARCHIVED',
];

export const COPY_CONDITION = {
  NEW: 'نو',
  GOOD: 'خوب',
  FAIR: 'متوسط',
  POOR: 'ضعیف',
} as const;
export type CopyCondition = keyof typeof COPY_CONDITION;

export const LOAN_STATUS = {
  ACTIVE: 'در جریان',
  OVERDUE: 'دیرکرد',
  RETURNED: 'بازگشت داده شده',
  LOST: 'مفقود اعلام شده',
  CLAIMED_RETURNED: 'ادعای بازگشت',
} as const;
export type LoanStatus = keyof typeof LOAN_STATUS;
export const OPEN_LOAN_STATUSES: LoanStatus[] = ['ACTIVE', 'OVERDUE'];

export const RESERVATION_STATUS = {
  PENDING: 'در صف انتظار',
  READY: 'آماده تحویل',
  FULFILLED: 'تحویل داده شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده',
} as const;
export type ReservationStatus = keyof typeof RESERVATION_STATUS;

export const MEMBER_STATUS = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  SUSPENDED: 'تعلیق شده',
  EXPIRED: 'منقضی شده',
  BLOCKED: 'مسدود',
} as const;
export type MemberStatus = keyof typeof MEMBER_STATUS;

export const FINE_TYPE = {
  LATE_RETURN: 'دیرکرد',
  DAMAGE: 'آسیب به کتاب',
  LOST: 'مفقود شدن کتاب',
  REPLACEMENT: 'هزینه جایگزینی',
  MEMBERSHIP: 'حق عضویت',
  OTHER: 'سایر',
} as const;
export type FineType = keyof typeof FINE_TYPE;

export const FINE_STATUS = {
  UNPAID: 'پرداخت نشده',
  PARTIALLY_PAID: 'پرداخت جزئی',
  PAID: 'پرداخت شده',
  WAIVED: 'بخشیده شده',
} as const;
export type FineStatus = keyof typeof FINE_STATUS;

export const PAYMENT_METHOD = {
  CASH: 'نقدی',
  CARD: 'کارت‌خوان',
  TRANSFER: 'کارت به کارت / انتقال',
  ONLINE: 'پرداخت اینترنتی',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD;

export const CONTRIBUTOR_ROLE = {
  AUTHOR: 'نویسنده',
  CO_AUTHOR: 'نویسنده همکار',
  TRANSLATOR: 'مترجم',
  EDITOR: 'ویراستار',
  COMPILER: 'گردآورنده',
  ILLUSTRATOR: 'تصویرگر',
  INTRODUCER: 'مقدمه‌نویس',
  RESEARCHER: 'پژوهشگر',
  NARRATOR: 'راوی',
  CALLIGRAPHER: 'خوشنویس',
} as const;
export type ContributorRole = keyof typeof CONTRIBUTOR_ROLE;

export const LOCATION_KIND = {
  BUILDING: 'ساختمان',
  FLOOR: 'طبقه',
  SECTION: 'بخش',
  ROOM: 'اتاق',
  AISLE: 'راهرو',
  SHELF: 'قفسه',
  SHELF_LEVEL: 'طبقه قفسه',
  POSITION: 'موقعیت',
} as const;
export type LocationKind = keyof typeof LOCATION_KIND;

/** ترتیب سلسله‌مراتبی مجاز — والد یک گره باید از نوعی «بالاتر» باشد. */
export const LOCATION_KIND_ORDER: LocationKind[] = [
  'BUILDING', 'FLOOR', 'SECTION', 'ROOM', 'AISLE', 'SHELF', 'SHELF_LEVEL', 'POSITION',
];

export const ACQUISITION_SOURCE = {
  PURCHASE: 'خرید',
  DONATION: 'اهدا',
  TRANSFER: 'انتقال',
  EXCHANGE: 'مبادله',
  LEGAL_DEPOSIT: 'واسپاری قانونی',
  INTER_LIBRARY: 'امانت بین‌کتابخانه‌ای',
  OTHER: 'سایر',
} as const;
export type AcquisitionSource = keyof typeof ACQUISITION_SOURCE;

export const BOOK_FORMAT = {
  RAHLI: 'رحلی',
  SOLTANI: 'سلطانی',
  VAZIRI: 'وزیری',
  ROQEI: 'رقعی',
  JEEBI: 'جیبی',
  KHESHTI: 'خشتی',
  PALTOEI: 'پالتویی',
  OTHER: 'سایر',
} as const;
export type BookFormat = keyof typeof BOOK_FORMAT;

export const BINDING_TYPE = {
  HARDCOVER: 'سخت (گالینگور)',
  PAPERBACK: 'شومیز',
  SPIRAL: 'فنری',
  LEATHER: 'چرمی',
  OTHER: 'سایر',
} as const;
export type BindingType = keyof typeof BINDING_TYPE;

export const CALENDAR_TYPE = {
  SOLAR_HIJRI: 'هجری شمسی',
  GREGORIAN: 'میلادی',
  LUNAR_HIJRI: 'هجری قمری',
} as const;
export type CalendarType = keyof typeof CALENDAR_TYPE;

export const INVENTORY_SESSION_STATUS = {
  DRAFT: 'پیش‌نویس',
  IN_PROGRESS: 'در حال اجرا',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'لغو شده',
} as const;
export type InventorySessionStatus = keyof typeof INVENTORY_SESSION_STATUS;

export const INVENTORY_SCAN_RESULT = {
  FOUND: 'یافت شد',
  MOVED: 'در محل دیگری یافت شد',
  UNEXPECTED: 'خارج از محدوده شمارش',
  UNKNOWN: 'بارکد ناشناخته',
  DUPLICATE: 'اسکن تکراری',
} as const;
export type InventoryScanResult = keyof typeof INVENTORY_SCAN_RESULT;

export const LOST_REPORT_STATUS = {
  OPEN: 'باز',
  CHARGED: 'خسارت ثبت شد',
  REPLACED: 'جایگزین شد',
  WRITTEN_OFF: 'از موجودی خارج شد',
  FOUND: 'پیدا شد',
  CLOSED: 'بسته شده',
} as const;
export type LostReportStatus = keyof typeof LOST_REPORT_STATUS;

export const JOB_STATUS = {
  PENDING: 'در صف',
  RUNNING: 'در حال اجرا',
  COMPLETED: 'تکمیل شده',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
} as const;
export type JobStatus = keyof typeof JOB_STATUS;

export const NOTIFICATION_TYPE = {
  DUE_SOON: 'نزدیک شدن موعد بازگشت',
  OVERDUE: 'دیرکرد',
  RESERVATION_READY: 'رزرو آماده تحویل',
  MEMBERSHIP_EXPIRING: 'انقضای نزدیک عضویت',
  FINE_ISSUED: 'ثبت جریمه',
  LOST_BOOK: 'کتاب مفقود',
  SYSTEM: 'پیام سیستم',
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPE;
