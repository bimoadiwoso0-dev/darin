import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ClientIp, CurrentUser, RequirePermissions, type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { MaintenanceService } from './maintenance.service';

@ApiTags('نگهداری سیستم')
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly audit: AuditService,
  ) {}

  /**
   * اجرای دستی کارهای شبانه.
   * وقتی مدیر می‌خواهد بدون انتظار تا نیمه‌شب، دیرکردها را به‌روز کند.
   */
  @Post('run')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'اجرای فوری کارهای نگهداری شبانه' })
  async run(@CurrentUser() user: AuthenticatedUser, @ClientIp() ip: string) {
    const results = await this.maintenance.runNow();
    await this.audit.record({
      action: 'run_maintenance',
      entityType: 'System',
      entityLabel: 'اجرای دستی کارهای نگهداری',
      newData: results,
      user, ip,
    });
    return results;
  }
}
