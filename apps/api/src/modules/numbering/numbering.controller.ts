import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from './numbering.service';

@ApiTags('شماره‌گذاری')
@Controller('numbering')
export class NumberingController {
  constructor(
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  @Get('preview')
  @RequirePermissions('copies.create')
  @ApiOperation({ summary: 'پیش‌نمایش شماره بعدی همه قوانین' })
  async preview() {
    const keys = ['accession', 'barcode', 'library_code', 'asset', 'member_code', 'loan_number'];
    const values = await Promise.all(keys.map((k) => this.numbering.preview(k)));
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  }

  /**
   * همگام‌سازی شمارنده‌ها با داده موجود.
   * پس از Import انبوه یا بازیابی پشتیبان باید اجرا شود؛ در UI به‌عنوان
   * «تعمیر شماره‌گذاری» در صفحه تنظیمات در دسترس است.
   */
  @Post('sync')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'همگام‌سازی شمارنده‌ها با بیشترین شماره موجود' })
  async sync(@CurrentUser() user: AuthenticatedUser, @ClientIp() ip: string) {
    const results = await this.numbering.syncSequences();
    const changed = results.filter((r) => r.changed);
    if (changed.length > 0) {
      await this.audit.record({
        action: 'sync_numbering',
        entityType: 'NumberingRule',
        entityLabel: `${changed.length} شمارنده همگام شد`,
        newData: changed,
        user,
        ip,
      });
    }
    return { results, changedCount: changed.length };
  }
}
