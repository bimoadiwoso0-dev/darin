import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SETTING_GROUPS, validateNumberPattern } from '@darin/shared';
import { z } from 'zod';
import {
  ClientIp,
  CurrentUser,
  Public,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { DomainError } from '../../common/errors/domain.error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsService } from './settings.service';

/** کلیدهای مجاز — جلوگیری از نوشتن کلید دلخواه در جدول تنظیمات. */
const ALL_KEYS = new Set<string>(Object.values(SETTING_GROUPS).flatMap((g) => g.keys));

const UpdateSettingsSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).every((k) => ALL_KEYS.has(k)), {
    message: 'یکی از کلیدهای ارسالی جزو تنظیمات قابل تغییر نیست.',
  })
  .refine(
    (obj) => {
      // اعتبارسنجی معنایی: قوانین متناقض پذیرفته نمی‌شوند
      const period = obj['loan.periodDays'];
      const renewal = obj['loan.renewalDays'];
      if (typeof period === 'number' && period < 1) return false;
      if (typeof renewal === 'number' && renewal < 1) return false;
      return true;
    },
    { message: 'مدت امانت و مدت تمدید باید حداقل یک روز باشد.' },
  );

const UpdateNumberingSchema = z.object({
  pattern: z.string().min(1).max(60),
  prefix: z.string().max(20).nullable().optional(),
});

@ApiTags('تنظیمات')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** تنظیمات عمومی — صفحه ورود پیش از احراز هویت به نام کتابخانه نیاز دارد. */
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'تنظیمات عمومی (بدون احراز هویت)' })
  getPublic() {
    return this.settings.getPublic();
  }

  @Get()
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'تمام تنظیمات کتابخانه' })
  getAll() {
    return { settings: this.settings.getAll(), groups: SETTING_GROUPS };
  }

  @Put()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'به‌روزرسانی تنظیمات' })
  async update(
    @Body(zodBody(UpdateSettingsSchema)) body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    const before = this.settings.snapshot(Object.keys(body));
    const updated = await this.settings.updateMany(body, user.sub);

    await this.audit.recordUpdate({
      entityType: 'Setting',
      entityLabel: 'تنظیمات کتابخانه',
      before,
      after: body,
      user,
      ip,
    });
    return updated;
  }

  @Get('numbering')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'قوانین شماره‌گذاری' })
  async getNumbering() {
    return this.prisma.numberingRule.findMany({ orderBy: { key: 'asc' } });
  }

  @Put('numbering/:key')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'تغییر الگوی شماره‌گذاری' })
  async updateNumbering(
    @Param('key') key: string,
    @Body(zodBody(UpdateNumberingSchema)) body: z.infer<typeof UpdateNumberingSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    const validation = validateNumberPattern(body.pattern);
    if (!validation.valid) {
      throw DomainError.validation({ pattern: [validation.error ?? 'الگو معتبر نیست.'] });
    }
    // شمارنده جاری هرگز از این مسیر تغییر نمی‌کند — تغییر آن شماره تکراری می‌سازد.
    const rule = await this.prisma.numberingRule.update({
      where: { key },
      data: { pattern: body.pattern, prefix: body.prefix ?? null },
    });
    await this.audit.record({
      action: 'update_numbering_rule',
      entityType: 'NumberingRule',
      entityId: rule.id,
      entityLabel: rule.name,
      newData: { pattern: body.pattern, prefix: body.prefix },
      user,
      ip,
    });
    return rule;
  }
}
