import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_SETTINGS,
  SETTING_GROUPS,
  type LibrarySettings,
  type SettingKey,
} from '@darin/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * تنظیمات کتابخانه با Cache در حافظه.
 *
 * چرا Cache؟ هر عملیات امانت، بازگشت و تمدید حداقل ۵ تنظیم را می‌خواند
 * (سقف امانت، مدت، تعداد تمدید، جریمه روزانه، مهلت ارفاق). بدون Cache،
 * هر اسکن بارکد چند کوئری اضافه به دیتابیس می‌زد.
 *
 * چون تنظیمات فقط از طریق همین سرویس تغییر می‌کنند، Cache همیشه تازه است.
 * در استقرار چندنمونه‌ای (Multi-instance) باید به Redis Pub/Sub ارتقا یابد —
 * برای یک کتابخانه تک‌سروری لازم نیست.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    const next = new Map<string, unknown>();
    for (const row of rows) next.set(row.key, row.value);
    this.cache = next;
    this.loaded = true;
    this.logger.log(`${rows.length} تنظیم بارگذاری شد`);
  }

  /**
   * خواندن یک تنظیم با Type-safety کامل.
   * اگر کلید در دیتابیس نبود (مثلاً تنظیم جدیدی که هنوز Seed نشده)، مقدار
   * پیش‌فرض کد برگردانده می‌شود تا سیستم هرگز به‌خاطر یک کلید گمشده نشکند.
   */
  get<K extends keyof LibrarySettings>(key: K): LibrarySettings[K] {
    if (!this.loaded) {
      this.logger.warn(`تنظیم «${key}» پیش از بارگذاری Cache خوانده شد؛ مقدار پیش‌فرض برگردانده شد.`);
      return DEFAULT_SETTINGS[key];
    }
    const value = this.cache.get(key);
    return (value === undefined ? DEFAULT_SETTINGS[key] : value) as LibrarySettings[K];
  }

  /** تمام تنظیمات به‌صورت یک شیء — برای صفحه تنظیمات و Bootstrap فرانت‌اند. */
  getAll(): LibrarySettings {
    const out = { ...DEFAULT_SETTINGS };
    for (const [key, value] of this.cache) {
      if (key in out) (out as Record<string, unknown>)[key] = value;
    }
    return out;
  }

  /** تنظیمات عمومی — بدون احراز هویت (نام و لوگوی کتابخانه در صفحه ورود). */
  async getPublic(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany({ where: { isPublic: true } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /**
   * به‌روزرسانی گروهی تنظیمات در یک تراکنش.
   * یا همه اعمال می‌شوند یا هیچ‌کدام — تا سیستم با ترکیبی نیمه‌کاره از قوانین
   * امانت مواجه نشود.
   */
  async updateMany(
    updates: Partial<Record<SettingKey, unknown>>,
    userId?: string,
  ): Promise<LibrarySettings> {
    const entries = Object.entries(updates);
    if (entries.length === 0) return this.getAll();

    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { key },
          create: { key, value: value as never, group: groupOf(key), updatedById: userId },
          update: { value: value as never, updatedById: userId },
        }),
      ),
    );

    await this.reload();
    return this.getAll();
  }

  /** مقدار قبلی چند کلید — برای ثبت در Audit Log پیش از تغییر. */
  snapshot(keys: string[]): Record<string, unknown> {
    return Object.fromEntries(keys.map((k) => [k, this.cache.get(k)]));
  }
}

function groupOf(key: string): string {
  for (const [group, def] of Object.entries(SETTING_GROUPS)) {
    if ((def.keys as readonly string[]).includes(key)) return group;
  }
  return key.split('.')[0] ?? 'system';
}
