import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@darin/shared';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { DomainError } from '../../common/errors/domain.error';

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

/** انواع فایل مجاز و پسوند متعارف هرکدام. */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/**
 * ذخیره‌سازی فایل با درایور قابل تعویض.
 *
 * فعلاً فقط درایور `local` پیاده‌سازی شده — چون کتابخانه روی سرور خودش مستقر
 * می‌شود و وابستگی به فضای ابری برایش مزیتی ندارد. متدهای عمومی این کلاس
 * (`save`، `read`، `delete`) قراردادی است که یک `S3StorageService` آینده
 * می‌تواند بدون تغییر هیچ فراخوانی‌کننده‌ای پیاده کند.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_LOCAL_PATH', './storage'));
    this.maxBytes = config.get<number>('MAX_UPLOAD_SIZE_MB', 15) * 1_048_576;
  }

  async onModuleInit(): Promise<void> {
    for (const sub of ['uploads', 'covers', 'avatars', 'exports', 'imports', 'backups', 'temp']) {
      await mkdir(join(this.root, sub), { recursive: true });
    }
    this.logger.log(`مسیر ذخیره‌سازی: ${this.root}`);
  }

  /**
   * ذخیره فایل با نام امن.
   *
   * نام اصلی فایل که کاربر آپلود کرده **هرگز** به‌عنوان نام روی دیسک استفاده
   * نمی‌شود؛ نام واقعی یک UUID است. این کار سه مشکل را هم‌زمان حل می‌کند:
   * Path Traversal (`../../etc/passwd`)، برخورد نام‌ها، و نام‌های فارسی/طولانی
   * که در سیستم‌فایل‌های مختلف رفتار متفاوت دارند.
   */
  async save(
    folder: string,
    buffer: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<StoredFile> {
    if (buffer.length > this.maxBytes) {
      throw new DomainError(
        ERROR_CODES.FILE_TOO_LARGE,
        `حجم فایل بیش از حد مجاز (${Math.round(this.maxBytes / 1_048_576)} مگابایت) است.`,
      );
    }

    const extension = ALLOWED_MIME[mimeType];
    if (!extension) {
      throw new DomainError(
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        `نوع فایل «${mimeType}» پشتیبانی نمی‌شود. فرمت‌های مجاز: تصویر، PDF، Excel و CSV.`,
      );
    }

    // اعتماد نکردن به هدر Content-Type: محتوای واقعی فایل بررسی می‌شود.
    if (!this.matchesMagicBytes(buffer, mimeType)) {
      throw new DomainError(
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        'محتوای فایل با نوع اعلام‌شده آن مطابقت ندارد.',
      );
    }

    // بخش‌بندی بر اساس تاریخ تا یک پوشه با صدهزار فایل ساخته نشود.
    const now = new Date();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const storageKey = `${folder}/${datePath}/${randomUUID()}${extension}`;
    const absolute = this.resolveKey(storageKey);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    this.logger.debug(`فایل ذخیره شد: ${storageKey} (نام اصلی: ${originalName})`);
    return {
      storageKey,
      sizeBytes: buffer.length,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  /** ذخیره فایلی که برنامه خودش ساخته (خروجی Excel، پشتیبان) — بدون بررسی نوع. */
  async saveGenerated(folder: string, fileName: string, buffer: Buffer): Promise<StoredFile> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const storageKey = `${folder}/${randomUUID()}-${safeName}`;
    const absolute = this.resolveKey(storageKey);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);
    return {
      storageKey,
      sizeBytes: buffer.length,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  createReadStream(storageKey: string): ReadStream {
    return createReadStream(this.resolveKey(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  absolutePath(storageKey: string): string {
    return this.resolveKey(storageKey);
  }

  /**
   * تبدیل کلید به مسیر مطلق با جلوگیری از Path Traversal.
   *
   * حتی اگر کلیدی از دیتابیس بیاید که شامل `../` باشد (مثلاً از یک نقص
   * دیگر)، این تابع اجازه خروج از پوشه ذخیره‌سازی را نمی‌دهد.
   */
  private resolveKey(storageKey: string): string {
    const target = resolve(this.root, normalize(storageKey));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      this.logger.error(`تلاش برای دسترسی خارج از مسیر ذخیره‌سازی: ${storageKey}`);
      throw DomainError.forbidden('مسیر فایل نامعتبر است.');
    }
    return target;
  }

  /** بررسی امضای واقعی فایل (Magic Bytes). */
  private matchesMagicBytes(buffer: Buffer, mimeType: string): boolean {
    const head = buffer.subarray(0, 12);
    switch (mimeType) {
      case 'image/jpeg':
        return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      case 'image/png':
        return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      case 'image/gif':
        return head.subarray(0, 3).toString('ascii') === 'GIF';
      case 'image/webp':
        return head.subarray(0, 4).toString('ascii') === 'RIFF'
          && head.subarray(8, 12).toString('ascii') === 'WEBP';
      case 'application/pdf':
        return head.subarray(0, 4).toString('ascii') === '%PDF';
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        // xlsx یک آرشیو ZIP است
        return head[0] === 0x50 && head[1] === 0x4b;
      case 'application/vnd.ms-excel':
        // xls قدیمی (OLE2) یا در عمل گاهی CSV با این نوع ارسال می‌شود
        return (head[0] === 0xd0 && head[1] === 0xcf) || this.looksLikeText(buffer);
      case 'text/csv':
        return this.looksLikeText(buffer);
      default:
        return false;
    }
  }

  /** فایل متنی نباید بایت صفر داشته باشد. */
  private looksLikeText(buffer: Buffer): boolean {
    return !buffer.subarray(0, 4096).includes(0);
  }

  /** پسوند متعارف یک نوع MIME — برای نام‌گذاری خروجی‌ها. */
  static extensionFor(mimeType: string): string {
    return ALLOWED_MIME[mimeType] ?? extname(mimeType) ?? '';
  }
}
