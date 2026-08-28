/**
 * کلیدهای تنظیمات سیستم و مقادیر پیش‌فرض.
 * هیچ قانون کتابخانه‌ای در کد Hard-code نمی‌شود؛ همه از اینجا خوانده می‌شود.
 */

export const SETTING_KEYS = {
  // هویت کتابخانه
  LIBRARY_NAME: 'library.name',
  LIBRARY_LOGO_ID: 'library.logoAttachmentId',
  LIBRARY_ADDRESS: 'library.address',
  LIBRARY_PHONE: 'library.phone',
  LIBRARY_EMAIL: 'library.email',
  LIBRARY_TIMEZONE: 'library.timezone',
  LIBRARY_CURRENCY: 'library.currency',
  LIBRARY_LOCALE: 'library.locale',

  // قوانین امانت
  LOAN_MAX_ITEMS: 'loan.maxItems',
  LOAN_PERIOD_DAYS: 'loan.periodDays',
  LOAN_MAX_RENEWALS: 'loan.maxRenewals',
  LOAN_RENEWAL_DAYS: 'loan.renewalDays',
  LOAN_BLOCK_IF_OVERDUE: 'loan.blockIfOverdue',
  LOAN_BLOCK_IF_UNPAID_FINES: 'loan.blockIfUnpaidFines',
  LOAN_UNPAID_FINE_THRESHOLD: 'loan.unpaidFineThreshold',
  LOAN_GRACE_PERIOD_DAYS: 'loan.gracePeriodDays',

  // رزرو
  RESERVATION_MAX_PER_MEMBER: 'reservation.maxPerMember',
  RESERVATION_HOLD_DAYS: 'reservation.holdDays',
  RESERVATION_BLOCKS_RENEWAL: 'reservation.blocksRenewal',

  // جریمه
  FINE_DAILY_AMOUNT: 'fine.dailyAmount',
  FINE_MAX_PER_LOAN: 'fine.maxPerLoan',
  FINE_LOST_MULTIPLIER: 'fine.lostMultiplier',
  FINE_DEFAULT_REPLACEMENT_COST: 'fine.defaultReplacementCost',

  // عضویت
  MEMBERSHIP_DURATION_DAYS: 'membership.durationDays',
  MEMBERSHIP_EXPIRY_WARNING_DAYS: 'membership.expiryWarningDays',

  // اعلان‌ها
  NOTIFY_DUE_SOON_DAYS: 'notification.dueSoonDays',
  NOTIFY_ENABLED_CHANNELS: 'notification.enabledChannels',

  // پشتیبان‌گیری
  BACKUP_SCHEDULE: 'backup.schedule',
  BACKUP_RETENTION_COUNT: 'backup.retentionCount',
  BACKUP_INCLUDE_FILES: 'backup.includeFiles',

  // برچسب
  LABEL_DEFAULT_TEMPLATE: 'label.defaultTemplate',

  // وضعیت راه‌اندازی
  SETUP_COMPLETED: 'system.setupCompleted',
  SETUP_COMPLETED_AT: 'system.setupCompletedAt',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface LibrarySettings {
  'library.name': string;
  'library.logoAttachmentId': string | null;
  'library.address': string;
  'library.phone': string;
  'library.email': string;
  'library.timezone': string;
  'library.currency': string;
  'library.locale': string;

  'loan.maxItems': number;
  'loan.periodDays': number;
  'loan.maxRenewals': number;
  'loan.renewalDays': number;
  'loan.blockIfOverdue': boolean;
  'loan.blockIfUnpaidFines': boolean;
  'loan.unpaidFineThreshold': number;
  'loan.gracePeriodDays': number;

  'reservation.maxPerMember': number;
  'reservation.holdDays': number;
  'reservation.blocksRenewal': boolean;

  'fine.dailyAmount': number;
  'fine.maxPerLoan': number;
  'fine.lostMultiplier': number;
  'fine.defaultReplacementCost': number;

  'membership.durationDays': number;
  'membership.expiryWarningDays': number;

  'notification.dueSoonDays': number;
  'notification.enabledChannels': string[];

  'backup.schedule': 'off' | 'daily' | 'weekly';
  'backup.retentionCount': number;
  'backup.includeFiles': boolean;

  'label.defaultTemplate': string;

  'system.setupCompleted': boolean;
  'system.setupCompletedAt': string | null;
}

export const DEFAULT_SETTINGS: LibrarySettings = {
  'library.name': 'کتابخانه',
  'library.logoAttachmentId': null,
  'library.address': '',
  'library.phone': '',
  'library.email': '',
  'library.timezone': 'Asia/Tehran',
  'library.currency': 'IRT', // تومان
  'library.locale': 'fa-IR',

  'loan.maxItems': 5,
  'loan.periodDays': 14,
  'loan.maxRenewals': 2,
  'loan.renewalDays': 14,
  'loan.blockIfOverdue': true,
  'loan.blockIfUnpaidFines': true,
  'loan.unpaidFineThreshold': 50_000,
  'loan.gracePeriodDays': 0,

  'reservation.maxPerMember': 3,
  'reservation.holdDays': 3,
  'reservation.blocksRenewal': true,

  'fine.dailyAmount': 5_000,
  'fine.maxPerLoan': 500_000,
  'fine.lostMultiplier': 2,
  'fine.defaultReplacementCost': 200_000,

  'membership.durationDays': 365,
  'membership.expiryWarningDays': 30,

  'notification.dueSoonDays': 3,
  'notification.enabledChannels': ['IN_APP'],

  'backup.schedule': 'daily',
  'backup.retentionCount': 14,
  'backup.includeFiles': true,

  'label.defaultTemplate': 'standard-50x30',

  'system.setupCompleted': false,
  'system.setupCompletedAt': null,
};

/** گروه‌بندی تنظیمات برای نمایش در صفحه تنظیمات. */
export const SETTING_GROUPS: Record<string, { label: string; keys: SettingKey[] }> = {
  library: {
    label: 'اطلاعات کتابخانه',
    keys: [
      SETTING_KEYS.LIBRARY_NAME, SETTING_KEYS.LIBRARY_ADDRESS, SETTING_KEYS.LIBRARY_PHONE,
      SETTING_KEYS.LIBRARY_EMAIL, SETTING_KEYS.LIBRARY_TIMEZONE, SETTING_KEYS.LIBRARY_CURRENCY,
    ],
  },
  loan: {
    label: 'قوانین امانت',
    keys: [
      SETTING_KEYS.LOAN_MAX_ITEMS, SETTING_KEYS.LOAN_PERIOD_DAYS, SETTING_KEYS.LOAN_MAX_RENEWALS,
      SETTING_KEYS.LOAN_RENEWAL_DAYS, SETTING_KEYS.LOAN_GRACE_PERIOD_DAYS,
      SETTING_KEYS.LOAN_BLOCK_IF_OVERDUE, SETTING_KEYS.LOAN_BLOCK_IF_UNPAID_FINES,
      SETTING_KEYS.LOAN_UNPAID_FINE_THRESHOLD,
    ],
  },
  reservation: {
    label: 'قوانین رزرو',
    keys: [
      SETTING_KEYS.RESERVATION_MAX_PER_MEMBER, SETTING_KEYS.RESERVATION_HOLD_DAYS,
      SETTING_KEYS.RESERVATION_BLOCKS_RENEWAL,
    ],
  },
  fine: {
    label: 'قوانین جریمه',
    keys: [
      SETTING_KEYS.FINE_DAILY_AMOUNT, SETTING_KEYS.FINE_MAX_PER_LOAN,
      SETTING_KEYS.FINE_LOST_MULTIPLIER, SETTING_KEYS.FINE_DEFAULT_REPLACEMENT_COST,
    ],
  },
  membership: {
    label: 'عضویت',
    keys: [SETTING_KEYS.MEMBERSHIP_DURATION_DAYS, SETTING_KEYS.MEMBERSHIP_EXPIRY_WARNING_DAYS],
  },
  notification: {
    label: 'اعلان‌ها',
    keys: [SETTING_KEYS.NOTIFY_DUE_SOON_DAYS, SETTING_KEYS.NOTIFY_ENABLED_CHANNELS],
  },
  backup: {
    label: 'پشتیبان‌گیری',
    keys: [
      SETTING_KEYS.BACKUP_SCHEDULE, SETTING_KEYS.BACKUP_RETENTION_COUNT,
      SETTING_KEYS.BACKUP_INCLUDE_FILES,
    ],
  },
};

/**
 * توصیف هر تنظیم برای رابط کاربری.
 *
 * ── چرا اینجا و نه در صفحه تنظیمات ──────────────────────────────────────
 * صفحه تنظیمات فقط این توصیف‌ها را رندر می‌کند؛ افزودن یک تنظیم جدید
 * یعنی افزودن یک کلید اینجا، بدون هیچ تغییری در کد React. اگر برچسب‌ها
 * در کامپوننت می‌بودند، هر تنظیم جدید نیازمند ویرایش دو جا بود و
 * دیر یا زود یکی جا می‌ماند.
 *
 * `unit` فقط برای نمایش کنار فیلد است؛ مقدار ذخیره‌شده همیشه عدد خام است.
 */
export interface SettingMeta {
  label: string;
  hint?: string;
  type: 'text' | 'number' | 'money' | 'boolean' | 'select' | 'multiselect';
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export const SETTING_META: Partial<Record<SettingKey, SettingMeta>> = {
  'library.name': { label: 'نام کتابخانه', type: 'text',
    hint: 'در صفحه ورود، کارت عضویت و برچسب‌ها چاپ می‌شود.' },
  'library.address': { label: 'نشانی', type: 'text' },
  'library.phone': { label: 'تلفن', type: 'text' },
  'library.email': { label: 'ایمیل', type: 'text' },
  'library.timezone': { label: 'منطقه زمانی', type: 'select',
    hint: 'مبنای محاسبه موعد بازگشت و گزارش‌های روزانه.',
    options: [
      { value: 'Asia/Tehran', label: 'تهران (Asia/Tehran)' },
      { value: 'UTC', label: 'جهانی (UTC)' },
    ] },
  'library.currency': { label: 'واحد پول', type: 'select',
    options: [
      { value: 'IRT', label: 'تومان' },
      { value: 'IRR', label: 'ریال' },
    ] },

  'loan.maxItems': { label: 'حداکثر کتاب هم‌زمان', type: 'number', unit: 'جلد', min: 1, max: 100,
    hint: 'نوع عضویت می‌تواند مقدار متفاوتی داشته باشد که بر این اولویت دارد.' },
  'loan.periodDays': { label: 'مدت امانت', type: 'number', unit: 'روز', min: 1, max: 365 },
  'loan.maxRenewals': { label: 'حداکثر دفعات تمدید', type: 'number', unit: 'بار', min: 0, max: 20 },
  'loan.renewalDays': { label: 'مدت هر تمدید', type: 'number', unit: 'روز', min: 1, max: 365 },
  'loan.gracePeriodDays': { label: 'مهلت ارفاقی پیش از جریمه', type: 'number', unit: 'روز',
    min: 0, max: 60,
    hint: 'تا این تعداد روز پس از موعد، جریمه‌ای محاسبه نمی‌شود.' },
  'loan.blockIfOverdue': { label: 'جلوگیری از امانت به عضو دیرکرددار', type: 'boolean',
    hint: 'کتابدار دارای مجوز می‌تواند در موارد خاص از این محدودیت عبور کند.' },
  'loan.blockIfUnpaidFines': { label: 'جلوگیری از امانت به عضو بدهکار', type: 'boolean' },
  'loan.unpaidFineThreshold': { label: 'سقف بدهی مجاز', type: 'money',
    hint: 'بدهی بیش از این مبلغ، امانت را متوقف می‌کند.' },

  'reservation.maxPerMember': { label: 'حداکثر رزرو هم‌زمان هر عضو', type: 'number',
    unit: 'مورد', min: 0, max: 50 },
  'reservation.holdDays': { label: 'مهلت تحویل رزرو آماده', type: 'number', unit: 'روز',
    min: 1, max: 30,
    hint: 'پس از این مدت، نوبت به عضو بعدی صف می‌رسد.' },
  'reservation.blocksRenewal': { label: 'رزرو مانع تمدید شود', type: 'boolean',
    hint: 'اگر کسی در صف انتظار باشد، امانت‌گیرنده فعلی نمی‌تواند تمدید کند.' },

  'fine.dailyAmount': { label: 'جریمه روزانه دیرکرد', type: 'money' },
  'fine.maxPerLoan': { label: 'سقف جریمه هر امانت', type: 'money',
    hint: 'جریمه یک امانت از این مبلغ بیشتر نمی‌شود.' },
  'fine.lostMultiplier': { label: 'ضریب جریمه کتاب مفقود', type: 'number', unit: 'برابر قیمت',
    min: 1, max: 10 },
  'fine.defaultReplacementCost': { label: 'هزینه پیش‌فرض جایگزینی', type: 'money',
    hint: 'وقتی قیمت خرید نسخه ثبت نشده باشد، این مبلغ مبنا قرار می‌گیرد.' },

  'membership.durationDays': { label: 'مدت پیش‌فرض عضویت', type: 'number', unit: 'روز',
    min: 1, max: 3650 },
  'membership.expiryWarningDays': { label: 'هشدار پیش از انقضای عضویت', type: 'number',
    unit: 'روز', min: 0, max: 365 },

  'notification.dueSoonDays': { label: 'یادآوری پیش از موعد بازگشت', type: 'number', unit: 'روز',
    min: 0, max: 30 },
  'notification.enabledChannels': { label: 'کانال‌های فعال اعلان', type: 'multiselect',
    options: [
      { value: 'IN_APP', label: 'داخل سامانه' },
      { value: 'EMAIL', label: 'ایمیل' },
      { value: 'SMS', label: 'پیامک' },
    ],
    hint: 'کانال‌های ایمیل و پیامک نیاز به پیکربندی سرویس‌دهنده در فایل .env دارند.' },

  'backup.schedule': { label: 'زمان‌بندی پشتیبان‌گیری خودکار', type: 'select',
    options: [
      { value: 'off', label: 'خاموش' },
      { value: 'daily', label: 'روزانه' },
      { value: 'weekly', label: 'هفتگی' },
    ] },
  'backup.retentionCount': { label: 'تعداد پشتیبان نگه‌داشته‌شده', type: 'number', unit: 'فایل',
    min: 1, max: 365,
    hint: 'پشتیبان‌های قدیمی‌تر از این تعداد خودکار حذف می‌شوند.' },
  'backup.includeFiles': { label: 'شامل فایل‌های پیوست', type: 'boolean',
    hint: 'تصاویر جلد و پیوست‌ها هم در پشتیبان قرار می‌گیرند (حجم بیشتر).' },

  'label.defaultTemplate': { label: 'قالب پیش‌فرض برچسب', type: 'text' },
};
