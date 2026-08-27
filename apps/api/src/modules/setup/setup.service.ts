import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, SETTING_KEYS } from '@darin/shared';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';

export interface SetupStatus {
  setupCompleted: boolean;
  hasAdminUser: boolean;
  databaseReady: boolean;
  permissionsSeeded: boolean;
  libraryName: string;
}

export interface CompleteSetupInput {
  library: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    timezone: string;
    currency: string;
  };
  admin: {
    username: string;
    fullName: string;
    email?: string;
    password: string;
  };
  rules: {
    maxItems: number;
    periodDays: number;
    maxRenewals: number;
    dailyFineAmount: number;
  };
  /** ساخت ساختار اولیه مکان (یک ساختمان با چند بخش) */
  createStarterLocations: boolean;
}

/**
 * راه‌اندازی اولیه سامانه (قانون ۱۱۱).
 *
 * تصمیم امنیتی کلیدی: هیچ حساب مدیر با رمز پیش‌فرض در Seed ساخته نمی‌شود
 * (قانون ۱۱۰). سامانه تا زمانی که Setup انجام نشده، در حالت «راه‌اندازی‌نشده»
 * است و فقط Endpoint های Setup پاسخ می‌دهند.
 *
 * پنجره آسیب‌پذیری: بین اولین اجرا و تکمیل Setup، هر کسی که به سرور دسترسی
 * شبکه‌ای دارد می‌تواند مدیر بسازد. به همین دلیل در DEPLOYMENT.md تأکید شده
 * که Setup باید بلافاصله پس از استقرار و پیش از باز کردن پورت انجام شود.
 */
