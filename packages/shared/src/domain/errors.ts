/**
 * کدهای خطای دامنه‌ای.
 *
 * قرارداد: API هرگز پیام خام دیتابیس یا Stack Trace را برنمی‌گرداند.
 * پاسخ خطا همیشه به شکل `{ code, message, details? }` است که `message` آن
 * فارسی و قابل نمایش مستقیم به کتابدار است.
 */

export const ERROR_CODES = {
  // عمومی
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // احراز هویت
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',

  // کاتالوگ و نسخه
  DUPLICATE_BARCODE: 'DUPLICATE_BARCODE',
  DUPLICATE_ACCESSION_NUMBER: 'DUPLICATE_ACCESSION_NUMBER',
  DUPLICATE_ASSET_NUMBER: 'DUPLICATE_ASSET_NUMBER',
  DUPLICATE_MEMBER_CODE: 'DUPLICATE_MEMBER_CODE',
  DUPLICATE_NATIONAL_ID: 'DUPLICATE_NATIONAL_ID',
  BOOK_HAS_COPIES: 'BOOK_HAS_COPIES',
  COPY_HAS_OPEN_LOAN: 'COPY_HAS_OPEN_LOAN',
  INVALID_ISBN: 'INVALID_ISBN',

  // مکان
  INVALID_LOCATION_HIERARCHY: 'INVALID_LOCATION_HIERARCHY',
  LOCATION_NOT_EMPTY: 'LOCATION_NOT_EMPTY',
  LOCATION_CAPACITY_EXCEEDED: 'LOCATION_CAPACITY_EXCEEDED',
  CIRCULAR_LOCATION: 'CIRCULAR_LOCATION',

  // امانت
  COPY_NOT_AVAILABLE: 'COPY_NOT_AVAILABLE',
  COPY_NOT_LOANABLE: 'COPY_NOT_LOANABLE',
  MEMBER_LOAN_LIMIT_REACHED: 'MEMBER_LOAN_LIMIT_REACHED',
  MEMBER_NOT_ACTIVE: 'MEMBER_NOT_ACTIVE',
  MEMBER_MEMBERSHIP_EXPIRED: 'MEMBER_MEMBERSHIP_EXPIRED',
  MEMBER_HAS_OVERDUE: 'MEMBER_HAS_OVERDUE',
  MEMBER_HAS_UNPAID_FINES: 'MEMBER_HAS_UNPAID_FINES',
  RENEWAL_LIMIT_REACHED: 'RENEWAL_LIMIT_REACHED',
  RENEWAL_BLOCKED_BY_RESERVATION: 'RENEWAL_BLOCKED_BY_RESERVATION',
  RENEWAL_BLOCKED_BY_OVERDUE: 'RENEWAL_BLOCKED_BY_OVERDUE',
  LOAN_ALREADY_RETURNED: 'LOAN_ALREADY_RETURNED',
  RESERVATION_LIMIT_REACHED: 'RESERVATION_LIMIT_REACHED',
  ALREADY_RESERVED: 'ALREADY_RESERVED',
  RESERVED_FOR_ANOTHER_MEMBER: 'RESERVED_FOR_ANOTHER_MEMBER',

  // جریمه
  FINE_ALREADY_SETTLED: 'FINE_ALREADY_SETTLED',
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',

  // سیستم
  SETUP_ALREADY_COMPLETED: 'SETUP_ALREADY_COMPLETED',
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  IMPORT_FILE_INVALID: 'IMPORT_FILE_INVALID',
  BACKUP_FAILED: 'BACKUP_FAILED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** پیام فارسی پیش‌فرض هر کد خطا. سرویس‌ها می‌توانند پیام دقیق‌تری جایگزین کنند. */
export const ERROR_MESSAGES_FA: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'اطلاعات واردشده معتبر نیست. لطفاً موارد مشخص‌شده را اصلاح کنید.',
  NOT_FOUND: 'مورد درخواستی یافت نشد.',
  CONFLICT: 'این عملیات با وضعیت فعلی اطلاعات سازگار نیست.',
  FORBIDDEN: 'شما مجوز انجام این عملیات را ندارید.',
  UNAUTHORIZED: 'برای ادامه باید وارد سامانه شوید.',
  RATE_LIMITED: 'تعداد درخواست‌های شما بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  INTERNAL: 'خطای غیرمنتظره‌ای رخ داد. موضوع ثبت شد و در حال بررسی است.',

  INVALID_CREDENTIALS: 'نام کاربری یا رمز عبور نادرست است.',
  ACCOUNT_LOCKED: 'به دلیل تلاش‌های ناموفق مکرر، حساب شما موقتاً قفل شده است.',
  ACCOUNT_DISABLED: 'حساب کاربری شما غیرفعال شده است. با مدیر سیستم تماس بگیرید.',
  TOKEN_EXPIRED: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',
  TOKEN_REUSE_DETECTED: 'به دلیل تشخیص استفاده مشکوک، تمام نشست‌های شما بسته شد. دوباره وارد شوید.',

  DUPLICATE_BARCODE: 'این بارکد قبلاً برای نسخه دیگری ثبت شده است.',
  DUPLICATE_ACCESSION_NUMBER: 'این شماره ثبت قبلاً استفاده شده است.',
  DUPLICATE_ASSET_NUMBER: 'این شماره اموال قبلاً استفاده شده است.',
  DUPLICATE_MEMBER_CODE: 'این کد عضویت قبلاً ثبت شده است.',
  DUPLICATE_NATIONAL_ID: 'عضو دیگری با همین کد ملی ثبت شده است.',
  BOOK_HAS_COPIES: 'این کتاب دارای نسخه فیزیکی است و قابل حذف نیست. ابتدا نسخه‌ها را حذف یا بایگانی کنید.',
  COPY_HAS_OPEN_LOAN: 'این نسخه در امانت است و تا زمان بازگشت قابل حذف یا تغییر نیست.',
  INVALID_ISBN: 'شابک واردشده معتبر نیست.',

  INVALID_LOCATION_HIERARCHY: 'ساختار مکان نادرست است؛ نوع مکان با والد آن سازگار نیست.',
  LOCATION_NOT_EMPTY: 'این مکان دارای کتاب یا زیرمجموعه است و قابل حذف نیست.',
  LOCATION_CAPACITY_EXCEEDED: 'ظرفیت این قفسه تکمیل است.',
  CIRCULAR_LOCATION: 'نمی‌توان یک مکان را زیرمجموعه خودش قرار داد.',

  COPY_NOT_AVAILABLE: 'این نسخه در حال حاضر موجود نیست.',
  COPY_NOT_LOANABLE: 'این نسخه قابل امانت نیست.',
  MEMBER_LOAN_LIMIT_REACHED: 'این عضو به سقف مجاز تعداد امانت رسیده است.',
  MEMBER_NOT_ACTIVE: 'عضویت این شخص فعال نیست.',
  MEMBER_MEMBERSHIP_EXPIRED: 'اعتبار عضویت این شخص به پایان رسیده است.',
  MEMBER_HAS_OVERDUE: 'این عضو کتاب دیرکرددار دارد و تا بازگرداندن آن نمی‌تواند امانت جدید بگیرد.',
  MEMBER_HAS_UNPAID_FINES: 'این عضو جریمه پرداخت‌نشده دارد.',
  RENEWAL_LIMIT_REACHED: 'این امانت به حداکثر تعداد تمدید مجاز رسیده است.',
  RENEWAL_BLOCKED_BY_RESERVATION: 'این کتاب توسط عضو دیگری رزرو شده و قابل تمدید نیست.',
  RENEWAL_BLOCKED_BY_OVERDUE: 'امانت دیرکرددار قابل تمدید نیست؛ ابتدا کتاب را بازگردانید.',
  LOAN_ALREADY_RETURNED: 'این امانت قبلاً بازگشت داده شده است.',
  RESERVATION_LIMIT_REACHED: 'این عضو به سقف مجاز تعداد رزرو رسیده است.',
  ALREADY_RESERVED: 'این عضو قبلاً این کتاب را رزرو کرده است.',
  RESERVED_FOR_ANOTHER_MEMBER: 'این نسخه برای عضو دیگری کنار گذاشته شده است.',

  FINE_ALREADY_SETTLED: 'این جریمه قبلاً تسویه یا بخشیده شده است.',
  PAYMENT_EXCEEDS_BALANCE: 'مبلغ پرداختی از مانده بدهی بیشتر است.',

  SETUP_ALREADY_COMPLETED: 'راه‌اندازی اولیه سامانه قبلاً انجام شده است.',
  SETUP_REQUIRED: 'راه‌اندازی اولیه سامانه هنوز انجام نشده است.',
  IMPORT_FILE_INVALID: 'فایل واردشده معتبر نیست یا ساختار قابل خواندنی ندارد.',
  BACKUP_FAILED: 'ایجاد نسخه پشتیبان ناموفق بود.',
  RESTORE_FAILED: 'بازیابی نسخه پشتیبان ناموفق بود.',
  FILE_TOO_LARGE: 'حجم فایل بیش از حد مجاز است.',
  UNSUPPORTED_FILE_TYPE: 'نوع فایل انتخاب‌شده پشتیبانی نمی‌شود.',
};