@Injectable()
export class SetupService {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async getStatus(): Promise<SetupStatus> {
    const [adminCount, permissionCount, dbHealth] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null, roles: { some: { role: { key: 'SUPER_ADMIN' } } } } }),
      this.prisma.permission.count(),
      this.prisma.healthCheck(),
    ]);

    return {
      setupCompleted: this.settings.get(SETTING_KEYS.SETUP_COMPLETED) === true,
      hasAdminUser: adminCount > 0,
      databaseReady: dbHealth.ok,
      permissionsSeeded: permissionCount > 0,
      libraryName: this.settings.get(SETTING_KEYS.LIBRARY_NAME),
    };
  }

  async complete(input: CompleteSetupInput, ip?: string): Promise<{ username: string }> {
    const status = await this.getStatus();
    if (status.setupCompleted || status.hasAdminUser) {
      throw new DomainError(ERROR_CODES.SETUP_ALREADY_COMPLETED);
    }
    if (!status.permissionsSeeded) {
      throw new DomainError(
        ERROR_CODES.SETUP_REQUIRED,
        'مجوزهای سیستم هنوز در دیتابیس ثبت نشده‌اند. ابتدا دستور Seed را اجرا کنید: pnpm db:seed -- --core-only',
      );
    }

    const superAdminRole = await this.prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
    if (!superAdminRole) {
      throw new DomainError(ERROR_CODES.SETUP_REQUIRED, 'نقش مدیر ارشد در دیتابیس یافت نشد.');
    }

    const username = input.admin.username.trim().toLowerCase();
    const passwordHash = await AuthService.hashPassword(input.admin.password);
    const branch = await this.prisma.branch.findFirst({ where: { isDefault: true } });

    // کل راه‌اندازی در یک تراکنش: یا سامانه کاملاً آماده می‌شود یا هیچ اثری
    // نمی‌ماند. حالت نیمه‌راه‌اندازی‌شده بدترین حالت ممکن است.
    await this.prisma.$transaction(async (tx) => {
      const branchId =
        branch?.id ??
        (await tx.branch.create({ data: { code: 'MAIN', name: input.library.name, isDefault: true } })).id;

      const user = await tx.user.create({
        data: {
          username,
          fullName: input.admin.fullName,
          email: input.admin.email || null,
          passwordHash,
          branchId,
          isActive: true,
          mustChangePassword: false,
        },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: superAdminRole.id } });

      const settingsToWrite: Array<[string, unknown, string]> = [
        [SETTING_KEYS.LIBRARY_NAME, input.library.name, 'library'],
        [SETTING_KEYS.LIBRARY_ADDRESS, input.library.address ?? '', 'library'],
        [SETTING_KEYS.LIBRARY_PHONE, input.library.phone ?? '', 'library'],
        [SETTING_KEYS.LIBRARY_EMAIL, input.library.email ?? '', 'library'],
        [SETTING_KEYS.LIBRARY_TIMEZONE, input.library.timezone, 'library'],
        [SETTING_KEYS.LIBRARY_CURRENCY, input.library.currency, 'library'],
        [SETTING_KEYS.LOAN_MAX_ITEMS, input.rules.maxItems, 'loan'],
        [SETTING_KEYS.LOAN_PERIOD_DAYS, input.rules.periodDays, 'loan'],
        [SETTING_KEYS.LOAN_MAX_RENEWALS, input.rules.maxRenewals, 'loan'],
        [SETTING_KEYS.FINE_DAILY_AMOUNT, input.rules.dailyFineAmount, 'fine'],
        [SETTING_KEYS.SETUP_COMPLETED, true, 'system'],
        [SETTING_KEYS.SETUP_COMPLETED_AT, new Date().toISOString(), 'system'],
      ];

      for (const [key, value, group] of settingsToWrite) {
        await tx.setting.upsert({
          where: { key },
          create: {
            key,
            value: value as never,
            group,
            isPublic: key === SETTING_KEYS.LIBRARY_NAME || key === SETTING_KEYS.SETUP_COMPLETED,
          },
          update: { value: value as never, updatedById: user.id },
        });
      }

      if (input.createStarterLocations) {
        await this.createStarterLocations(tx, branchId, input.library.name);
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          userLabel: `${input.admin.fullName} (${username})`,
          action: 'setup_completed',
          entityType: 'System',
          entityLabel: input.library.name,
          ip: ip ?? null,
        },
      });
    });

    await this.settings.reload();
    this.logger.log(`راه‌اندازی اولیه کامل شد — مدیر ارشد: ${username}`);
    return { username };
  }

  /** ساختار اولیه مکان: یک ساختمان، یک طبقه، چهار بخش با قفسه‌های خالی. */
  private async createStarterLocations(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    branchId: string,
    libraryName: string,
  ): Promise<void> {
    const building = await tx.location.create({
      data: { branchId, kind: 'BUILDING', name: libraryName, code: 'B1', fullCode: 'B1', depth: 0 },
    });
    const buildingPath = `.${building.id}.`;
    await tx.location.update({ where: { id: building.id }, data: { path: buildingPath } });

    const floor = await tx.location.create({
      data: {
        branchId, parentId: building.id, kind: 'FLOOR', name: 'طبقه همکف',
        code: 'F1', fullCode: 'B1-F1', depth: 1, path: buildingPath,
      },
    });
    const floorPath = `${buildingPath}${floor.id}.`;
    await tx.location.update({ where: { id: floor.id }, data: { path: floorPath } });

    const sections = [
      { name: 'بخش عمومی', code: 'S1' },
      { name: 'بخش مرجع', code: 'S2' },
      { name: 'بخش کودک و نوجوان', code: 'S3' },
      { name: 'مخزن', code: 'S4' },
    ];

    for (const [i, sec] of sections.entries()) {
      const section = await tx.location.create({
        data: {
          branchId, parentId: floor.id, kind: 'SECTION', name: sec.name, code: sec.code,
          fullCode: `B1-F1-${sec.code}`, depth: 2, path: floorPath, sortOrder: i,
        },
      });
      await tx.location.update({
        where: { id: section.id },
        data: { path: `${floorPath}${section.id}.` },
      });
    }
  }
}
